import type { DevinSession } from './devinApi';

export const ACTIVE_POLL_MS = 10_000;
export const IDLE_POLL_MS = 60_000;
export const MAX_BACKOFF_MS = 5 * 60_000;

// Statuses that mean Devin is busy and the user is likely to be waited on soon.
const ACTIVE_STATUSES = new Set(['new', 'claimed', 'running', 'resuming', 'working']);
// Status / status_detail values that mean the user must act.
const WAITING_DETAILS = new Set(['waiting_for_user', 'waiting_for_approval', 'blocked']);

export type StatusSnapshot = Record<string, string>; // session_id -> effective status key

export function effectiveStatus(session: Pick<DevinSession, 'status' | 'status_detail'>): string {
  const detail = (session.status_detail ?? '').toLowerCase();
  const status = (session.status ?? '').toLowerCase();
  if (WAITING_DETAILS.has(detail)) return detail;
  if (WAITING_DETAILS.has(status)) return status;
  // A finished-but-still-"running" session is not active for polling purposes.
  if (status === 'running' && detail === 'finished') return 'finished';
  return status;
}

export function isWaiting(session: Pick<DevinSession, 'status' | 'status_detail'>): boolean {
  return WAITING_DETAILS.has(effectiveStatus(session));
}

export function isActive(session: Pick<DevinSession, 'status' | 'status_detail'>): boolean {
  const key = effectiveStatus(session);
  return ACTIVE_STATUSES.has(key) && !WAITING_DETAILS.has(key);
}

export function snapshotOf(sessions: DevinSession[]): StatusSnapshot {
  const out: StatusSnapshot = {};
  for (const session of sessions) out[session.session_id] = effectiveStatus(session);
  return out;
}

export interface StatusDiff {
  newlyWaiting: string[];
  waitingCount: number;
}

// Sessions that transitioned into a waiting state since `prev`. A session
// first seen already waiting is counted but not reported as newly waiting
// unless prev is empty (first poll) — first poll never toasts.
export function diffStatuses(prev: StatusSnapshot | null, next: StatusSnapshot): StatusDiff {
  const newlyWaiting: string[] = [];
  let waitingCount = 0;
  for (const [id, status] of Object.entries(next)) {
    const waiting = WAITING_DETAILS.has(status);
    if (!waiting) continue;
    waitingCount += 1;
    if (prev === null) continue;
    const before = prev[id];
    if (before === undefined || !WAITING_DETAILS.has(before)) newlyWaiting.push(id);
  }
  return { newlyWaiting, waitingCount };
}

// P8/Q3: which previously-seen session scopes should have their tabs closed.
// `archived` is explicit; `missing` only counts when the polled list was
// complete (no next page) — otherwise absence just means it fell off page 1.
export function archivedScopes(
  previous: readonly DevinSession[],
  next: readonly DevinSession[],
  listComplete: boolean,
): string[] {
  const out: string[] = [];
  for (const before of previous) {
    const after = next.find((item) => item.session_id === before.session_id);
    if (after?.status === 'archived' || (!after && listComplete)) out.push(before.session_id);
  }
  return out;
}

// F10: label for a scope in the strip overflow menu — the session title
// (truncated) when known, else a short id form; GLOBAL reads plainly.
export function scopeLabel(scope: string, sessions: readonly DevinSession[]): string {
  if (scope === '') return 'Outside any session';
  const title = sessions.find((s) => s.session_id === scope)?.title;
  if (title) return title.length > 60 ? `${title.slice(0, 60)}…` : title;
  return `Session ${scope.slice(0, 8)}`;
}

export function pollInterval(sessions: DevinSession[], base = { active: ACTIVE_POLL_MS, idle: IDLE_POLL_MS }): number {
  return sessions.some(isActive) ? base.active : base.idle;
}

// Exponential backoff for consecutive failures, capped.
export function backoffMs(failures: number, baseMs: number): number {
  const factor = 2 ** Math.max(0, Math.min(failures - 1, 10));
  return Math.min(MAX_BACKOFF_MS, baseMs * factor);
}

export interface SessionPrLink {
  sessionId: string;
  title: string;
  url: string;
}

// "owner/repo#123" for GitHub PR URLs, otherwise the URL host+path.
export function prTitle(url: string): string {
  try {
    const parsed = new URL(url);
    const match = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(parsed.pathname);
    if (match) return `${match[1]}/${match[2]}#${match[3]}`;
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return url;
  }
}

export function prsForSession(sessions: DevinSession[], sessionId: string | null): SessionPrLink[] {
  if (!sessionId) return [];
  const session = sessions.find((item) => item.session_id === sessionId);
  if (!session) return [];
  return session.pull_requests.map((pr) => ({
    sessionId,
    title: prTitle(pr.pr_url) + (pr.pr_state ? ` (${pr.pr_state})` : ''),
    url: pr.pr_url,
  }));
}

export interface NewPullRequest {
  sessionId: string;
  url: string;
}

// F1: PR URLs that appeared on a session between two polls. Only sessions
// already present in `previous` count — sessions first seen in `next` are a
// baseline, so the first poll (and the first after a restart, which clears the
// cached list) opens nothing. A PR URL the user already saw (and maybe closed)
// is in `previous`, so it never comes back. URLs are deduped within the result.
export function newPullRequests(
  previous: readonly DevinSession[],
  next: readonly DevinSession[],
): NewPullRequest[] {
  const out: NewPullRequest[] = [];
  const seen = new Set<string>();
  for (const before of previous) {
    const after = next.find((item) => item.session_id === before.session_id);
    // An archived session's scope is being closed by the same poll — never open into it.
    if (!after || after.status === 'archived') continue;
    const known = new Set(before.pull_requests.map((pr) => pr.pr_url));
    for (const pr of after.pull_requests) {
      if (known.has(pr.pr_url) || seen.has(pr.pr_url)) continue;
      seen.add(pr.pr_url);
      out.push({ sessionId: after.session_id, url: pr.pr_url });
    }
  }
  return out;
}

export function sessionTitle(session: Pick<DevinSession, 'title' | 'session_id'>): string {
  return session.title?.trim() || session.session_id;
}

export function waitingBody(status: string): string {
  switch (status) {
    case 'waiting_for_approval':
      return 'Devin is waiting for your approval.';
    case 'blocked':
      return 'Devin is blocked and needs your input.';
    default:
      return 'Devin is waiting for your reply.';
  }
}
