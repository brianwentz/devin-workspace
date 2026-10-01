<#
.SYNOPSIS
  Installed-artifact smoke for Devin Workspaces (plan §5 P3).

  1. Silently installs dist\DevinWorkspaces-Setup-<version>.exe per-user into -InstallDir
  2. Runs tests/smoke/installed.spec.ts (phase=fresh) against the installed exe
  3. Re-runs the same installer over the existing install (upgrade-in-place)
  4. Runs the smoke spec again (phase=upgrade) and asserts the profile survived
  5. Silently uninstalls and asserts the install dir is gone

  No admin required (perMachine=false). Logs go to docs\evidence\p3-smoke.log.
#>
[CmdletBinding()]
param(
  [string]$Installer,
  [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'Programs\devin-workspaces-smoke'),
  [string]$ProfileDir = (Join-Path $env:TEMP 'devin-workspaces-smoke-profile'),
  [string]$LogFile,
  [switch]$SkipUpgrade
)

$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $root
if (-not $LogFile) { $LogFile = Join-Path $root 'docs\evidence\p3-smoke.log' }
New-Item -ItemType Directory -Force -Path (Split-Path $LogFile) | Out-Null
Remove-Item -Force -ErrorAction SilentlyContinue $LogFile

function Log([string]$message) {
  $line = "{0} {1}" -f (Get-Date -Format 'yyyy-MM-ddTHH:mm:ss.fffK'), $message
  Write-Host $line
  Add-Content -Path $LogFile -Value $line
}

function Fail([string]$message) { Log "FAIL: $message"; throw $message }

