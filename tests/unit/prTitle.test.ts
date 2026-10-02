import { describe, expect, it } from 'vitest';
import { parsePrTitle } from '../../src/core/prTitle';

const page = (title: string) =>
  `<!doctype html><html><head><title>${title}</title></head><body></body></html>`;

describe('parsePrTitle', () => {
  it('strips the GitHub " · Pull Request #N · owner/repo" suffix and the trailing author', () => {
    expect(
      parsePrTitle(
        page('Fix widget alignment by devin-ai-integration[bot] · Pull Request #42 · acme/widgets'),
      ),
    ).toBe('Fix widget alignment');
  });

  it('decodes named and numeric entities and collapses whitespace', () => {
    expect(
      parsePrTitle(page('Fish &amp; Chips&#39;s &lt;big&gt;   move\nby bot · Pull Request #1 · o/r')),
    ).toBe('Fish & Chips\'s <big> move');
    expect(parsePrTitle(page('a &#98;&#x63; · Pull Request #2 · o/r'))).toBe('a bc');
  });

  it('returns a non-GitHub title as-is (no "by" stripping)', () => {
    expect(parsePrTitle(page('Document by some author'))).toBe('Document by some author');
  });

  it('preserves " by " in the middle of a GitHub title', () => {
    expect(
      parsePrTitle(page('Sort by name by bot · Pull Request #5 · o/r')),
    ).toBe('Sort by name');
  });

  it('returns null when there is no title or it is empty', () => {
    expect(parsePrTitle('<html><body>no title</body></html>')).toBeNull();
    expect(parsePrTitle(page('   '))).toBeNull();
    expect(parsePrTitle(page('· Pull Request #3 · o/r'))).toBeNull();
  });

  it('caps the scan at 64 KB', () => {
    const title = `${'x'.repeat(70 * 1024)}<title>late</title>`;
    expect(parsePrTitle(title)).toBeNull();
  });
});
