import { useState, type CSSProperties, type FormEvent } from 'react';
import type { CredentialEntry } from '../../core/credentials';
import { isAllowedAppUrl } from '../../core/sessions';
import type { Settings } from '../../shared/ipc';
import { useShellState } from '../store';
import { NotificationSettings } from './NotificationSettings';
import { PasswordsSection } from './PasswordsSection';

interface SettingsPanelProps {
  settings: Settings;
  credentials: CredentialEntry[];
  style: CSSProperties;
}

function isValidUrl(value: string): boolean {
  return isAllowedAppUrl(value);
}

const inputClass =
  'w-full max-w-md px-2 py-1.5 rounded-md border border-[#39475a] bg-[#0d141d] text-sm text-[#e8edf5]';
const saveClass =
  'px-3 py-1.5 rounded-md border border-[#39475a] bg-[#1a2330] hover:bg-[#2a394d] text-sm disabled:hover:bg-[#1a2330]';

export function SettingsPanel({ settings, credentials, style }: SettingsPanelProps) {
  const [tenantUrl, setTenantUrl] = useState(settings.tenantUrl);
  const [apiBase, setApiBase] = useState(settings.apiBase);
  const [workspaces, setWorkspaces] = useState<string[]>(settings.workspaces);
  const [newWorkspace, setNewWorkspace] = useState('');
  const [allowExternal, setAllowExternal] = useState(settings.routing.allowExternal);
  const [keepAliveHours, setKeepAliveHours] = useState(String(settings.tabs.keepAliveHours));
  const [terminalAllSurfaces, setTerminalAllSurfaces] = useState(settings.terminal.allSurfaces);
  const [terminalShell, setTerminalShell] = useState(settings.terminal.shell);
  const [maxLiveTabs, setMaxLiveTabs] = useState(String(settings.tabs.maxLiveTabs));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const shell = useShellState();
  const update = shell?.update ?? null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!isValidUrl(tenantUrl)) {
      setError('Tenant URL must be an https URL (http allowed for localhost only)');
      return;
    }
    if (!isValidUrl(apiBase)) {
      setError('API base must be an https URL (http allowed for localhost only)');
      return;
    }
    const keepAlive = Number(keepAliveHours);
    if (!Number.isFinite(keepAlive) || keepAlive < 0 || keepAlive > 168) {
      setError('Keep-alive must be between 0 and 168 hours');
      return;
    }
    const maxLive = Number(maxLiveTabs);
    if (!Number.isInteger(maxLive) || maxLive < 1 || maxLive > 40) {
      setError('Max live tabs must be a whole number between 1 and 40');
      return;
    }
    setError(null);
    void window.devinworkspaces
      .setSettings({
        tenantUrl,
        apiBase,
        workspaces,
        routing: { allowExternal },
        tabs: { keepAliveHours: keepAlive, maxLiveTabs: maxLive },
        terminal: { allSurfaces: terminalAllSurfaces, shell: terminalShell.trim() },
      })
      .then(() => {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      });
  };

  return (
    <main id="settingsPanel" className="shell-chrome p-9 bg-[#111925] overflow-auto" style={style}>
      <h1 className="text-2xl mb-6">Settings</h1>
      {update && (
        <section id="aboutSection" className="flex flex-col gap-2 mb-6 text-sm">
          <p className="text-[#aeb9c8]">
            Version <span id="appVersion" className="font-mono text-[#e8edf5]">{update.version}</span>
          </p>
          {update.downloaded ? (
            <div id="updateStatus" data-update-state="ready" className="flex items-center gap-3 px-3 py-2 rounded-md border border-[#39475a] bg-[#1a2330]">
              <span>Update v{update.downloaded} is ready to install.</span>
              <button id="updateNow" type="button" className={saveClass} onClick={() => window.devinworkspaces.updateInstall()}>Update now</button>
            </div>
          ) : update.available ? (
            <p id="updateStatus" data-update-state="downloading" className="text-xs text-[#7f8ca0]">Update v{update.available} available — downloading…</p>
          ) : (
            <p id="updateStatus" data-update-state="none" className="text-xs text-[#7f8ca0]">You&apos;re up to date.</p>
          )}
        </section>
      )}
      <form onSubmit={submit} className="flex flex-col gap-5">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-[#aeb9c8]">Tenant URL</span>
          <input
            id="tenantUrlInput"
            className={inputClass}
            value={tenantUrl}
            onChange={(event) => setTenantUrl(event.target.value)}
            placeholder="https://cloudbeds.devinenterprise.com"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-[#aeb9c8]">API base</span>
          <input
            id="apiBaseInput"
            className={inputClass}
            value={apiBase}
            onChange={(event) => setApiBase(event.target.value)}
            placeholder="https://api.devin.ai"
          />
        </label>
        <div className="flex flex-col gap-1 text-sm">
          <span className="text-[#aeb9c8]">Workspaces</span>
          <ul className="flex flex-col gap-1 max-w-md">
            {workspaces.map((workspace) => (
              <li key={workspace} className="flex items-center gap-2">
                <span className="flex-1 truncate font-mono text-xs">{workspace}</span>
                <button
                  type="button"
                  className={saveClass}
                  onClick={() =>
                    setWorkspaces(workspaces.filter((entry) => entry !== workspace))
                  }
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <div className="flex gap-2 max-w-md">
            <input
              id="workspaceInput"
              className={inputClass}
              value={newWorkspace}
              onChange={(event) => setNewWorkspace(event.target.value)}
              placeholder="C:\path\to\workspace"
            />
            <button
              type="button"
              className={saveClass}
              onClick={() => {
                const value = newWorkspace.trim();
                if (value && !workspaces.includes(value)) {
                  setWorkspaces([...workspaces, value]);
                }
                setNewWorkspace('');
              }}
            >
              Add
            </button>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            id="allowExternalInput"
            type="checkbox"
            checked={allowExternal}
            onChange={(event) => setAllowExternal(event.target.checked)}
          />
          <span>Open non-GitHub links in system browser</span>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-[#aeb9c8]">Keep hidden tabs live for (hours, 0 = discard on switch)</span>
          <input
            id="keepAliveInput"
            className={inputClass}
            type="number"
            min={0}
            max={168}
            step={1}
            value={keepAliveHours}
            onChange={(event) => setKeepAliveHours(event.target.value)}
          />
          <span className="text-xs text-[#7f8ca0]">
            Tabs from other sessions stay live for this long; beyond it they reload on activation.
          </span>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-[#aeb9c8]">Max live tabs</span>
          <input
            id="maxLiveTabsInput"
            className={inputClass}
            type="number"
            min={1}
            max={40}
            step={1}
            value={maxLiveTabs}
            onChange={(event) => setMaxLiveTabs(event.target.value)}
          />
          <span className="text-xs text-[#7f8ca0]">
            Hard cap on live GitHub pages across all sessions (≈400 MB each); the tab you're looking at is exempt.
          </span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            id="terminalAllSurfacesInput"
            type="checkbox"
            checked={terminalAllSurfaces}
            onChange={(event) => setTerminalAllSurfaces(event.target.checked)}
          />
          <span>Show terminal dock on Local and Settings too</span>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-[#aeb9c8]">Shell command</span>
          <input
            id="terminalShellInput"
            className="w-full max-w-md px-2 py-1.5 rounded-md border border-[#39475a] bg-[#0d141d] text-sm text-[#e8edf5]"
            value={terminalShell}
            onChange={(event) => setTerminalShell(event.target.value)}
            placeholder={
              window.devinworkspaces.platform === 'darwin'
                ? 'e.g. /bin/zsh -l'
                : 'e.g. pwsh.exe or wsl.exe -d Ubuntu'
            }
          />
          <span className="text-xs text-[#7f8ca0]">
            Blank = Windows Terminal default profile, else PowerShell.
          </span>
        </label>
        {error && <p className="text-sm text-[#ff8a8a]">{error}</p>}
        <div className="flex items-center gap-3">
          <button id="settingsSave" type="submit" className={saveClass}>
            Save
          </button>
          {saved && <span className="text-sm text-[#8fd18f]">Saved</span>}
        </div>
        <p className="text-xs text-[#7f8ca0]">
          Restart not required — Cloud view reloads on tenant change.
        </p>
      </form>
      <PasswordsSection credentials={credentials} tenantUrl={settings.tenantUrl} />
      <NotificationSettings />
    </main>
  );
}
