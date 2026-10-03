// Service-user identity resolution (pure; unit-testable).
//
// A service-user token has no user_id, so the notifier cannot filter "my
// sessions" directly. The user id is resolved from, in order: a manual
// override, `devin auth status` (the CLI the user signed into the tenant with),
// a persisted identity.json entry, or inference from sessions the user opens.

export type IdentitySource = 'self' | 'cli' | 'inferred' | 'manual';

export interface ParsedAuthStatus {
  userId: string | null;
  orgId: string | null;
}

// `devin auth status` prints indented "User ID: user-…" / "Primary org:
// org-…" lines, or "Not logged in" (non-zero exit) when unauthenticated.
export function parseAuthStatus(text: string): ParsedAuthStatus {
  const cleaned = text.replace(/\r/g, '');
  const userId = /^\s*User ID:\s*(user-\S+)/m.exec(cleaned)?.[1] ?? null;
  const orgId = /^\s*Primary org:\s*(org-\S+)/m.exec(cleaned)?.[1] ?? null;
  return { userId, orgId };
}

// Only the tail is ever surfaced in the UI — `user-…705c6`.
export function maskUserId(id: string): string {
  if (id.length < 10) return 'user-…';
  return `user-…${id.slice(-5)}`;
}

export interface SessionObservation {
  sessionId: string;
  userId: string;
  createdAt: number; // ms; 0 when unknown
  observedAt: number; // ms
}

export const MAX_OBSERVATIONS = 50;
export const RECENT_CREATED_MS = 120_000;
export const MIN_DISTINCT_SESSIONS = 3;

export function addObservation(
  list: SessionObservation[],
  next: SessionObservation,
): SessionObservation[] {
  const merged = [...list.filter((item) => item.sessionId !== next.sessionId), next].sort(
    (a, b) => a.observedAt - b.observedAt,
  );
  return merged.slice(-MAX_OBSERVATIONS);
}

// 'high': a session observed within RECENT_CREATED_MS of its creation is one
// the user just made in the web UI. 'majority': a user seen on >= 3 distinct
// sessions holding a strict majority of all observations.
export function inferUserId(
  list: SessionObservation[],
): { userId: string; confidence: 'high' | 'majority' } | null {
  let recent: SessionObservation | null = null;
  for (const observation of list) {
    if (
      observation.createdAt > 0 &&
      observation.observedAt - observation.createdAt <= RECENT_CREATED_MS &&
      (!recent || observation.observedAt >= recent.observedAt)
    ) {
      recent = observation;
    }
  }
  if (recent) return { userId: recent.userId, confidence: 'high' };
  const byUser = new Map<string, { sessions: Set<string>; count: number }>();
  for (const observation of list) {
    const entry = byUser.get(observation.userId) ?? { sessions: new Set<string>(), count: 0 };
    entry.sessions.add(observation.sessionId);
    entry.count += 1;
    byUser.set(observation.userId, entry);
  }
  for (const [userId, entry] of byUser) {
    if (entry.sessions.size >= MIN_DISTINCT_SESSIONS && entry.count * 2 > list.length) {
      return { userId, confidence: 'majority' };
    }
  }
  return null;
}

// A resolved identity is confirmed when the first filtered page contains a
// session owned by it, or the page is empty with no next page (idle user).
export function confirmIdentity(
  userId: string,
  page: { sessions: Array<{ user_id: string | null }>; hasNextPage: boolean },
): boolean {
  return (
    page.sessions.some((session) => session.user_id === userId) ||
    (page.sessions.length === 0 && !page.hasNextPage)
  );
}
