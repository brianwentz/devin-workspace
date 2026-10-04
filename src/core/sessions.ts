// F3: user-facing URLs must be https; http is allowed for localhost-style
// hosts only (dev fixtures bypass the schema via env anyway).
export function isAllowedAppUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol === 'https:') return true;
    if (url.protocol === 'http:') {
      return url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
    }
    return false;
  } catch {
    return false;
  }
}

export function parseSessionId(url: string, tenantUrl: string): string | null {
  let parsed: URL;
  let tenant: URL;
  try {
    parsed = new URL(url);
    tenant = new URL(tenantUrl);
  } catch {
    return null;
  }
  if (parsed.host.toLowerCase() !== tenant.host.toLowerCase()) return null;
  const match = /^\/sessions\/([^/?#]+)/.exec(parsed.pathname);
  return match?.[1] ?? null;
}

// The web app's create-session surface is the tenant root (no dedicated /new
// route could be verified without an authenticated tenant); keep it here so a
// future change is one line.
export const NEW_SESSION_PATH = '/';

export function newSessionUrl(tenantUrl: string): string {
  return new URL(NEW_SESSION_PATH, tenantUrl).toString();
}

export function sessionUrl(tenantUrl: string, sessionId: string): string {
  return new URL(`/sessions/${encodeURIComponent(sessionId)}`, tenantUrl).toString();
}

export const ANALYTICS_PATH = '/settings/my-analytics';

export function analyticsUrl(tenantUrl: string): string {
  return new URL(ANALYTICS_PATH, tenantUrl).toString();
}

// Same host+port as the tenant AND under the analytics path — deeper chart
// routes stay in the analytics view, every other tenant page routes to Cloud.
export function isAnalyticsUrl(url: string, tenantUrl: string): boolean {
  let parsed: URL;
  let tenant: URL;
  try {
    parsed = new URL(url);
    tenant = new URL(tenantUrl);
  } catch {
    return false;
  }
  if (parsed.hostname.toLowerCase() !== tenant.hostname.toLowerCase()) return false;
  if (parsed.port !== tenant.port) return false;
  return (
    parsed.pathname === ANALYTICS_PATH || parsed.pathname.startsWith(`${ANALYTICS_PATH}/`)
  );
}