function Run-Installer([string]$exe, [string]$dir, [string]$label) {
  # electron-builder NSIS: /S silent, /currentuser forces per-user, /D= must be last and unquoted.
  $args = @('/S', '/currentuser', "/D=$dir")
  Log "$label`: `"$exe`" $($args -join ' ')"
  $proc = Start-Process -FilePath $exe -ArgumentList $args -Wait -PassThru
  Log "$label exit code: $($proc.ExitCode)"
  if ($proc.ExitCode -ne 0) { Fail "$label failed with exit code $($proc.ExitCode)" }
}

# electron-builder keys the per-user uninstall entry by a GUID derived from appId and names it
# "Devin Workspaces <version>", so match on the uninstaller path inside our install dir.
function Get-UninstallEntry() {
  Get-ChildItem 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall' -ErrorAction SilentlyContinue |
    ForEach-Object { Get-ItemProperty $_.PSPath } |
    Where-Object { $_.DisplayName -like 'Devin Workspaces*' -and $_.UninstallString -like "*$InstallDir\*" } |
    Select-Object -First 1
}

function Assert-NoApp() {
  $procs = Get-Process -Name 'Devin Workspaces' -ErrorAction SilentlyContinue
  if ($procs) {
    Log "Killing leftover Devin Workspaces processes: $($procs.Id -join ',')"
    $procs | Stop-Process -Force
    Start-Sleep -Seconds 2
  }
}

# --- locate installer --------------------------------------------------------
if (-not $Installer) {
  $candidates = Get-ChildItem -Path (Join-Path $root 'dist') -Filter 'DevinWorkspaces-Setup-*.exe' -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending
  if (-not $candidates) { Fail 'No dist\DevinWorkspaces-Setup-*.exe found; run npm run dist:win first' }
  $Installer = $candidates[0].FullName
}
$Installer = (Resolve-Path $Installer).Path
$size = (Get-Item $Installer).Length
Log "Installer: $Installer ($([math]::Round($size / 1MB, 2)) MB, $size bytes)"
Log "InstallDir: $InstallDir"
Log "Profile: $ProfileDir"
Log "Machine: $env:COMPUTERNAME, user: $env:USERNAME, elevated: $(([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))"

# --- clean slate -------------------------------------------------------------
Assert-NoApp
if (Test-Path $InstallDir) {
  $existingUninstaller = Join-Path $InstallDir 'Uninstall Devin Workspaces.exe'
  if (Test-Path $existingUninstaller) {
    Log "Found previous install; uninstalling first"
    Start-Process -FilePath $existingUninstaller -ArgumentList @('/S', '/currentuser', "_?=$InstallDir") -Wait | Out-Null
  }
  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $InstallDir
}
Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $ProfileDir
New-Item -ItemType Directory -Force -Path $ProfileDir | Out-Null

$exe = Join-Path $InstallDir 'Devin Workspaces.exe'
$uninstaller = Join-Path $InstallDir 'Uninstall Devin Workspaces.exe'
$evidenceDir = Join-Path $root 'docs\evidence'

$env:DEVIN_WORKSPACES_INSTALLED_EXE = $exe
$env:DEVIN_WORKSPACES_SMOKE_PROFILE = $ProfileDir
$env:DEVIN_WORKSPACES_SMOKE_EVIDENCE = $evidenceDir

$failed = $false
try {
  # --- install -------------------------------------------------------------
  Run-Installer $Installer $InstallDir 'install'
  if (-not (Test-Path $exe)) { Fail "installed exe not found at $exe" }
  if (-not (Test-Path $uninstaller)) { Fail "uninstaller not found at $uninstaller" }
  $installedFiles = (Get-ChildItem -Recurse -File $InstallDir | Measure-Object -Property Length -Sum)
  Log "Installed: $($installedFiles.Count) files, $([math]::Round($installedFiles.Sum / 1MB, 2)) MB"
  $reg = Get-UninstallEntry
  if ($reg) { Log "Uninstall registry: key='$($reg.PSChildName)' DisplayName='$($reg.DisplayName)' DisplayVersion='$($reg.DisplayVersion)' UninstallString='$($reg.UninstallString)'" }
  else { Fail 'No HKCU uninstall entry with DisplayName "Devin Workspaces" found' }

  # --- smoke: fresh --------------------------------------------------------
  $env:DEVIN_WORKSPACES_SMOKE_PHASE = 'fresh'
  Log 'Running smoke spec (phase=fresh)'
  & npx playwright test --config playwright.smoke.config.ts 2>&1 | ForEach-Object { Add-Content -Path $LogFile -Value $_; Write-Host $_ }
  if ($LASTEXITCODE -ne 0) { Fail "smoke spec (fresh) failed with exit code $LASTEXITCODE" }
  Assert-NoApp
  if (-not (Test-Path (Join-Path $ProfileDir 'settings.json'))) { Fail 'settings.json missing after fresh smoke' }

  if (-not $SkipUpgrade) {
    # --- upgrade in place --------------------------------------------------
    Run-Installer $Installer $InstallDir 'upgrade-in-place'
    if (-not (Test-Path $exe)) { Fail "installed exe missing after upgrade at $exe" }
    if (-not (Test-Path (Join-Path $ProfileDir 'settings.json'))) { Fail 'settings.json did not survive upgrade-in-place' }
    Log 'Profile survived upgrade-in-place (settings.json present)'

    $env:DEVIN_WORKSPACES_SMOKE_PHASE = 'upgrade'
    Log 'Running smoke spec (phase=upgrade)'
    & npx playwright test --config playwright.smoke.config.ts 2>&1 | ForEach-Object { Add-Content -Path $LogFile -Value $_; Write-Host $_ }
    if ($LASTEXITCODE -ne 0) { Fail "smoke spec (upgrade) failed with exit code $LASTEXITCODE" }
    Assert-NoApp
  }
}
catch {
  $failed = $true
  Log "ERROR: $($_.Exception.Message)"
}
finally {
  # --- uninstall -----------------------------------------------------------
  Assert-NoApp
  if (Test-Path $uninstaller) {
    # _?= makes the uninstaller run in place (so -Wait is accurate) instead of copying itself to %TEMP%.
    Log "uninstall: `"$uninstaller`" /S /currentuser _?=$InstallDir"
    $proc = Start-Process -FilePath $uninstaller -ArgumentList @('/S', '/currentuser', "_?=$InstallDir") -Wait -PassThru
    Log "uninstall exit code: $($proc.ExitCode)"
    # With _?= the uninstaller cannot delete itself; remove the (now empty-ish) dir it leaves behind.
    Start-Sleep -Seconds 1
    $leftovers = Get-ChildItem -Recurse -File $InstallDir -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne 'Uninstall Devin Workspaces.exe' }
    if ($leftovers) {
      Log "FAIL: files left after uninstall: $($leftovers.FullName -join '; ')"
      $failed = $true
    }
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $InstallDir
  }
  if (Test-Path $InstallDir) { Log "FAIL: install dir still present: $InstallDir"; $failed = $true }
  else { Log "Install dir removed: $InstallDir" }
  $regAfter = Get-UninstallEntry
  if ($regAfter) { Log 'FAIL: uninstall registry key still present'; $failed = $true } else { Log 'Uninstall registry key removed' }
  $profileSurvived = Test-Path (Join-Path $ProfileDir 'settings.json')
  Log "Profile retained after uninstall (deleteAppDataOnUninstall=false; smoke profile is env-overridden): $profileSurvived"
  Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $ProfileDir
  Remove-Item Env:\DEVIN_WORKSPACES_INSTALLED_EXE, Env:\DEVIN_WORKSPACES_SMOKE_PROFILE, Env:\DEVIN_WORKSPACES_SMOKE_EVIDENCE, Env:\DEVIN_WORKSPACES_SMOKE_PHASE -ErrorAction SilentlyContinue
}

if ($failed) { Log 'RESULT: FAIL'; exit 1 }
Log 'RESULT: PASS'
exit 0
