// User-configurable link rules (routing.rules): matching http(s) URLs open as
// tabs in the GitHub pane instead of the system browser. Pure — no electron.

import type { LinkRule } from '../shared/ipc';

export type CompiledRule = {
  rule: LinkRule;
  test: (href: string) => boolean;
  originTest: (origin: string) => boolean;
};

// Returns an error message, or null when the rule shape is usable.
export function validateLinkRule(rule: Pick<LinkRule, 'kind' | 'pattern'>): string | null {
  if (rule.kind === 'prefix') {
    if (!/^https?:\/\//i.test(rule.pattern)) {
      return 'Prefix must start with http:// or https://';
    }
    try {
      new URL(rule.pattern);
    } catch {
      return 'Prefix must start with http:// or https://';
    }
    return null;
  }
  try {
    new RegExp(rule.pattern);
  } catch (error) {
    return `Invalid regular expression: ${(error as Error).message}`;
  }
  return null;
}

// URL parse already lowercases scheme/host and drops the default port;
// reconstruct so path/query/hash keep their original form.
function normalizeHref(raw: string): string {
  const url = new URL(raw);
  return `${url.protocol}//${url.host}${url.pathname}${url.search}${url.hash}`;
}

export function compileLinkRules(rules: readonly LinkRule[]): CompiledRule[] {
  const compiled: CompiledRule[] = [];
  for (const rule of rules) {
    if (!rule.enabled || validateLinkRule(rule) !== null) continue;
    if (rule.kind === 'prefix') {
      const normalizedPrefix = normalizeHref(rule.pattern);
      const origin = new URL(rule.pattern).origin.toLowerCase();
      compiled.push({
        rule,
        test: (href) => {
          try {
            return normalizeHref(href).startsWith(normalizedPrefix);
          } catch {
            return false;
          }
        },
        originTest: (candidate) => candidate.toLowerCase() === origin,
      });
    } else {
      const re = new RegExp(rule.pattern);
      compiled.push({
        rule,
        test: (href) => re.test(href),
        originTest: (candidate) => re.test(candidate) || re.test(`${candidate}/`),
      });
    }
  }
  return compiled;
}

export function matchLinkRule(
  href: string,
  compiled: readonly CompiledRule[],
): LinkRule | null {
  return compiled.find((entry) => entry.test(href))?.rule ?? null;
}

export function ruleOwnsOrigin(origin: string, compiled: readonly CompiledRule[]): boolean {
  return compiled.some((entry) => entry.originTest(origin));
}
