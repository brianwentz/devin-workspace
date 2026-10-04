import { describe, expect, it } from 'vitest';
import {
  analyticsUrl,
  isAnalyticsUrl,
  newSessionUrl,
  parseSessionId,
  sessionUrl,
} from '../../src/core/sessions';

const tenant = 'https://cloudbeds.devinenterprise.com';

describe('parseSessionId', () => {
  it('extracts the session id on the tenant host', () => {
    expect(parseSessionId(`${tenant}/sessions/abc123`, tenant)).toBe('abc123');
  });

  it('extracts the id before deeper path segments', () => {
    expect(parseSessionId(`${tenant}/sessions/abc123/files/x`, tenant)).toBe('abc123');
  });

  it('strips query and hash', () => {
    expect(parseSessionId(`${tenant}/sessions/abc123?tab=diff#frag`, tenant)).toBe('abc123');
  });

  it('returns null for other hosts', () => {
    expect(parseSessionId('https://evil.example.com/sessions/abc', tenant)).toBeNull();
  });

  it('returns null off the sessions path', () => {
    expect(parseSessionId(`${tenant}/`, tenant)).toBeNull();
    expect(parseSessionId(`${tenant}/settings/sessions/abc`, tenant)).toBeNull();
  });

  it('returns null for a bare /sessions/ path', () => {
    expect(parseSessionId(`${tenant}/sessions/`, tenant)).toBeNull();
  });

  it('returns null for invalid URLs', () => {
    expect(parseSessionId('not a url', tenant)).toBeNull();
    expect(parseSessionId(`${tenant}/sessions/abc`, 'not a url')).toBeNull();
  });
});

describe('session URLs (P5)', () => {
  it('builds new-session and session URLs from the tenant', () => {
    expect(newSessionUrl('https://acme.devinenterprise.com/sessions/x')).toBe('https://acme.devinenterprise.com/');
    expect(sessionUrl('https://acme.devinenterprise.com', 'abc 1')).toBe(
      'https://acme.devinenterprise.com/sessions/abc%201',
    );
  });
});

describe('analyticsUrl / isAnalyticsUrl', () => {
  it('builds the analytics URL from the tenant', () => {
    expect(analyticsUrl(tenant)).toBe(`${tenant}/analytics`);
    expect(analyticsUrl(`${tenant}/sessions/x`)).toBe(`${tenant}/analytics`);
  });

  it('matches the analytics path and deeper chart routes', () => {
    expect(isAnalyticsUrl(`${tenant}/analytics`, tenant)).toBe(true);
    expect(isAnalyticsUrl(`${tenant}/analytics/usage?range=7d#top`, tenant)).toBe(true);
  });

  it('rejects other tenant paths and sibling prefixes', () => {
    expect(isAnalyticsUrl(`${tenant}/`, tenant)).toBe(false);
    expect(isAnalyticsUrl(`${tenant}/sessions/abc`, tenant)).toBe(false);
    expect(isAnalyticsUrl(`${tenant}/analytics2`, tenant)).toBe(false);
  });

  it('rejects other hosts and ports', () => {
    expect(isAnalyticsUrl('https://evil.example.com/analytics', tenant)).toBe(false);
    expect(isAnalyticsUrl(`${tenant}:8443/analytics`, tenant)).toBe(false);
    expect(isAnalyticsUrl('not a url', tenant)).toBe(false);
    expect(isAnalyticsUrl(`${tenant}/analytics`, 'not a url')).toBe(false);
  });
});
