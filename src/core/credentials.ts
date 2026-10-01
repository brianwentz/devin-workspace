export interface CredentialEntry {
  origin: string;
  username: string;
}

export const SUGGESTED_ORIGINS = ['https://cloudbeds.okta.com', 'https://github.com'];

// Origins are https-only by default; allowInsecureOrigins is populated from
// DEVIN_WORKSPACES_TEST_GITHUB_ORIGINS in test mode and empty in production.
export function normalizeOrigin(
  input: string,
  allowInsecureOrigins: readonly string[] = [],
): string | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.protocol === 'https:') return url.origin;
  if (allowInsecureOrigins.includes(url.origin)) return url.origin;
  return null;
}

export function matchOrigin(
  url: string,
  origins: readonly string[],
  allowInsecureOrigins: readonly string[] = [],
): string | null {
  const origin = normalizeOrigin(url, allowInsecureOrigins);
  if (!origin) return null;
  return origins.includes(origin) ? origin : null;
}
