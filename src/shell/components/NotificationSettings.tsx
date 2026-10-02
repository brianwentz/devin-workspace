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
  const collect = shell?.settings.notifications.collect ?? true;
  const banner = shell?.settings.notifications.banner ?? true;
  const kinds = shell?.settings.notifications.kinds;
  const notificationsHasToken = notifications?.hasToken ?? false;
  const savedOrgId = shell?.settings.notifications.orgId ?? '';
  const autoOpenTabs = shell?.settings.prs.autoOpenTabs ?? true;

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

  const toggleCollect = (enabled: boolean) => {
    void window.devinworkspaces.setSettings({ notifications: { collect: enabled } });
  };
  const toggleBanner = (enabled: boolean) => {
    void window.devinworkspaces.setSettings({ notifications: { banner: enabled } });
  };
  const toggleKind = (
    key: 'waiting' | 'approval' | 'blocked' | 'finished' | 'prOpened' | 'prCompleted' | 'update',
    enabled: boolean,
  ) => {
    void window.devinworkspaces.setSettings({ notifications: { kinds: { [key]: enabled } } });
  };

  const toggleAutoOpenTabs = (enabled: boolean) => {
    void window.devinworkspaces.setSettings({ prs: { autoOpenTabs: enabled } });
  };

  const saveOrgId = () => {
    void window.devinworkspaces.setSettings({ notifications: { orgId: orgId.trim() } });
  };

  if (!notifications) return null;
  const status = !hasToken
    ? 'No token stored.'
    : notifications.noUserIdentity
      ? 'Token has no user identity (service user) — sessions and notifications are disabled'
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
        {notifications.noUserIdentity && (
          <p id="patNoUser" className="text-xs text-[#ffcc80]">
            This token has no user identity (service user), so no sessions, notifications or pull
            requests are shown. Use a personal API token.
          </p>
        )}
        {message && (
          <p className={`text-xs ${message.kind === 'ok' ? 'text-[#8fd18f]' : 'text-[#ff8a8a]'}`}>
            {message.text}
          </p>
        )}
        <p className="text-xs text-[#7f8ca0]">
          Use a personal Devin API token (not the CLI&apos;s Windsurf token): the app only shows
          sessions, notifications and pull requests created by the token&apos;s user, so service-user
          tokens show nothing. Stored with OS encryption; never shown again.
        </p>
      </form>
      <label className="flex items-center gap-2 text-sm">
        <input
          id="notificationsCollectInput"
          type="checkbox"
          checked={collect}
          onChange={(event) => toggleCollect(event.target.checked)}
        />
        <span>Collect notifications</span>
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          id="notificationsBannerInput"
          type="checkbox"
          checked={banner}
          onChange={(event) => toggleBanner(event.target.checked)}
        />
        <span>Show banner for new notifications</span>
      </label>
      <fieldset className="flex flex-col gap-1 text-sm">
        <span className="text-[#aeb9c8] text-xs">Notify me for</span>
        {(
          [
            ['waiting', 'Waiting for reply'],
            ['approval', 'Needs approval'],
            ['blocked', 'Blocked'],
            ['finished', 'Session finished'],
            ['prOpened', 'PR opened'],
            ['prCompleted', 'PR merged or closed'],
            ['update', 'App updates'],
          ] as const
        ).map(([key, label]) => (
          <label key={key} className="flex items-center gap-2">
            <input
              id={`notificationKind-${key}`}
              type="checkbox"
              checked={kinds?.[key] ?? true}
              onChange={(event) => toggleKind(key, event.target.checked)}
            />
            <span>{label}</span>
          </label>
        ))}
      </fieldset>
      <label className="flex items-center gap-2 text-sm">
        <input
          id="prAutoOpenTabsInput"
          type="checkbox"
          checked={autoOpenTabs}
          onChange={(event) => toggleAutoOpenTabs(event.target.checked)}
        />
        <span>Open a tab when a session creates a PR</span>
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
    </section>
  );
}
