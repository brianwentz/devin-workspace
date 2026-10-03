import { describe, expect, it } from 'vitest';
import type { DevinSession } from '../../src/core/devinApi';
import {
  addNotification,
  clearNotifications,
  deriveNotifications,
  markAllRead,
  markRead,
  MAX_NOTIFICATIONS,
  pruneForeign,
  removeNotification,
  unreadCount,
  type AppNotification,
  type DeriveContext,
  type NotificationKind,
} from '../../src/core/notificationModel';

const ENABLED: Record<NotificationKind, boolean> = {
  waiting: true,
  approval: true,
  blocked: true,
  finished: false, // off by default
  'pr-opened': true,
  'pr-completed': true,
  update: true,
  identity: true,
};
const ctx = (over: Partial<DeriveContext> = {}): DeriveContext => ({
  enabled: ENABLED,
  now: 1000,
  ownerUserId: 'user-1',
  ...over,
});

const session = (
  id: string,
  status: string,
  detail: string | null = null,
  prs: { pr_url: string; pr_state: string | null }[] = [],
): DevinSession => ({
  session_id: id,
  title: `t-${id}`,
  status,
  status_detail: detail,
  created_at: 0,
  updated_at: 0,
  user_id: null,
  service_user_id: null,
  pull_requests: prs,
});

const note = (id: string, kind: NotificationKind = 'waiting', sessionId = 's'): AppNotification => ({
  id,
  kind,
  sessionId,
  sessionTitle: sessionId,
  title: 't',
  body: 'b',
  createdAt: 0,
  readAt: null,
});

describe('addNotification', () => {
  it('prepends and refreshes an unread duplicate in place', () => {
    let list: AppNotification[] = [];
    list = addNotification(list, { ...note('x', 'waiting', 's1'), title: 'a', body: 'b1' }, 'id-1');
    list = addNotification(list, { ...note('x', 'waiting', 's2'), title: 'b', body: 'b2' }, 'id-2');
    expect(list.map((n) => n.id)).toEqual(['id-2', 'id-1']);
    // Same kind+session again while unread → refreshes in place (same id).
    list = addNotification(list, { ...note('x', 'waiting', 's1'), title: 'a2', body: 'b9' }, 'id-3');
    expect(list.map((n) => n.id)).toEqual(['id-2', 'id-1']);
    expect(list[1]!.body).toBe('b9');
  });
  it('does not dedupe a READ entry — a fresh unread is prepended', () => {
    let list = addNotification([], note('x', 'waiting', 's1'), 'id-1');
    list = markRead(list, 'id-1', 5);
    list = addNotification(list, { ...note('x', 'waiting', 's1') }, 'id-2');
    expect(list).toHaveLength(2);
  });
  it('caps at MAX_NOTIFICATIONS, dropping the oldest', () => {
    let list: AppNotification[] = [];
    for (let i = 0; i < MAX_NOTIFICATIONS + 3; i++) {
      list = addNotification(list, { ...note('x', 'waiting', `s${i}`) }, `id-${i}`);
    }
    expect(list).toHaveLength(MAX_NOTIFICATIONS);
    expect(list.at(-1)!.id).toBe('id-3');
  });
});

describe('list ops', () => {
  it('markRead/markAllRead/remove/clear/unreadCount', () => {
    let list = [note('a'), note('b'), note('c')];
    expect(unreadCount(list)).toBe(3);
    list = markRead(list, 'b', 10);
    expect(unreadCount(list)).toBe(2);
    expect(list.find((n) => n.id === 'b')!.readAt).toBe(10);
    list = markAllRead(list, 20);
    expect(unreadCount(list)).toBe(0);
    list = removeNotification(list, 'a');
    expect(list).toHaveLength(2);
    expect(clearNotifications(list)).toEqual([]);
  });
});

