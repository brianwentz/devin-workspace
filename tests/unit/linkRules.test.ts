import { describe, expect, it } from 'vitest';
import {
  compileLinkRules,
  matchLinkRule,
  ruleOwnsOrigin,
  validateLinkRule,
} from '../../src/core/linkRules';
import type { LinkRule } from '../../src/shared/ipc';

function rule(overrides: Partial<LinkRule> = {}): LinkRule {
  return {
    id: 'r1',
    kind: 'prefix',
    pattern: 'https://jira.example.com/browse/',
    enabled: true,
    ...overrides,
  };
}

describe('validateLinkRule', () => {
  it('accepts http(s) prefixes and rejects everything else', () => {
    expect(validateLinkRule({ kind: 'prefix', pattern: 'https://x.example/' })).toBeNull();
    expect(validateLinkRule({ kind: 'prefix', pattern: 'http://x.example/a' })).toBeNull();
    expect(validateLinkRule({ kind: 'prefix', pattern: 'jira.example.com' })).toBe(
      'Prefix must start with http:// or https://',
    );
    expect(validateLinkRule({ kind: 'prefix', pattern: 'ftp://x.example/' })).toBe(
      'Prefix must start with http:// or https://',
    );
  });

  it('reports invalid regular expressions', () => {
    expect(validateLinkRule({ kind: 'regex', pattern: '^https://x\\.example/' })).toBeNull();
    const message = validateLinkRule({ kind: 'regex', pattern: '([' });
    expect(message).toMatch(/^Invalid regular expression: /);
  });
});

describe('compileLinkRules + matchLinkRule', () => {
  it('prefix matches with case-insensitive host but case-sensitive path', () => {
    const compiled = compileLinkRules([rule({ pattern: 'https://JIRA.example.com/Browse/' })]);
    expect(compiled[0]!.test('https://jira.EXAMPLE.com/Browse/ISSUE-1')).toBe(true);
    expect(compiled[0]!.test('https://jira.example.com/browse/ISSUE-1')).toBe(false);
    expect(compiled[0]!.test('https://other.example.com/Browse/ISSUE-1')).toBe(false);
  });

  it('skips disabled and invalid rules', () => {
    const compiled = compileLinkRules([
      rule({ id: 'off', enabled: false }),
      rule({ id: 'bad', kind: 'regex', pattern: '([' }),
      rule({ id: 'ok', pattern: 'https://jira.example.com/' }),
    ]);
    expect(compiled.map((entry) => entry.rule.id)).toEqual(['ok']);
  });

  it('regex matches the href', () => {
    const compiled = compileLinkRules([
      rule({ kind: 'regex', pattern: '^https://gitlab\\.example\\.com/.*/-/merge_requests/\\d+' }),
    ]);
    expect(compiled[0]!.test('https://gitlab.example.com/o/r/-/merge_requests/42')).toBe(true);
    expect(compiled[0]!.test('https://gitlab.example.com/o/r/issues/42')).toBe(false);
  });

  it('returns the first matching rule in order', () => {
    const compiled = compileLinkRules([
      rule({ id: 'first', pattern: 'https://x.example/' }),
      rule({ id: 'second', pattern: 'https://x.example/sub/' }),
    ]);
    expect(matchLinkRule('https://x.example/sub/page', compiled)?.id).toBe('first');
    expect(matchLinkRule('https://nope.example/', compiled)).toBeNull();
  });
});

describe('ruleOwnsOrigin', () => {
  it('prefix rules own their exact origin (case-insensitive)', () => {
    const compiled = compileLinkRules([rule({ pattern: 'https://JIRA.example.com:8443/browse/' })]);
    expect(ruleOwnsOrigin('https://jira.example.com:8443', compiled)).toBe(true);
    expect(ruleOwnsOrigin('https://jira.example.com', compiled)).toBe(false);
    expect(ruleOwnsOrigin('https://sub.jira.example.com:8443', compiled)).toBe(false);
  });

  it('regex rules test the origin with and without a trailing slash', () => {
    const compiled = compileLinkRules([
      rule({ kind: 'regex', pattern: '^https://gitlab\\.example\\.com/' }),
    ]);
    expect(ruleOwnsOrigin('https://gitlab.example.com', compiled)).toBe(true);
    expect(ruleOwnsOrigin('https://other.example.com', compiled)).toBe(false);
  });
});
