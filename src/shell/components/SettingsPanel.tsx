import { useState, type CSSProperties, type FormEvent } from 'react';
import { normalizeOrigin, SUGGESTED_ORIGINS, type CredentialEntry } from '../../core/credentials';
import { isAllowedAppUrl } from '../../core/sessions';
import type { Settings } from '../../shared/ipc';
import { NotificationSettings } from './NotificationSettings';

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

function CredentialsSection({
  credentials,
  tenantUrl,
}: {
  credentials: CredentialEntry[];
  tenantUrl: string;
}) {
  const tenantOrigin = normalizeOrigin(tenantUrl);
  const originOptions = [...SUGGESTED_ORIGINS, ...(tenantOrigin ? [tenantOrigin] : [])];
  const [originChoice, setOriginChoice] = useState(originOptions[0] ?? 'custom');
  const [customOrigin, setCustomOrigin] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    const raw = originChoice === 'custom' ? customOrigin : originChoice;
    const origin = normalizeOrigin(raw);
    if (!origin) {
      setError('Origin must be a valid https:// origin');
      return;
    }
    if (!username || !password) {
      setError('Username and password are required');
      return;
    }
    setError(null);
    void window.devinworkspaces
      .saveCredential({ origin, username, password })
      .then((result) => {
        if (!result.ok) setError(result.error);
        else {
          setUsername('');
          setPassword('');
        }
      });
  };

  return (
    <section id="credentialsSection" className="flex flex-col gap-3 border-t border-[#39475a] pt-5">
      <h2 className="text-lg">Credentials</h2>
      <p className="text-xs text-[#7f8ca0] max-w-md">
        Click a login field in the page, then use the key button in the rail to fill it. Stored
        encrypted with Windows DPAPI for your Windows account.
      </p>
      <ul className="flex flex-col gap-1 max-w-md">
        {credentials.map((credential) => (
          <li key={credential.origin} className="flex items-center gap-2 text-sm">
            <span className="flex-1 truncate font-mono text-xs">
              {credential.origin} — {credential.username}
            </span>
            <button
              type="button"
              className={saveClass}
              onClick={() => void window.devinworkspaces.deleteCredential(credential.origin)}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-2 max-w-md">
        <select
          id="credentialOrigin"
          className={inputClass}
          value={originChoice}
          onChange={(event) => setOriginChoice(event.target.value)}
        >
          {originOptions.map((origin) => (
            <option key={origin} value={origin}>
              {origin}
            </option>
          ))}
          <option value="custom">Custom…</option>
        </select>
        {originChoice === 'custom' && (
          <input
            id="credentialOriginCustom"
            className={inputClass}
            value={customOrigin}
            onChange={(event) => setCustomOrigin(event.target.value)}
            placeholder="https://login.example.com"
          />
        )}
        <input
          id="credentialUsername"
          className={inputClass}
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          placeholder="Username"
          autoComplete="off"
        />
        <input
          id="credentialPassword"
          className={inputClass}
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Password"
          autoComplete="off"
        />
        <div className="flex items-center gap-3">
          <button id="credentialSave" type="button" className={saveClass} onClick={save}>
            Save credential
          </button>
          {error && <span className="text-sm text-[#ff8a8a]">{error}</span>}
        </div>
      </div>
      <p className="text-xs text-[#7f8ca0] max-w-md">
        Sign-in tips: Prefer passkeys — enroll a passkey (Windows Hello) at Okta and GitHub for
        one-prompt sign-in.
      </p>
    </section>
  );
}

export function SettingsPanel({ settings, credentials, style }: SettingsPanelProps) {
  const [tenantUrl, setTenantUrl] = useState(settings.tenantUrl);
  const [apiBase, setApiBase] = useState(settings.apiBase);
  const [workspaces, setWorkspaces] = useState<string[]>(settings.workspaces);
  const [newWorkspace, setNewWorkspace] = useState('');
  const [allowExternal, setAllowExternal] = useState(settings.routing.allowExternal);
  const [keepAliveHours, setKeepAliveHours] = useState(String(settings.tabs.keepAliveHours));
  const [terminalAllSurfaces, setTerminalAllSurfaces] = useState(settings.terminal.allSurfaces);
  const [maxLiveTabs, setMaxLiveTabs] = useState(String(settings.tabs.maxLiveTabs));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

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
        terminal: { allSurfaces: terminalAllSurfaces },
      })
      .then(() => {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      });
  };

  return (
    <main id="settingsPanel" className="shell-chrome p-9 bg-[#111925] overflow-auto" style={style}>
      <h1 className="text-2xl mb-6">Settings</h1>
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
      <CredentialsSection credentials={credentials} tenantUrl={settings.tenantUrl} />
      <NotificationSettings />
    </main>
  );
}