describe('deriveNotifications', () => {
  const PR = 'https://github.com/acme/widgets/pull/42';
  it('is empty on the baseline poll (sessions absent from previous)', () => {
    expect(deriveNotifications([], [session('a', 'running', 'waiting_for_user')], ctx())).toEqual([]);
  });
  it('maps status transitions to kinds with bodies', () => {
    const prev = [session('a', 'running', 'working'), session('b', 'running', 'working'), session('c', 'running', 'working')];
    const next = [
      session('a', 'running', 'waiting_for_user'),
      session('b', 'running', 'waiting_for_approval'),
      session('c', 'blocked'),
    ];
    const out = deriveNotifications(prev, next, ctx());
    expect(out.map((n) => [n.sessionId, n.kind])).toEqual([
      ['a', 'waiting'],
      ['b', 'approval'],
      ['c', 'blocked'],
    ]);
    expect(out[0]!.body).toBe('Waiting for your reply');
  });
  it('does not re-notify the same effective status or finished when disabled', () => {
    const prev = [session('a', 'running', 'waiting_for_user')];
    const next = [session('a', 'running', 'waiting_for_approval')];
    // waiting→approval is a kind change → notifies once...
    expect(deriveNotifications(prev, next, ctx()).map((n) => n.kind)).toEqual(['approval']);
    // ...then approval→approval is quiet, and exit→finished is off by default.
    expect(deriveNotifications(next, next, ctx())).toEqual([]);
    expect(deriveNotifications(prev, [session('a', 'exit')], ctx())).toEqual([]);
    expect(
      deriveNotifications(prev, [session('a', 'exit')], ctx({ enabled: { ...ENABLED, finished: true } })),
    ).toEqual([expect.objectContaining({ kind: 'finished' })]);
  });
  it('emits pr-opened for a new PR and pr-completed on merged/closed', () => {
    const prev = [session('a', 'running', 'working', [{ pr_url: PR, pr_state: 'open' }])];
    const opened = deriveNotifications(
      prev,
      [session('a', 'running', 'working', [{ pr_url: PR, pr_state: 'open' }, { pr_url: PR + '9', pr_state: 'open' }])],
      ctx(),
    );
    expect(opened).toEqual([
      expect.objectContaining({ kind: 'pr-opened', prUrl: PR + '9', title: 'Opened acme/widgets#429' }),
    ]);
    const merged = deriveNotifications(
      prev,
      [session('a', 'running', 'working', [{ pr_url: PR, pr_state: 'merged' }])],
      ctx(),
    );
    expect(merged).toEqual([
      expect.objectContaining({ kind: 'pr-completed', prState: 'merged', title: 'PR acme/widgets#42 merged' }),
    ]);
    const closed = deriveNotifications(
      prev,
      [session('a', 'running', 'working', [{ pr_url: PR, pr_state: 'closed' }])],
      ctx(),
    );
    expect(closed[0]!.title).toBe('PR acme/widgets#42 closed');
    // Re-polling the same state emits nothing.
    expect(
      deriveNotifications(
        [session('a', 'running', 'working', [{ pr_url: PR, pr_state: 'merged' }])],
        [session('a', 'running', 'working', [{ pr_url: PR, pr_state: 'merged' }])],
        ctx(),
      ),
    ).toEqual([]);
  });
});

describe('pruneForeign', () => {
  it('drops legacy entries (no ownerUserId) with a sessionId', () => {
    const legacy = note('legacy', 'waiting', 'sess-legacy');
    expect('ownerUserId' in legacy).toBe(false);
    expect(pruneForeign([legacy], 'user-1')).toEqual([]);
  });
  it('drops entries owned by another user, keeps same-owner entries', () => {
    const foreign = { ...note('f', 'waiting', 'sess-other'), ownerUserId: 'user-other' };
    const own = { ...note('o', 'waiting', 'sess-own'), ownerUserId: 'user-1' };
    expect(pruneForeign([foreign, own], 'user-1')).toEqual([own]);
  });
  it('keeps sessionId:null entries for a user owner and a null owner', () => {
    const update = { ...note('u', 'update', 'x'), sessionId: null, ownerUserId: null };
    expect(pruneForeign([update], 'user-1')).toEqual([update]);
    expect(pruneForeign([update], null)).toEqual([update]);
  });
  it('with a null owner, drops every session-scoped entry', () => {
    const own = { ...note('o', 'waiting', 'sess-own'), ownerUserId: 'user-1' };
    const legacy = note('l', 'waiting', 'sess-legacy');
    const update = { ...note('u', 'update', 'x'), sessionId: null, ownerUserId: null };
    expect(pruneForeign([own, legacy, update], null)).toEqual([update]);
  });
});

describe('deriveNotifications ownerUserId', () => {
  it('stamps every entry with ctx.ownerUserId', () => {
    const prev = [session('a', 'running', 'working')];
    const next = [session('a', 'running', 'waiting_for_user')];
    const out = deriveNotifications(prev, next, ctx({ ownerUserId: 'user-9' }));
    expect(out).toHaveLength(1);
    expect(out[0]!.ownerUserId).toBe('user-9');
    expect(deriveNotifications(prev, next, ctx({ ownerUserId: null }))[0]!.ownerUserId).toBeNull();
  });
});
