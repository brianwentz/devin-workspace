import { describe, expect, it } from 'vitest';
import { LOG_MAX_BYTES, rotatedPath, shouldRotate } from '../../src/core/logModel';

describe('log rotation (F2)', () => {
  it('rotates when the next line would exceed the cap', () => {
    expect(shouldRotate(0, 10, 100)).toBe(false); // empty log — nothing to rotate
    expect(shouldRotate(90, 11, 100)).toBe(true);
    expect(shouldRotate(90, 10, 100)).toBe(false);
    expect(LOG_MAX_BYTES).toBe(10 * 1024 * 1024);
  });

  it('rotated path is the single events.1.jsonl sibling', () => {
    expect(rotatedPath('C:/p/events.jsonl')).toBe('C:/p/events.1.jsonl');
    expect(rotatedPath('events.1.jsonl')).toBe('events.1.1.jsonl'); // never reached: only the live file rotates
  });
});
