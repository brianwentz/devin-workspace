import { describe, expect, it } from 'vitest';
import { formatElapsed, formatTokens } from '../../src/core/format';

describe('formatElapsed', () => {
  it('seconds under a minute', () => {
    expect(formatElapsed(0)).toBe('0s');
    expect(formatElapsed(12_345)).toBe('12s');
    expect(formatElapsed(59_400)).toBe('59s');
  });
  it('minutes and hours', () => {
    expect(formatElapsed(65_000)).toBe('1m 05s');
    expect(formatElapsed(3_720_000)).toBe('1h 02m');
  });
});

describe('formatTokens', () => {
  it('formats counts compactly', () => {
    expect(formatTokens(842)).toBe('842');
    expect(formatTokens(1_000)).toBe('1.0k');
    expect(formatTokens(1_234)).toBe('1.2k');
    expect(formatTokens(84_795)).toBe('84.8k');
    expect(formatTokens(200_000)).toBe('200k');
    expect(formatTokens(1_200_000)).toBe('1.2M');
  });
});
