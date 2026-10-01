// Pure link router (plan §4.1). No electron imports.

export type RouteKind = 'devin' | 'github' | 'external' | 'mailto' | 'deny';

export type RouteSource = 'devin' | 'github' | 'local' | 'shell';
export type RouteDisposition = 'new-window' | 'navigate' | 'background';

export type RouteDecision =
  | { kind: 'gh-tab'; background: boolean }
  | { kind: 'in-place' }
  | { kind: 'devin' }
  | { kind: 'external' }
  | { kind: 'deny' };

export interface RouteContext {
  tenantUrl: string;
  githubOrigins?: readonly string[];
}

function hostMatches(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/, '');
}

export function isGitHubHost(hostname: string): boolean {
  const host = normalizeHost(hostname);
  return hostMatches(host, 'github.com') || hostMatches(host, 'githubusercontent.com');
}

// Host classification only: which surface "owns" the URL. Used by `route()` and
// kept as the legacy entry point for callers that only need the host class.
export function routeUrl(rawUrl: string, context: RouteContext): RouteKind {
  let url: URL;

  try {
    url = new URL(rawUrl);
  } catch {
    return 'deny';
  }

  if (url.protocol === 'mailto:') return 'mailto';
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'deny';

  const origin = url.origin.toLowerCase();

  if (
    isGitHubHost(url.hostname) ||
    context.githubOrigins?.some((allowed) => allowed.toLowerCase() === origin)
  ) {
    return 'github';
  }

  try {
    const tenant = new URL(context.tenantUrl);
    if (
      normalizeHost(tenant.hostname) === normalizeHost(url.hostname) &&
      tenant.port === url.port
    ) {
      return 'devin';
    }
  } catch {
    return 'deny';
  }

  return 'external';
}

// Full routing decision (plan §4.1):
// - new-window / background (popups, _blank, ctrl/middle-click) from any source:
//   GitHub host -> gh-tab (background iff disposition is 'background'); tenant -> devin;
//   other http(s) and mailto -> external; other schemes -> deny.
// - navigate (top-frame, link-initiated) from 'devin' to a GitHub host -> gh-tab.
// - navigate inside a hosted view ('devin' or 'github') to anything else -> in-place, so
//   server redirects, form posts and IdP/SSO hops are never split across views.
// - navigate from 'shell' / 'local' behaves like new-window (those surfaces never navigate).
export function route(
  rawUrl: string,
  source: RouteSource,
  disposition: RouteDisposition,
  context: RouteContext,
): RouteDecision {
  const kind = routeUrl(rawUrl, context);
  if (kind === 'deny') return { kind: 'deny' };
  if (kind === 'mailto') return { kind: 'external' };

  const hosted = source === 'devin' || source === 'github';
  if (disposition === 'navigate' && hosted) {
    if (kind === 'github' && source === 'devin') return { kind: 'gh-tab', background: false };
    return { kind: 'in-place' };
  }

  if (kind === 'github') return { kind: 'gh-tab', background: disposition === 'background' };
  if (kind === 'devin') return { kind: 'devin' };
  return { kind: 'external' };
}
