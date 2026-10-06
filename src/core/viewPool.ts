import { parseSessionId } from './sessions';

// Key under which the tenant-root (non-session) view is pooled.
export const HOME_KEY = 'home';

export function keyForUrl(url: string, tenantUrl: string): string {
  return parseSessionId(url, tenantUrl) ?? HOME_KEY;
}

export interface PoolEntryInfo {
  key: string;
  lastActiveAt: number;
  active: boolean;
  protected: boolean;
  loading: boolean;
}

// Keys to discard so the live count drops to maxLive. Never the active entry,
// never protected (beforeunload-kept) or still-loading views; evict the least
// recently active first.
export function pickEvictions(entries: PoolEntryInfo[], maxLive: number): string[] {
  const evictable = entries
    .filter((entry) => !entry.active && !entry.protected && !entry.loading)
    .sort((a, b) => a.lastActiveAt - b.lastActiveAt);
  const excess = entries.length - maxLive;
  if (excess <= 0) return [];
  return evictable.slice(0, excess).map((entry) => entry.key);
}

// Non-active, non-protected, non-loading entries idle for at least keepAliveMs.
// keepAliveMs <= 0 disables the sweep entirely.
export function pickIdle(
  entries: PoolEntryInfo[],
  keepAliveMs: number,
  now: number,
): string[] {
  if (keepAliveMs <= 0) return [];
  return entries
    .filter(
      (entry) =>
        !entry.active &&
        !entry.protected &&
        !entry.loading &&
        now - entry.lastActiveAt >= keepAliveMs,
    )
    .map((entry) => entry.key);
}
