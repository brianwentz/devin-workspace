import { describe, expect, it } from 'vitest';
import {
  addObservation,
  confirmIdentity,
  inferUserId,
  maskUserId,
  MAX_OBSERVATIONS,
  parseAuthStatus,
  RECENT_CREATED_MS,
  type SessionObservation,
} from '../../src/core/identityModel';

const STATUS_BLOCK = [
  'User:',
  '  Name:              Brian Wentz',
  '  Email:             brian@example.com',
  '  User ID:           user-8acb96777b4a4ebd8d938cdff28705c6',
  'Account:',
  '  Primary org:       org-5bb063a6a4ac4536ae252c24cf7f896c',
].join('\n');

describe('parseAuthStatus', () => {
  it('parses the user id and primary org from the status block', () => {
    expect(parseAuthStatus(STATUS_BLOCK)).toEqual({
      userId: 'user-8acb96777b4a4ebd8d938cdff28705c6',
      orgId: 'org-5bb063a6a4ac4536ae252c24cf7f896c',
    });
  });

  it('tolerates CRLF line endings', () => {
    expect(parseAuthStatus(STATUS_BLOCK.replace(/\n/g, '\r\n'))).toEqual({
      userId: 'user-8acb96777b4a4ebd8d938cdff28705c6',
      orgId: 'org-5bb063a6a4ac4536ae252c24cf7f896c',
    });
  });

  it('returns nulls when the lines are missing', () => {
    expect(parseAuthStatus('User:\n  Name: Brian\n')).toEqual({ userId: null, orgId: null });
  });

  it('returns nulls for the not-logged-in message and for empty output', () => {
    expect(parseAuthStatus("Not logged in. Run 'devin auth login'.")).toEqual({
      userId: null,
      orgId: null,
    });
    expect(parseAuthStatus('')).toEqual({ userId: null, orgId: null });
  });
});

describe('maskUserId', () => {
  it('keeps the user- prefix and the last 5 characters', () => {
    expect(maskUserId('user-8acb96777b4a4ebd8d938cdff28705c6')).toBe('user-…705c6');
  });

  it('masks short ids completely', () => {
    expect(maskUserId('user-abc')).toBe('user-…');
  });
});

const observation = (
  sessionId: string,
  userId: string,
  observedAt: number,
  createdAt = 0,
): SessionObservation => ({ sessionId, userId, createdAt, observedAt });

describe('addObservation', () => {
  it('replaces an existing observation for the same session id', () => {
    let list = addObservation([], observation('s1', 'user-a', 1));
    list = addObservation(list, observation('s1', 'user-b', 2));
    expect(list).toHaveLength(1);
    expect(list[0]?.userId).toBe('user-b');
  });

  it('caps the list at MAX_OBSERVATIONS, dropping the oldest observedAt', () => {
    let list: SessionObservation[] = [];
    for (let i = 0; i < MAX_OBSERVATIONS + 5; i += 1) {
      list = addObservation(list, observation(`s${i}`, 'user-a', i));
    }
    expect(list).toHaveLength(MAX_OBSERVATIONS);
    expect(list.some((item) => item.sessionId === 's0')).toBe(false);
    expect(list.at(-1)?.sessionId).toBe(`s${MAX_OBSERVATIONS + 4}`);
  });
});

describe('inferUserId', () => {
  const now = 1_000_000;

  it('accepts a session observed within RECENT_CREATED_MS of its creation (high)', () => {
    const list = [
      observation('s1', 'user-a', now - RECENT_CREATED_MS - 1, 1),
      observation('s2', 'user-b', now, now - 5_000),
    ];
    expect(inferUserId(list)).toEqual({ userId: 'user-b', confidence: 'high' });
  });

  it('prefers the most recent high-confidence observation', () => {
    const list = [
      observation('s1', 'user-a', now - 10, now - 20),
      observation('s2', 'user-b', now, now - 1),
    ];
    expect(inferUserId(list)).toEqual({ userId: 'user-b', confidence: 'high' });
  });

  it('ignores created_at of 0 for the high-confidence path', () => {
    const list = [observation('s1', 'user-a', now, 0)];
    expect(inferUserId(list)).toBeNull();
  });

  it('accepts a strict majority seen on >= 3 distinct sessions (majority)', () => {
    const list = [
      observation('s1', 'user-a', 1),
      observation('s2', 'user-a', 2),
      observation('s3', 'user-a', 3),
      observation('s4', 'user-b', 4),
    ];
    expect(inferUserId(list)).toEqual({ userId: 'user-a', confidence: 'majority' });
  });

  it('rejects a majority on fewer than 3 distinct sessions', () => {
    const list = [
      observation('s1', 'user-a', 1),
      observation('s1', 'user-a', 2),
      observation('s1', 'user-a', 3),
      observation('s2', 'user-b', 4),
    ];
    expect(inferUserId(list)).toBeNull();
  });

  it('rejects a tie (no strict majority)', () => {
    const list = [
      observation('s1', 'user-a', 1),
      observation('s2', 'user-a', 2),
      observation('s3', 'user-a', 3),
      observation('s4', 'user-b', 4),
      observation('s5', 'user-b', 5),
      observation('s6', 'user-b', 6),
    ];
    expect(inferUserId(list)).toBeNull();
  });
});

describe('confirmIdentity', () => {
  const session = (userId: string | null) => ({ user_id: userId });

  it('confirms when the page contains a session owned by the user', () => {
    expect(
      confirmIdentity('user-a', { sessions: [session('user-b'), session('user-a')], hasNextPage: false }),
    ).toBe(true);
  });

  it('confirms an empty single page (genuinely idle user)', () => {
    expect(confirmIdentity('user-a', { sessions: [], hasNextPage: false })).toBe(true);
    expect(confirmIdentity('user-a', { sessions: [], hasNextPage: true })).toBe(false);
  });

  it('rejects a non-empty page with no matching session', () => {
    expect(
      confirmIdentity('user-a', { sessions: [session('user-b'), session(null)], hasNextPage: false }),
    ).toBe(false);
  });
});
