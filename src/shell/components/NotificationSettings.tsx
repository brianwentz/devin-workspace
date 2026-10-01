import { useEffect, useState, type FormEvent } from 'react';
import { useShellState } from '../store';

const inputClass =
  'w-full max-w-md px-2 py-1.5 rounded-md border border-[#39475a] bg-[#0d141d] text-sm text-[#e8edf5]';
const buttonClass =
  'px-3 py-1.5 rounded-md border border-[#39475a] bg-[#1a2330] hover:bg-[#2a394d] text-sm disabled:opacity-50 disabled:hover:bg-[#1a2330]';

// P5: Devin API token (stored encrypted in main; never read back), the
// notifications toggle, optional org override and a test-toast button.
export function NotificationSettings() {
  const shell = useShellState();
  const [token, setToken] = useState('');
  const [hasToken, setHasToken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [orgId, setOrgId] = useState('');
  const notifications = shell?.notifications;
  const notificationsEnabled = shell?.settings.notifications.enabled ?? true;
  const notificationsHasToken = notifications?.hasToken ?? false;
  const savedOrgId = shell?.settings.notifications.orgId ?? '';

  useEffect(() => {
    setHasToken(notificationsHasToken);
  }, [notificationsHasToken]);
  useEffect(() => {
    setOrgId(savedOrgId);
  }, [savedOrgId]);

  const refreshHasToken = () =>
    window.devinworkspaces.hasPat().then(setHasToken).catch(() => undefined);

  const saveToken = (event: FormEvent) => {
    event.preventDefault();
    const value = token.trim();
    if (value.length < 10) {
      setMessage({ kind: 'error', text: 'Token must be at least 10 characters.' });
      return;
    }
    setBusy(true);
    void window.devinworkspaces
      .setPat(value)
      .then((result) => {
        if (result.ok) {
          setToken('');
          setMessage({ kind: 'ok', text: 'Token stored (encrypted).' });
        } else {
          setMessage({ kind: 'error', text: result.error });
        }
        return refreshHasToken();
      })
      .finally(() => setBusy(false));
  };

  const clearToken = () => {
    setBusy(true);
    void window.devinworkspaces
      .clearPat()
      .then((result) => {
        setMessage(
          result.ok
            ? { kind: 'ok', text: 'Token removed.' }
            : { kind: 'error', text: result.error },
        );
        return refreshHasToken();
      })
      .finally(() => setBusy(false));
  };

  const toggleEnabled = (enabled: boolean) => {
    void window.devinworkspaces.setSettings({ notifications: { enabled } });
  };

  const saveOrgId = () => {
    void window.devinworkspaces.setSettings({ notifications: { orgId: orgId.trim() } });
  };

  if (!notifications) return null;
  const status = !hasToken
    ? 'No token stored.'
    : notifications.authError
      ? `Token rejected by the API (${notifications.lastError ?? 'unauthorized'}).`
      : notifications.lastPollAt
        ? `Token stored (encrypted). Last poll ${new Date(notifications.lastPollAt).toLocaleTimeString()}${
            notifications.lastError ? ` — ${notifications.lastError}` : ''
          }.`
        : 'Token stored (encrypted). Waiting for first poll…';

  return (
    <section id="notificationSettings" className="flex flex-col gap-4 mt-8 pt-6 border-t border-[#243040]">
      <h2 className="text-lg">Notifications</h2>
      <form onSubmit={saveToken} className="flex flex-col gap-1 text-sm">
        <span className="text-[#aeb9c8]">Devin API token</span>
        <div className="flex gap-2 max-w-md">
          <input
            id="patInput"
            type="password"
            autoComplete="off"
            className={inputClass}
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="Personal access token or service-user token"
          />
          <button id="patSave" type="submit" className={buttonClass} disabled={busy || token.trim().length < 10}>
            Save
          </button>
          <button
            id="patClear"
            type="button"
            className={buttonClass}
            disabled={busy || !hasToken}
            onClick={clearToken}
          >
            Clear
          </button>
        </div>
        <p
          id="patStatus"
          data-has-token={hasToken ? 'true' : 'false'}
          className={`text-xs ${notifications.authError ? 'text-[#ff8a8a]' : 'text-[#7f8ca0]'}`}
        >
          {status}
        </p>
        {message && (
          <p className={`text-xs ${message.kind === 'ok' ? 'text-[#8fd18f]' : 'text-[#ff8a8a]'}`}>
            {message.text}
          </p>
        )}
        <p className="text-xs text-[#7f8ca0]">
          Use a Devin PAT or service-user token with ViewOrgSessions (not the CLI&apos;s Windsurf
          token). Stored with OS encryption; never shown again.
        </p>
      </form>
      <label className="flex items-center gap-2 text-sm">
        <input
          id="notificationsEnabledInput"
          type="checkbox"
          checked={notificationsEnabled}
          onChange={(event) => toggleEnabled(event.target.checked)}
        />
        <span>Notify me when a session is waiting for me</span>
        {notifications.waitingCount > 0 && (
          <span id="waitingCount" className="text-xs text-[#e0a03c]">
            {notifications.waitingCount} waiting
          </span>
        )}
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-[#aeb9c8]">Organization ID (optional override)</span>
        <div className="flex gap-2 max-w-md">
          <input
            id="orgIdInput"
            className={inputClass}
            value={orgId}
            onChange={(event) => setOrgId(event.target.value)}
            placeholder="org-… (blank = resolve from /v3/self)"
          />
          <button type="button" className={buttonClass} onClick={saveOrgId}>
            Save
          </button>
        </div>
      </label>
      <div>
        <button
          id="testNotification"
          type="button"
          className={buttonClass}
          onClick={() => window.devinworkspaces.testNotification()}
        >
          Test notification
        </button>
      </div>
    </section>
  );
}
