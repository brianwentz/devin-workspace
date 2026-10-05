import { describe, expect, it } from 'vitest';
import {
  HOME_KEY,
  keyForUrl,
  pickEvictions,
  pickIdle,
  type PoolEntryInfo,
} from '../../src/core/viewPool';

const TENANT = 'https://tenant.example.com';

describe('keyForUrl', () => {
  it('maps session URLs to their bare id, everything else to home', () => {
    expect(keyForUrl(`${TENANT}/sessions/abc123`, TENANT)).toBe('abc123');
    expect(keyForUrl(`${TENANT}/`, TENANT)).toBe(HOME_KEY);
    expect(keyForUrl(`${TENANT}/settings`, TENANT)).toBe(HOME_KEY);
    expect(keyForUrl('https://other.example.com/sessions/abc', TENANT)).toBe(HOME_KEY);
    expect(keyForUrl('not a url', TENANT)).toBe(HOME_KEY);
  });
});

function entry(overrides: Partial<PoolEntryInfo> & { key: string }): PoolEntryInfo {
  return { lastActiveAt: 0, active: false, protected: false, loading: false, ...overrides };
}

describe('pickEvictions', () => {
  it('returns [] when under the cap', () => {
    expect(pickEvictions([entry({ key: 'a' }), entry({ key: 'b' })], 3)).toEqual([]);
  });

  it('evicts least recently active first, exactly the excess', () => {
    const entries = [
      entry({ key: 'newest', lastActiveAt: 300 }),
      entry({ key: 'oldest', lastActiveAt: 100 }),
      entry({ key: 'mid', lastActiveAt: 200 }),
      entry({ key: 'active', lastActiveAt: 50, active: true }),
    ];
    expect(pickEvictions(entries, 2)).toEqual(['oldest', 'mid']);
    expect(pickEvictions(entries, 3)).toEqual(['oldest']);
  });

  it('never evicts the active, protected, or loading entries', () => {
    const entries = [
      entry({ key: 'a', lastActiveAt: 10, active: true }),
      entry({ key: 'b', lastActiveAt: 20, protected: true }),
      entry({ key: 'c', lastActiveAt: 30, loading: true }),
      entry({ key: 'd', lastActiveAt: 40 }),
    ];
    // 4 live with cap 1 → 3 excess but only 'd' is evictable.
    expect(pickEvictions(entries, 1)).toEqual(['d']);
  });
});

describe('pickIdle', () => {
  it('returns [] when keepAliveMs <= 0', () => {
    const entries = [entry({ key: 'a', lastActiveAt: 0 })];
    expect(pickIdle(entries, 0, 1_000_000)).toEqual([]);
    expect(pickIdle(entries, -5, 1_000_000)).toEqual([]);
  });

  it('picks non-active entries idle at least keepAliveMs', () => {
    const now = 10_000;
    const entries = [
      entry({ key: 'idle', lastActiveAt: now - 5000 }),
      entry({ key: 'fresh', lastActiveAt: now - 100 }),
      entry({ key: 'active', lastActiveAt: 0, active: true }),
      entry({ key: 'protected', lastActiveAt: 0, protected: true }),
      entry({ key: 'loading', lastActiveAt: 0, loading: true }),
    ];
    expect(pickIdle(entries, 1000, now)).toEqual(['idle']);
  });
});
