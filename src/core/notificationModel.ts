// P6 in-app notification center: pure model — derivation from polled session
// diffs plus the list operations the main-process store applies. 'update' kind
// entries are created by main (auto-updater), not by deriveNotifications.
import type { DevinSession } from './devinApi';
import { effectiveStatus, newPullRequests, prTitle } from './notifyModel';

export type NotificationKind =
  | 'waiting'
  | 'approval'
  | 'blocked'
  | 'finished'
  | 'pr-opened'
  | 'pr-completed'
  | 'update'
  | 'identity';

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  sessionId: string | null;
  // The token user the entry was derived for. `undefined` = legacy entry
  // (pre-owner build); `null` = not session-scoped ('update', 'identity').
  ownerUserId?: string | null | undefined;
  sessionTitle: string;
  prUrl?: string | undefined;
  prState?: string | undefined;
  version?: string | undefined;
  title: string;
  body: string;
  createdAt: number;
  readAt: number | null;
}

export const MAX_NOTIFICATIONS = 50;

export type NewNotification = Omit<AppNotification, 'id' | 'readAt'>;

// Prepend unless an UNREAD entry already carries the same
// kind+sessionId+prUrl+version — then refresh that entry in place (same id,
// new body/createdAt, still unread). Result capped at MAX_NOTIFICATIONS.
export function addNotification(
  list: readonly AppNotification[],
  next: NewNotification,
  id: string,
): AppNotification[] {
  const entry: AppNotification = { ...next, id, readAt: null };
  const existing = list.findIndex(
    (item) =>
      item.readAt === null &&
      item.kind === next.kind &&
      item.sessionId === next.sessionId &&
      (item.prUrl ?? null) === (next.prUrl ?? null) &&
      (item.version ?? null) === (next.version ?? null),
  );
  const out =
    existing >= 0
      ? list.map((item, i) => (i === existing ? { ...entry, id: item.id } : item))
      : [entry, ...list];
  return out.slice(0, MAX_NOTIFICATIONS);
}

export function markRead(list: readonly AppNotification[], id: string, now: number): AppNotification[] {
  return list.map((item) => (item.id === id && item.readAt === null ? { ...item, readAt: now } : item));
}

export function markAllRead(list: readonly AppNotification[], now: number): AppNotification[] {
  return list.map((item) => (item.readAt === null ? { ...item, readAt: now } : item));
}

export function removeNotification(list: readonly AppNotification[], id: string): AppNotification[] {
  return list.filter((item) => item.id !== id);
}

export function clearNotifications(list: readonly AppNotification[]): AppNotification[] {
  return [];
}

export function unreadCount(list: readonly AppNotification[]): number {
  return list.filter((item) => item.readAt === null).length;
}

// Drop session-scoped entries that were derived for a different token user
// (or by a build that recorded no owner). `ownerUserId === null` means the
// token has no user identity, so every session-scoped entry goes.
export function pruneForeign(list: readonly AppNotification[], ownerUserId: string | null): AppNotification[] {
  return list.filter((item) => item.sessionId === null || (ownerUserId !== null && item.ownerUserId === ownerUserId));
}

export interface DeriveContext {
  enabled: Record<NotificationKind, boolean>;
  now: number;
  ownerUserId: string | null;
}

const STATUS_KIND: Record<string, NotificationKind> = {
  waiting_for_user: 'waiting',
  waiting_for_approval: 'approval',
  blocked: 'blocked',
  finished: 'finished',
  exit: 'finished',
};

const STATUS_BODY: Record<NotificationKind, string> = {
  waiting: 'Waiting for your reply',
  approval: 'Needs your approval',
  blocked: 'Blocked — needs your input',
  finished: 'Session finished',
  'pr-opened': '',
  'pr-completed': '',
  update: '',
  identity: '',
};

const sessionTitleOf = (s: DevinSession) => s.title?.trim() || s.session_id;

// Notifications derived from a poll diff. Sessions absent from `previous` are
// baseline (no entries) — same rule as newPullRequests.
export function deriveNotifications(
  previous: readonly DevinSession[],
  next: readonly DevinSession[],
  ctx: DeriveContext,
): NewNotification[] {
  const out: NewNotification[] = [];
  const enabled = ctx.enabled;

  // Status transitions: only sessions present in both lists, and only when the
  // effective status actually changed into the notification-worthy value.
  for (const after of next) {
    const before = previous.find((item) => item.session_id === after.session_id);
    if (!before) continue;
    const prevStatus = effectiveStatus(before);
    const nextStatus = effectiveStatus(after);
    const kind = STATUS_KIND[nextStatus];
    if (!kind || nextStatus === prevStatus) continue;
    // Same kind via a different status detail does not re-notify.
    if (STATUS_KIND[prevStatus] === kind) continue;
    if (!enabled[kind]) continue;
    out.push({
      kind,
      sessionId: after.session_id,
      sessionTitle: sessionTitleOf(after),
      title: sessionTitleOf(after),
      body: STATUS_BODY[kind],
      createdAt: ctx.now,
      ownerUserId: ctx.ownerUserId,
    });
  }

  // New PRs (sessions first seen in `next` are baseline inside newPullRequests).
  if (enabled['pr-opened']) {
    for (const pr of newPullRequests(previous, next)) {
      const session = next.find((item) => item.session_id === pr.sessionId)!;
      out.push({
        kind: 'pr-opened',
        sessionId: pr.sessionId,
        sessionTitle: sessionTitleOf(session),
        prUrl: pr.url,
        title: `Opened ${prTitle(pr.url)}`,
        body: sessionTitleOf(session),
        createdAt: ctx.now,
        ownerUserId: ctx.ownerUserId,
      });
    }
  }

  // PR state transitions open/null → merged|closed, sessions present in both.
  if (enabled['pr-completed']) {
    for (const before of previous) {
      const after = next.find((item) => item.session_id === before.session_id);
      if (!after) continue;
      for (const pr of after.pull_requests) {
        if (pr.pr_state !== 'merged' && pr.pr_state !== 'closed') continue;
        const prior = before.pull_requests.find((item) => item.pr_url === pr.pr_url);
        if (!prior || (prior.pr_state !== 'open' && prior.pr_state !== null)) continue;
        out.push({
          kind: 'pr-completed',
          sessionId: after.session_id,
          sessionTitle: sessionTitleOf(after),
          prUrl: pr.pr_url,
          prState: pr.pr_state,
          title: `PR ${prTitle(pr.pr_url)} ${pr.pr_state}`,
          body: sessionTitleOf(after),
          createdAt: ctx.now,
          ownerUserId: ctx.ownerUserId,
        });
      }
    }
  }

  return out;
}
