// Cloud session sidebar data layer. Opens a JSON-RPC websocket to
// wss://<tenant>/api/acp/live using the web app's own access token — which is
// read inside the devinView via executeJavaScript and never leaves this
// class. No titles/folder names/user ids/tokens are ever logged.

import { app, net } from 'electron';
import { readFileSync } from 'node:fs';
import {
  acpWsUrl,
  buildFolderPageParams,
  buildInitializeParams,
  buildListParams,
  parseListResult,
  parseUsersInfo,
  sanitizeToken,
  usersInfoUrl,
  type CloudListResult,
  type CloudSession,
} from '../core/cloudAcp';
import { CloudSessionSchema, type CloudState } from '../shared/ipc';
import { z } from 'zod';
import { log } from './log';
import { cloudViews } from './cloudViews';
import { parseSessionId } from '../core/sessions';
import { originOf, state, testMode } from './state';
import { applyLayout, notifyShell } from './window';

const TOKEN_BACKOFF_MIN_MS = 2_000;
const TOKEN_BACKOFF_MAX_MS = 20_000;
const TOKEN_GRACE_MS = 90_000;
const REQUEST_TIMEOUT_MS = 20_000;
const LIST_TIMEOUT_MS = 30_000;
const TOKEN_TIMEOUT_MS = 15_000;
const POLL_FOCUSED_MS = 15_000;
const POLL_IDLE_MS = 60_000;
const BACKOFF_MIN_MS = 2_000;
const BACKOFF_MAX_MS = 60_000;
const FOLDER_PAGE_SIZE = 20;

const FixtureSchema = z.object({
  sessions: z.array(CloudSessionSchema),
  folders: z.array(z.string()).default([]),
  folderTotals: z.record(z.string(), z.number()).default({}),
  nextCursor: z.string().nullable().default(null),
});

