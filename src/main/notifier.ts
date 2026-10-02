import { Menu } from 'electron';
import { notificationStore } from './notifications';
import { deriveNotifications } from '../core/notificationModel';
import { DevinApiClient, DevinApiError, sanitizeMessage, type DevinSession } from '../core/devinApi';
import {
  ACTIVE_POLL_MS,
  IDLE_POLL_MS,
  archivedScopes,
  backoffMs,
  newPullRequests,
  pollInterval,
  prsForSession,
} from '../core/notifyModel';
import { sessionUrl } from '../core/sessions';
import type { SessionPr, Settings } from '../shared/ipc';
import { log } from './log';
import { route } from '../core/linkRouter';
import { handleLink, loadInDevinView, routeContext } from './routing';
import { state, testMode } from './state';
import { installUpdate } from './updater';
import { applyLayout, notifyShell, setNotificationsPanel } from './window';

const PAGE_SIZE = 100;

function kindEnabled() {
  const k = state.settings?.current.notifications.kinds;
  return {
    waiting: k?.waiting ?? true,
    approval: k?.approval ?? true,
    blocked: k?.blocked ?? true,
    finished: k?.finished ?? false,
    'pr-opened': k?.prOpened ?? true,
    'pr-completed': k?.prCompleted ?? true,
    update: k?.update ?? true,
  };
}

// Test-only overrides: a short poll interval and a fixture API base.
function pollBase(): { active: number; idle: number } {
  if (testMode && process.env.DEVIN_WORKSPACES_POLL_MS) {
    const ms = Math.max(50, Number(process.env.DEVIN_WORKSPACES_POLL_MS) || 0);
    return { active: ms, idle: ms };
  }
  return { active: ACTIVE_POLL_MS, idle: IDLE_POLL_MS };
}

export function apiBase(): string {
  if (testMode && process.env.DEVIN_WORKSPACES_API_BASE) return process.env.DEVIN_WORKSPACES_API_BASE;
  return state.settings?.current.apiBase ?? 'https://api.devin.ai';
}

// P6: the poller runs whenever a token is present — the session list feeds
// notifications, PR quick-open and archived-scope cleanup regardless.
// autoOpenTabs only controls tab opening, not polling.
function autoOpenEnabled(): boolean {
  return state.settings?.current.prs.autoOpenTabs ?? true;
}

class Notifier {
  private timer: NodeJS.Timeout | null = null;
  private inFlight = false;
  private running = false;
  private failures = 0;
  private orgId: string | null = null;
  private generation = 0;
  private notBefore = 0;

  start(): void {
    if (this.running) return;
    this.running = true;
    this.generation += 1;
    log('shell', 'notifier-start', {
      detail: {
        collect: state.settings?.current.notifications.collect ?? true,
        autoOpenTabs: autoOpenEnabled(),
        hasToken: state.secrets?.hasPat() ?? false,
      },
    });
    this.schedule(0);
  }

  stop(reason = 'stop'): void {
    if (!this.running && !this.timer) return;
    this.running = false;
    this.generation += 1;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    log('shell', 'notifier-stop', { detail: { reason } });
  }

  // Token or settings changed: forget cached org/snapshot and poll again now.
  restart(reason: string): void {
    this.stop(reason);
    this.orgId = null;
    this.failures = 0;
    this.notBefore = 0;
    state.apiSessions = [];
    state.notifications = { lastPollAt: null, authError: false, lastError: null };
    this.start();
    notifyShell();
  }

  onSettingsChanged(previous: Settings, next: Settings): void {
    if (
      previous.apiBase !== next.apiBase ||
      previous.notifications.orgId !== next.notifications.orgId
    ) {
      this.restart('settings-changed');
    }
  }

  pollNow(): Promise<void> {
    return this.poll();
  }

