# CI: raise the GitHub-hosted runner's display resolution. windows-latest boots
# at 1024x768, which clamps the 1400x900 test window and auto-collapses the tab
# pane. Best-effort: a failure only warns — tests/e2e/helpers.ts fail-fast
# check is the real gate.
#
# -DryRun: print the current resolution and what this script would do, without
# changing anything (safe to run on a dev box).
param([switch]$DryRun)

Add-Type -AssemblyName System.Windows.Forms
$before = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
Write-Host "current resolution: $($before.Width)x$($before.Height)"

$targets = @(@(1920, 1080), @(1600, 900), @(1280, 1024))

# Preferred path: Set-DisplayResolution exists on Windows Server runners.
if (Get-Command Set-DisplayResolution -ErrorAction SilentlyContinue) {
  foreach ($t in $targets) {
    $w, $h = $t
    if ($DryRun) { Write-Host "dry-run: Set-DisplayResolution ${w}x${h} (available)"; break }
    try {
      Set-DisplayResolution -Width $w -Height $h -Force | Out-Null
      $after = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
      Write-Host "changed resolution: $($before.Width)x$($before.Height) -> $($after.Width)x$($after.Height)"
      exit 0
    } catch {
      Write-Warning "Set-DisplayResolution ${w}x${h} failed: $($_.Exception.Message)"
    }
  }
  if ($DryRun) { Write-Host "dry-run: Set-DisplayResolution available"; exit 0 }
}

# Fallback: user32 DEVMODE P/Invoke (some runners expose a basic display driver).
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class DisplayUtil {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct DEVMODE {
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmDeviceName;
    public short dmSpecVersion, dmDriverVersion, dmSize, dmDriverExtra;
    public int dmFields;
    public int dmPositionX, dmPositionY, dmDisplayOrientation, dmDisplayFixedOutput;
    public short dmColor, dmDuplex, dmYResolution, dmTTOption, dmCollate;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmFormName;
    public short dmLogPixels;
    public int dmBitsPerPel, dmPelsWidth, dmPelsHeight, dmDisplayFlags, dmDisplayFrequency;
    public int dmICMMethod, dmICMIntent, dmMediaType, dmDitherType,
               dmReserved1, dmReserved2, dmPanningWidth, dmPanningHeight;
  }
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern bool EnumDisplaySettings(string name, int mode, ref DEVMODE devMode);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int ChangeDisplaySettingsEx(string device, ref DEVMODE devMode,
    IntPtr hwnd, int flags, IntPtr param);
}
"@

foreach ($t in $targets) {
  $w, $h = $t
  if ($DryRun) {
    Write-Host "dry-run: would try ChangeDisplaySettingsEx ${w}x${h} via user32"
    continue
  }
  $dm = New-Object DisplayUtil+DEVMODE
  $dm.dmSize = [int16][System.Runtime.InteropServices.Marshal]::SizeOf($dm)
  $dm.dmPelsWidth = $w; $dm.dmPelsHeight = $h; $dm.dmBitsPerPel = 32
  $dm.dmFields = 0x80000 -bor 0x40000 -bor 0x80  # PELSWIDTH|PELSHEIGHT|BITSPERPEL
  $rc = [DisplayUtil]::ChangeDisplaySettingsEx($null, [ref]$dm, [IntPtr]::Zero, 2, [IntPtr]::Zero)
  if ($rc -eq 0) {
    $after = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    Write-Host "changed resolution: $($before.Width)x$($before.Height) -> $($after.Width)x$($after.Height)"
    exit 0
  }
  Write-Warning "ChangeDisplaySettingsEx ${w}x${h} failed (rc=$rc)"
}
if (-not $DryRun) { Write-Warning "could not change display resolution; continuing" }
exit 0
