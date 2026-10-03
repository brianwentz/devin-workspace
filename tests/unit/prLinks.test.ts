import { describe, expect, it } from 'vitest';
import { extractPullRequestUrls, LinkScanner, stripAnsi } from '../../src/core/prLinks';

const GH = 'https://github.com';
const FIX = 'http://127.0.0.1:4000';

describe('extractPullRequestUrls', () => {
  it('finds PR URLs in plain text, canonical and deduped', () => {
    const text = `see ${GH}/acme/widgets/pull/7 and again ${GH}/acme/widgets/pull/7?diff=full#x plus ${GH}/acme/widgets/pull/8`;
    expect(extractPullRequestUrls(text, {})).toEqual([
      `${GH}/acme/widgets/pull/7`,
      `${GH}/acme/widgets/pull/8`,
    ]);
  });

  it('extracts from markdown link syntax', () => {
    expect(
      extractPullRequestUrls(`[the PR](${GH}/acme/widgets/pull/9)`, {}),
    ).toEqual([`${GH}/acme/widgets/pull/9`]);
  });

  it('strips trailing punctuation', () => {
    expect(extractPullRequestUrls(`(${GH}/acme/widgets/pull/3).`, {})).toEqual([
      `${GH}/acme/widgets/pull/3`,
    ]);
    expect(extractPullRequestUrls(`done: ${GH}/acme/widgets/pull/3, next`, {})).toEqual([
      `${GH}/acme/widgets/pull/3`,
    ]);
  });

  it('ignores non-PR GitHub URLs and non-GitHub hosts', () => {
    const text = `${GH}/acme/widgets/issues/7 ${GH}/acme/widgets/pull/7/files ${GH}/acme/widgets/pull/7 https://example.com/acme/widgets/pull/1 https://example.com/pull/1`;
    expect(extractPullRequestUrls(text, {})).toEqual([`${GH}/acme/widgets/pull/7`]);
  });

  it('accepts fixture origins and rejects lookalikes', () => {
    const context = { githubOrigins: [FIX] };
    expect(extractPullRequestUrls(`${FIX}/acme/widgets/pull/7`, context)).toEqual([
      `${FIX}/acme/widgets/pull/7`,
    ]);
    expect(extractPullRequestUrls(`${FIX}/acme/widgets/pull/7`, {})).toEqual([]);
  });

  it('handles OSC 8 hyperlinks, keeping the visible URL text', () => {
    const osc8 = `\x1b]8;;${GH}/acme/widgets/pull/5\x07link\x1b]8;;\x07`;
    expect(extractPullRequestUrls(stripAnsi(osc8), {})).toEqual([]);
    const osc8Url = `\x1b]8;;x\x07${GH}/acme/widgets/pull/5\x1b]8;;\x07`;
    expect(extractPullRequestUrls(stripAnsi(osc8Url), {})).toEqual([
      `${GH}/acme/widgets/pull/5`,
    ]);
  });
});

describe('stripAnsi', () => {
  it('removes CSI colours and cursor codes', () => {
    expect(stripAnsi('\x1b[32mgreen\x1b[0m plain\x1b[2J')).toBe('green plain');
  });
  it('removes OSC sequences including OSC 8 hyperlinks', () => {
    expect(stripAnsi('a\x1b]8;;https://x\x07b\x1b]8;;\x07c')).toBe('abc');
  });
});

describe('LinkScanner', () => {
  it('finds a URL split across two chunks', () => {
    const scanner = new LinkScanner({ context: {} });
    const url = `${GH}/acme/widgets/pull/42`;
    expect(scanner.scan(`see ${url.slice(0, 20)}`)).toEqual([]);
    expect(scanner.scan(`${url.slice(20)} thanks`)).toEqual([url]);
  });

  it('defers a URL ending at the chunk boundary — growing ids win', () => {
    const scanner = new LinkScanner({ context: {} });
    // `/pull/12` + `34` must report only the final /pull/1234.
    expect(scanner.scan(`${GH}/acme/widgets/pull/12`)).toEqual([]);
    expect(scanner.scan(`34 and more`)).toEqual([`${GH}/acme/widgets/pull/1234`]);
  });

  it('reports a URL followed by a newline in the same chunk immediately', () => {
    const scanner = new LinkScanner({ context: {} });
    const url = `${GH}/acme/widgets/pull/7`;
    expect(scanner.scan(`see ${url}\nnext line`)).toEqual([url]);
  });

  it('reports a chunk-ending URL on flush()', () => {
    const scanner = new LinkScanner({ context: {} });
    const url = `${GH}/acme/widgets/pull/9`;
    expect(scanner.scan(`ends here ${url}`)).toEqual([]);
    expect(scanner.flush()).toEqual([url]);
    expect(scanner.flush()).toEqual([]);
  });

  it('reports once when a chunk-ending URL is terminated by ) next chunk', () => {
    const scanner = new LinkScanner({ context: {} });
    const url = `${GH}/acme/widgets/pull/5`;
    expect(scanner.scan(`(${url}`)).toEqual([]);
    expect(scanner.scan(`) and prose`)).toEqual([url]);
  });

  it('handles ANSI-coloured URLs', () => {
    const scanner = new LinkScanner({ context: {} });
    expect(
      scanner.scan(`\x1b[36m${GH}/acme/widgets/pull/7\x1b[0m `),
    ).toEqual([`${GH}/acme/widgets/pull/7`]);
  });

  it('suppresses duplicates across scans', () => {
    const scanner = new LinkScanner({ context: {} });
    const url = `${GH}/acme/widgets/pull/7`;
    scanner.scan(`${url} `);
    expect(scanner.scan(`${url} `)).toEqual([]);
  });

  it('rejects example.com/pull/1', () => {
    const scanner = new LinkScanner({ context: {} });
    expect(scanner.scan('https://example.com/pull/1')).toEqual([]);
  });
});