  private schedule(delayMs: number): void {
    if (!this.running) return;
    if (this.timer) clearTimeout(this.timer);
    const generation = this.generation;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (generation !== this.generation) return;
      void this.poll();
    }, delayMs);
  }

  private async poll(): Promise<void> {
    if (this.inFlight || !this.running || state.shuttingDown) return;
    const pat = state.secrets?.getPat() ?? null;
    if (!pat) {
      // Nothing to do; re-check occasionally in case a token arrives via restart().
      this.schedule(pollBase().idle);
      return;
    }
    const now = Date.now();
    if (now < this.notBefore) {
      this.schedule(this.notBefore - now);
      return;
    }
    this.inFlight = true;
    const base = pollBase();
    let delay = base.idle;
    const started = Date.now();
    try {
      const client = new DevinApiClient({
        apiBase: apiBase(),
        token: pat,
        fetch: (url, init) => fetch(url, { ...init, signal: init.signal ?? null }),
      });
      if (!this.orgId) {
        const override = state.settings?.current.notifications.orgId?.trim();
        this.orgId = override || (await client.getSelf()).orgId;
        if (!this.orgId) {
          throw new DevinApiError('http', 'no org id for this token (set notifications.orgId)');
        }
        log('shell', 'notifier-org', { detail: { source: override ? 'settings' : 'self' } });
      }
      const page = await client.listSessions({ orgId: this.orgId, first: PAGE_SIZE });
      const sessions = page.sessions;
      this.failures = 0;
      // P8/Q3: close tabs whose session archived, or vanished from a complete
      // (single-page) list — a partial page can't prove absence.
      const previousSessions = state.apiSessions;
      state.apiSessions = sessions;
      for (const scope of archivedScopes(previousSessions, sessions, !page.hasNextPage)) {
        void state.tabManager?.closeScope(scope).then(() => {
          log('shell', 'tabs-scope-archived', { detail: { scope } });
        });
      }
      // F1: a session gained a PR since the last poll -> lazy background tab
      // in that session's scope. Only GitHub-class URLs become tabs.
      if (autoOpenEnabled() && state.tabManager) {
        let opened = 0;
        for (const pr of newPullRequests(previousSessions, sessions)) {
          const decision = route(pr.url, 'shell', 'new-window', routeContext());
          if (decision.kind !== 'gh-tab') continue;
          state.tabManager.open(pr.url, {
            background: true,
            originSessionId: pr.sessionId,
            lazy: true,
          });
          log('shell', 'pr-auto-open', { url: pr.url, detail: { sessionId: pr.sessionId } });
          opened += 1;
        }
        if (opened > 0) applyLayout();
      }
      // P6: derive in-app notifications from the session diff (baseline =
      // sessions absent from the previous poll).
      if (state.settings?.current.notifications.collect ?? true) {
        for (const entry of deriveNotifications(previousSessions, sessions, {
          enabled: kindEnabled(),
          now: Date.now(),
        })) {
          notificationStore().add(entry);
        }
      }
      state.notifications = {
        lastPollAt: new Date().toISOString(),
        authError: false,
        lastError: null,
      };
      delay = pollInterval(sessions, base);
      log('shell', 'poll', {
        detail: {
          sessions: sessions.length,
          hasNextPage: page.hasNextPage,
          intervalMs: delay,
          durationMs: Date.now() - started,
        },
      });
    } catch (error) {
      this.failures += 1;
      const apiError = error instanceof DevinApiError ? error : null;
      const kind = apiError?.kind ?? 'unknown';
      if (kind === 'auth' || kind === 'forbidden') {
        state.notifications = {
          ...state.notifications,
          authError: true,
          lastError: kind === 'auth' ? 'unauthorized' : 'forbidden',
        };
        // Do not clear a stale orgId/snapshot on auth errors; just slow down.
        delay = Math.max(base.idle, backoffMs(this.failures, base.active));
      } else if (kind === 'rateLimited') {
        const retryAfter = apiError?.retryAfterMs ?? null;
        delay = Math.max(retryAfter ?? backoffMs(this.failures, base.active), base.active);
        this.notBefore = Date.now() + delay;
        state.notifications = { ...state.notifications, lastError: 'rate limited' };
      } else {
        delay = backoffMs(this.failures, base.active);
        state.notifications = {
          ...state.notifications,
          lastError: sanitizeMessage(apiError?.message ?? String(error), pat),
        };
      }
      log('shell', 'poll-error', {
        detail: {
          kind,
          status: apiError?.status ?? null,
          retryAfterMs: apiError?.retryAfterMs ?? null,
          failures: this.failures,
          nextInMs: delay,
          message: sanitizeMessage(apiError?.message ?? String(error), pat),
        },
      });
    } finally {
      this.inFlight = false;
      notifyShell();
      this.schedule(delay);
    }
  }

}

export const notifier = new Notifier();

export function currentSessionPrs(): SessionPr[] {
  return prsForSession(state.apiSessions, state.currentSessionId);
}

// Native popup listing the current session's PRs; each item routes through
// handleLink so GitHub URLs land in the pane.
export function popupPrMenu(): number {
  const prs = currentSessionPrs();
  if (prs.length === 0 || !state.windowRef) return 0;
  const menu = Menu.buildFromTemplate(
    prs.map((pr) => ({
      label: pr.title,
      click: () => {
        log('shell', 'pr-open', { url: pr.url, detail: { sessionId: pr.sessionId } });
        handleLink(pr.url, 'shell');
      },
    })),
  );
  log('shell', 'pr-menu', { detail: { count: prs.length } });
  menu.popup({ window: state.windowRef });
  return prs.length;
}

// P6: opening a notification marks it read, navigates the devin view to the
// session (or installs the downloaded update), and a PR notification also
// focuses the PR tab in that session's pane.
export function openNotification(id: string): void {
  const store = notificationStore();
  const entry = store.entries().find((item) => item.id === id);
  if (!entry) return;
  store.markRead(id);
  setNotificationsPanel(false);
  log('shell', 'notification-open', {
    detail: { id, kind: entry.kind, sessionId: entry.sessionId },
  });
  if (entry.kind === 'update') {
    installUpdate();
    return;
  }
  if (entry.sessionId) loadInDevinView(sessionUrl(state.tenantUrl, entry.sessionId));
  state.surface = 'cloud';
  applyLayout();
  // Open the PR into the notification's session scope — the devin-view nav that
  // switches the visible scope races handleLink, so go through the tabManager.
  if (entry.prUrl && entry.sessionId) {
    state.tabManager?.open(entry.prUrl, { originSessionId: entry.sessionId });
  } else if (entry.prUrl) {
    handleLink(entry.prUrl, 'shell');
  }
  const windowRef = state.windowRef;
  if (windowRef && !windowRef.isDestroyed()) {
    if (windowRef.isMinimized()) windowRef.restore();
    windowRef.show();
    windowRef.focus();
  }
  state.devinView?.webContents.focus();
}
