import { Menu, nativeImage, Notification } from 'electron';
import { badgeDataUrl } from '../core/badgePng';
import { DevinApiClient, DevinApiError, sanitizeMessage, type DevinSession } from '../core/devinApi';
import {
  ACTIVE_POLL_MS,
  IDLE_POLL_MS,
  archivedScopes,
  backoffMs,
  diffStatuses,
  newPullRequests,
  pollInterval,
  prsForSession,
  sessionTitle,
  snapshotOf,
  waitingBody,
  type StatusSnapshot,
} from '../core/notifyModel';
import { sessionUrl } from '../core/sessions';
import type { SessionPr, Settings } from '../shared/ipc';
import { log } from './log';
import { route } from '../core/linkRouter';
import { handleLink, routeContext } from './routing';
import { state, testMode } from './state';
import { applyLayout, notifyShell } from './window';

const PAGE_SIZE = 100;

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

function notificationsEnabled(): boolean {
  return state.settings?.current.notifications.enabled ?? true;
}

// F1: PR auto-open also needs the poller, independently of toasts.
function autoOpenEnabled(): boolean {
  return state.settings?.current.prs.autoOpenTabs ?? true;
}

// OS toasts are suppressed under DEVIN_WORKSPACES_TEST unless explicitly re-enabled,
// so e2e runs don't spam the desktop; the log event is the test evidence.
function toastsAllowed(): boolean {
  if (testMode && process.env.DEVIN_WORKSPACES_TEST_TOAST !== '1') return false;
  return Notification.isSupported();
}

class Notifier {
  private timer: NodeJS.Timeout | null = null;
  private inFlight = false;
  private running = false;
  private snapshot: StatusSnapshot | null = null;
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
        enabled: notificationsEnabled(),
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
    this.snapshot = null;
    this.orgId = null;
    this.failures = 0;
    this.notBefore = 0;
    state.apiSessions = [];
    state.notifications = { waitingCount: 0, lastPollAt: null, authError: false, lastError: null };
    this.updateBadge(0);
    this.start();
    notifyShell();
  }

  onSettingsChanged(previous: Settings, next: Settings): void {
    if (
      previous.apiBase !== next.apiBase ||
      previous.notifications.enabled !== next.notifications.enabled ||
      previous.notifications.orgId !== next.notifications.orgId ||
      previous.prs.autoOpenTabs !== next.prs.autoOpenTabs
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
    if (!pat || (!notificationsEnabled() && !autoOpenEnabled())) {
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
      const next = snapshotOf(sessions);
      const diff = diffStatuses(this.snapshot, next);
      this.snapshot = next;
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
      state.notifications = {
        waitingCount: diff.waitingCount,
        lastPollAt: new Date().toISOString(),
        authError: false,
        lastError: null,
      };
      delay = pollInterval(sessions, base);
      log('shell', 'poll', {
        detail: {
          sessions: sessions.length,
          waiting: diff.waitingCount,
          newlyWaiting: diff.newlyWaiting.length,
          hasNextPage: page.hasNextPage,
          intervalMs: delay,
          durationMs: Date.now() - started,
        },
      });
      // Toasts and the badge stay gated on the notifications toggle; the poll
      // itself may be running only for PR auto-open.
      if (notificationsEnabled()) {
        for (const id of diff.newlyWaiting) {
          const session = sessions.find((item) => item.session_id === id);
          if (session) this.notify(session, next[id] ?? 'waiting_for_user');
        }
        this.updateBadge(diff.waitingCount);
      }
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

  private notify(session: DevinSession, status: string): void {
    const title = sessionTitle(session);
    const body = waitingBody(status);
    const toast = toastsAllowed();
    if (toast) {
      try {
        const notification = new Notification({ title, body, silent: false });
        notification.on('click', () => this.openSession(session.session_id, 'toast-click'));
        notification.show();
      } catch (error) {
        log('shell', 'notification-error', { detail: { message: String(error) } });
      }
    }
    log('shell', 'notification-shown', {
      detail: { sessionId: session.session_id, status, toast },
    });
  }

  openSession(sessionId: string, source: string): void {
    const url = sessionUrl(state.tenantUrl, sessionId);
    log('shell', 'notification-open', { url, detail: { sessionId, source } });
    handleLink(url, 'shell');
    state.surface = 'cloud';
    applyLayout();
    const windowRef = state.windowRef;
    if (windowRef && !windowRef.isDestroyed()) {
      if (windowRef.isMinimized()) windowRef.restore();
      windowRef.show();
      windowRef.focus();
    }
    state.devinView?.webContents.focus();
  }

  showTestNotification(): void {
    const toast = toastsAllowed();
    if (toast) {
      try {
        new Notification({
          title: 'Devin Workspaces',
          body: 'Notifications are working.',
          silent: false,
        }).show();
      } catch (error) {
        log('shell', 'notification-error', { detail: { message: String(error) } });
      }
    }
    log('shell', 'notification-shown', { detail: { sessionId: null, status: 'test', toast } });
  }

  private updateBadge(count: number): void {
    const windowRef = state.windowRef;
    if (!windowRef || windowRef.isDestroyed()) return;
    try {
      if (count <= 0) {
        windowRef.setOverlayIcon(null, '');
      } else {
        const image = nativeImage.createFromDataURL(badgeDataUrl(count));
        windowRef.setOverlayIcon(image, `${count} Devin session${count === 1 ? '' : 's'} waiting`);
      }
      log('shell', 'badge', { detail: { count } });
    } catch (error) {
      log('shell', 'badge-error', { detail: { message: String(error) } });
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