type Pending = {
  resolve: (message: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

class CloudSessions {
  private token: string | null = null;
  // Kept so error messages logged after a rotation are still scrubbed.
  private lastToken: string | null = null;
  private orgId: string | null = null;
  private userId: string | null = null;
  private userPreferencesUrl: string | null = null;
  private socket: WebSocket | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private sessions: CloudSession[] = [];
  private folders: string[] = [];
  private folderTotals: Record<string, number> = {};
  private status: CloudState['status'] = 'disabled';
  private lastSyncAt: string | null = null;
  private error: string | null = null;
  private backoffMs = BACKOFF_MIN_MS;
  private retryTimer: NodeJS.Timeout | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private lastSnapshotJson = '';
  private started = false;
  private fixtureFile: string | null = null;
  private folderOffsets = new Map<string, number>();
  private unsubActiveNavigate: (() => void) | null = null;
  private tokenInFlight: Promise<void> | null = null;
  private tokenBackoffMs = TOKEN_BACKOFF_MIN_MS;
  private firstTokenAttemptAt: number | null = null;
  private listInFlight = false;
  private listDirty: string | null = null;
  private readonly onViewReady = () => {
    if (!this.token) void this.obtainToken();
  };

  snapshot(): CloudState {
    return {
      status: this.status,
      lastSyncAt: this.lastSyncAt,
      error: this.error,
      folders: this.folders,
      folderTotals: this.folderTotals,
      sessions: this.sessions,
      liveSessionIds: cloudViews().publicInfo().liveSessionIds,
    };
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    if (testMode) {
      this.fixtureFile = process.env.DEVIN_WORKSPACES_TEST_CLOUD_SESSIONS ?? null;
      if (this.fixtureFile) {
        this.loadFixture('start');
      } else {
        // The fixture tenant has no devinDebug — stay inert.
        this.setStatus('disabled');
      }
      this.emit();
      return;
    }
    this.setStatus('connecting');
    // The pool fires this on every active-view navigation/finish-load AND on
    // each activation — the token re-read gates itself on the tenant URL.
    this.unsubActiveNavigate = cloudViews().onActiveNavigate(this.onViewReady);
    this.emit();
    void this.obtainToken();
  }

  stop(): void {
    this.started = false;
    this.clearTimers();
    this.unsubActiveNavigate?.();
    this.unsubActiveNavigate = null;
    this.closeSocket();
  }

  refresh(reason: string): void {
    if (this.fixtureFile) {
      this.loadFixture(reason);
      return;
    }
    if (!this.started || (testMode && !this.fixtureFile)) return;
    if (!this.token) {
      void this.obtainToken();
      return;
    }
    if (this.socket?.readyState === WebSocket.OPEN) {
      void this.list(reason);
    }
  }

  loadMore(folder: string): void {
    // Fixture mode has no live socket — paging is a no-op there.
    if (this.fixtureFile || !this.started) return;
    if (this.socket?.readyState !== WebSocket.OPEN || !this.orgId) return;
    const rootsOffset =
      this.folderOffsets.get(folder) ??
      this.sessions.filter((s) => s.folder === folder).length;
    const params = buildFolderPageParams({
      orgId: this.orgId,
      userId: this.userId,
      folder,
      rootsOffset,
    });
    void this.request('session/list', params, LIST_TIMEOUT_MS)
      .then((message) => {
        const result = parseListResult(message.result, this.orgId!);
        const seen = new Set(this.sessions.map((s) => s.id));
        const fresh = result.sessions.filter((s) => !seen.has(s.id));
        this.sessions = [...this.sessions, ...fresh];
        this.folderOffsets.set(folder, rootsOffset + fresh.length);
        if (Object.keys(result.folderTotals).length) {
          this.folderTotals = { ...this.folderTotals, ...result.folderTotals };
        }
        const total = this.folderTotals[folder];
        log('cloud', 'cloud-more', {
          detail: { count: fresh.length, hasMore: total != null && total > rootsOffset + fresh.length },
        });
        this.emit();
      })
      .catch((error: unknown) => {
        this.onError('list-more', error);
      });
  }

  // Sidebar row click: the stored url is verified against the tenant before
  // navigating so a tampered payload can't steer the Cloud view.
  openSession(sessionId: string): void {
    const session = this.sessions.find((s) => s.id === sessionId);
    if (!session || parseSessionId(session.url, state.tenantUrl) !== sessionId) {
      log('cloud', 'cloud-open', { detail: { sessionId, found: false } });
      return;
    }
    state.surface = 'cloud';
    cloudViews().show(sessionId, session.url);
    applyLayout();
    log('cloud', 'cloud-open', { detail: { sessionId } });
  }

  prefetchSession(sessionId: string): void {
    if (this.status !== 'ready') return;
    const session = this.sessions.find((s) => s.id === sessionId);
    if (!session || parseSessionId(session.url, state.tenantUrl) !== sessionId) return;
    cloudViews().prefetch(sessionId, session.url);
  }

  // --- fixture mode -------------------------------------------------------

  private loadFixture(reason: string): void {
    try {
      const parsed = FixtureSchema.parse(JSON.parse(readFileSync(this.fixtureFile!, 'utf8')));
      this.sessions = parsed.sessions;
      this.folders = parsed.folders;
      this.folderTotals = parsed.folderTotals;
      this.error = null;
      this.lastSyncAt = new Date().toISOString();
      this.setStatus('ready');
      log('cloud', 'cloud-list', {
        detail: {
          count: this.sessions.length,
          folders: this.folders.length,
          durationMs: 0,
          reason: `fixture-${reason}`,
        },
      });
    } catch (error) {
      this.setStatus('error', String(error));
      log('cloud', 'cloud-error', { detail: { kind: 'fixture', message: String(error).slice(0, 200) } });
    }
    this.emit();
  }

  // --- token acquisition --------------------------------------------------

  private obtainToken(): Promise<void> {
    if (testMode) return Promise.resolve(); // no devinDebug on the fixture tenant
    if (this.tokenInFlight) return this.tokenInFlight;
    const work = this.obtainTokenInner().finally(() => {
      this.tokenInFlight = null;
    });
    this.tokenInFlight = work;
    return work;
  }

  private async obtainTokenInner(): Promise<void> {
    // A did-navigate-triggered call must not race a pending retry timer —
    // whoever runs first clears it so connect() can't fire twice.
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    // Already live or mid-handshake — don't churn a healthy socket.
    if (
      this.token &&
      (this.socket?.readyState === WebSocket.OPEN ||
        this.socket?.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }
    this.firstTokenAttemptAt ??= Date.now();
    const contents = state.devinView?.webContents;
    const tenantOrigin = originOf(state.tenantUrl);
    if (
      !contents ||
      contents.isDestroyed() ||
      contents.isLoading() ||
      originOf(contents.getURL()) !== tenantOrigin
    ) {
      this.onTokenFailure('view-not-ready');
      return;
    }
    try {
      const credentials = (await Promise.race([
        contents.executeJavaScript(
          'window.devinDebug?.getAccessToken ? window.devinDebug.getAccessToken().then(t => [t, window.devinDebug.getOrgId()]) : null',
        ),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('token timeout')), TOKEN_TIMEOUT_MS),
        ),
      ])) as [string | null, string] | null;
      const token = credentials?.[0] ?? null;
      const orgId = credentials?.[1] ?? null;
      if (!token || !orgId) {
        this.onTokenFailure(credentials === null ? 'no-devindebug' : 'login-required');
        return;
      }
      this.token = token;
      this.lastToken = token;
      this.orgId = orgId;
      this.backoffMs = BACKOFF_MIN_MS;
      this.tokenBackoffMs = TOKEN_BACKOFF_MIN_MS;
      this.firstTokenAttemptAt = null;
      log('cloud', 'cloud-token', { detail: { ok: true } });
      this.emit();
      this.connect();
    } catch (error) {
      const message = String(error);
      this.onTokenFailure(
        message === 'Error: token timeout'
          ? 'timeout'
          : /login required/i.test(message)
            ? 'login-required'
            : 'error',
      );
    }
  }

  // Every obtainToken failure path funnels here. Never clobber a live or
  // handshaking connection's status; 'no-token' means signed out — a still-
  // bootstrapping tenant page is 'connecting', not 'no-token'.
  private onTokenFailure(
    reason: 'view-not-ready' | 'no-devindebug' | 'login-required' | 'timeout' | 'error',
  ): void {
    if (
      this.token &&
      (this.socket?.readyState === WebSocket.OPEN ||
        this.socket?.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }
    const contents = state.devinView?.webContents;
    const viewOrigin =
      contents && !contents.isDestroyed() ? originOf(contents.getURL()) : null;
    const tenantOrigin = originOf(state.tenantUrl);
    // Sitting on an external login page (Okta/auth.devin.ai) is a real
    // signed-out signal; about:blank ('null' origin) and the tenant origin are
    // just "still bootstrapping".
    const externalLogin =
      viewOrigin !== null && viewOrigin !== 'null' && viewOrigin !== tenantOrigin;
    const graceExpired =
      this.firstTokenAttemptAt !== null &&
      Date.now() - this.firstTokenAttemptAt > TOKEN_GRACE_MS;
    this.setStatus(externalLogin || graceExpired ? 'no-token' : 'connecting');
    log('cloud', 'cloud-token', { detail: { ok: false, reason } });
    this.scheduleRetry(this.tokenBackoffMs);
    this.tokenBackoffMs = Math.min(this.tokenBackoffMs * 2, TOKEN_BACKOFF_MAX_MS);
    this.emit();
  }

  // --- websocket ----------------------------------------------------------

  private connect(): void {
    if (!this.token || !this.orgId) return;
    this.closeSocket();
    this.setStatus('connecting');
    this.emit();
    const socket = new WebSocket(acpWsUrl(state.tenantUrl, this.token, this.orgId));
    this.socket = socket;

    socket.addEventListener('message', (event) => {
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      const id = typeof message.id === 'number' ? message.id : null;
      if (id !== null && this.pending.has(id)) {
        const entry = this.pending.get(id)!;
        this.pending.delete(id);
        clearTimeout(entry.timer);
        entry.resolve(message);
      }
    });
    socket.addEventListener('close', (event) => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.failPending('ws closed');
      log('cloud', 'cloud-close', { detail: { code: event.code } });
      this.scheduleReconnect();
    });
    socket.addEventListener('error', () => {
      // 'close' follows — reconnect logic lives there.
    });
    socket.addEventListener('open', () => {
      void this.handshake(socket);
    });
  }

  private async handshake(socket: WebSocket): Promise<void> {
    try {
      const init = await this.request('initialize', buildInitializeParams(app.getVersion()));
      if (init.error) {
        const rpcError = init.error as { code?: unknown; message?: unknown };
        this.onRpcError('initialize', rpcError);
        this.closeSocket();
        this.scheduleReconnect();
        return;
      }
      const initResult = init.result as Record<string, unknown> | undefined;
      const prefsUrl = (
        (initResult?.agentCapabilities as Record<string, unknown> | undefined)?._meta as
          | Record<string, unknown>
          | undefined
      )?.['cognition.ai/userPreferencesUrl'];
      this.userPreferencesUrl = typeof prefsUrl === 'string' ? prefsUrl : null;
      const protocolVersion =
        typeof initResult?.protocolVersion === 'number' ? initResult.protocolVersion : undefined;
      log('cloud', 'cloud-connect', { detail: { ok: true, protocolVersion } });
      this.backoffMs = BACKOFF_MIN_MS;
      await this.identify();
      await this.list('connect');
      this.setStatus('ready');
      this.emit();
      this.schedulePoll();
    } catch (error) {
      if (this.socket !== socket) return;
      this.onError('handshake', error);
      this.closeSocket();
      this.scheduleReconnect();
    }
  }

  private async identify(): Promise<void> {
    const urls = [usersInfoUrl(state.tenantUrl)];
    if (this.userPreferencesUrl && /^https:\/\//.test(this.userPreferencesUrl)) {
      urls.push(this.userPreferencesUrl);
    }
    for (const url of urls) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        const response = await net.fetch(url, {
          headers: {
            authorization: `Bearer ${this.token}`,
            'x-cog-org-id': this.orgId ?? '',
            accept: 'application/json',
          },
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (response.status >= 200 && response.status < 300) {
          const info = parseUsersInfo(await response.json());
          this.userId = info.userId;
          log('cloud', 'cloud-identity', { detail: { ok: true, status: response.status } });
          return;
        }
        log('cloud', 'cloud-identity', { detail: { ok: false, status: response.status } });
      } catch (error) {
        log('cloud', 'cloud-identity', {
          detail: { ok: false, message: this.scrub(String(error)) },
        });
      }
    }
    // Proceed without the participant filter — the list still works.
    this.userId = null;
  }

  private async list(reason: string): Promise<void> {
    if (!this.orgId) return;
    // Coalesce: a queued list just marks dirty and one follow-up runs after.
    if (this.listInFlight) {
      this.listDirty = reason;
      return;
    }
    this.listInFlight = true;
    try {
      await this.listOnce(reason);
    } finally {
      this.listInFlight = false;
      if (this.listDirty !== null) {
        const next = this.listDirty;
        this.listDirty = null;
        // The failed list closed the socket — the reconnect path re-lists
        // ('connect') anyway, so don't fire a doomed request.
        if (this.socket?.readyState === WebSocket.OPEN) void this.list(next);
      }
    }
  }

  private async listOnce(reason: string): Promise<void> {
    const orgId = this.orgId!;
    const startedAt = Date.now();
    try {
      const message = await this.request(
        'session/list',
        buildListParams({ orgId, userId: this.userId }),
        LIST_TIMEOUT_MS,
      );
      if (message.error) {
        const rpcError = message.error as { code?: unknown; message?: unknown };
        this.onRpcError('list', rpcError);
        return;
      }
      const result: CloudListResult = parseListResult(message.result, orgId);
      this.sessions = result.sessions;
      this.folders = result.folders;
      this.folderTotals = result.folderTotals;
      // Keep loadMore offsets aligned with what the fresh page contains.
      this.folderOffsets.clear();
      for (const session of result.sessions) {
        if (session.folder !== null) {
          this.folderOffsets.set(
            session.folder,
            (this.folderOffsets.get(session.folder) ?? 0) + 1,
          );
        }
      }
      this.lastSyncAt = new Date().toISOString();
      this.error = null;
      this.setStatus('ready');
      log('cloud', 'cloud-list', {
        detail: {
          count: result.sessions.length,
          folders: result.folders.length,
          durationMs: Date.now() - startedAt,
          reason,
        },
      });
      this.emit();
    } catch (error) {
      this.onError('list', error);
      this.closeSocket();
      this.scheduleReconnect();
    }
  }

  private request(
    method: string,
    params: Record<string, unknown>,
    timeoutMs = REQUEST_TIMEOUT_MS,
  ): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const socket = this.socket;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        reject(new Error('ws not open'));
        return;
      }
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('request timeout'));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    });
  }

  private failPending(message: string): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error(message));
    }
    this.pending.clear();
  }

  private closeSocket(): void {
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      try {
        socket.close();
      } catch {
        // already closed
      }
    }
  }

  // --- scheduling ---------------------------------------------------------

  private scheduleReconnect(): void {
    if (!this.started || this.retryTimer) return;
    this.setStatus('connecting');
    // The token may have rotated — re-read it before reconnecting.
    this.token = null;
    this.emit();
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.obtainToken();
    }, this.backoffMs);
    this.backoffMs = Math.min(this.backoffMs * 2, BACKOFF_MAX_MS);
  }

  private scheduleRetry(ms: number): void {
    if (!this.started || this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.obtainToken();
    }, ms);
  }

  private schedulePoll(): void {
    if (this.pollTimer || !this.started) return;
    const focused = state.windowRef?.isFocused() === true;
    this.pollTimer = setTimeout(
      () => {
        this.pollTimer = null;
        if (this.socket?.readyState === WebSocket.OPEN) void this.list('poll');
        this.schedulePoll();
      },
      focused ? POLL_FOCUSED_MS : POLL_IDLE_MS,
    );
  }

  private clearTimers(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.retryTimer = null;
    this.pollTimer = null;
  }

  // --- state / logging ----------------------------------------------------

  private setStatus(status: CloudState['status'], error?: string): void {
    this.status = status;
    this.error = error !== undefined ? this.scrub(error).slice(0, 200) : status === 'ready' ? null : this.error;
  }

  private onRpcError(kind: string, rpcError: { code?: unknown; message?: unknown }): void {
    const message = this.scrub(String(rpcError.message ?? 'rpc error')).slice(0, 200);
    this.setStatus('error', message);
    log('cloud', 'cloud-error', {
      detail: { kind, code: typeof rpcError.code === 'number' ? rpcError.code : null, message },
    });
    this.emit();
  }

  private onError(kind: string, error: unknown): void {
    const message = this.scrub(String(error)).slice(0, 200);
    log('cloud', 'cloud-error', { detail: { kind, message } });
    this.setStatus('error', message);
    this.emit();
  }

  private scrub(message: string): string {
    return sanitizeToken(sanitizeToken(message, this.token ?? ''), this.lastToken ?? '');
  }

  private emit(): void {
    const json = JSON.stringify(this.snapshot());
    if (json === this.lastSnapshotJson) return;
    this.lastSnapshotJson = json;
    notifyShell();
  }
}

let instance: CloudSessions | null = null;

export function cloudSessions(): CloudSessions {
  instance ??= new CloudSessions();
  return instance;
}
