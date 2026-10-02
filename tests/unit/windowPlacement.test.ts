import { describe, expect, it } from 'vitest';
import {
  displayKey,
  isMostlyVisible,
  pickPlacement,
  rememberPlacement,
  type DisplayInfo,
  type Placement,
} from '../../src/core/windowPlacement';

const primary: DisplayInfo = {
  bounds: { x: 0, y: 0, width: 1920, height: 1080 },
  workArea: { x: 0, y: 0, width: 1920, height: 1040 },
  scaleFactor: 1,
};
const secondary: DisplayInfo = {
  bounds: { x: 1920, y: 0, width: 2560, height: 1440 },
  workArea: { x: 1920, y: 0, width: 2560, height: 1400 },
  scaleFactor: 1.5,
};

function placement(bounds: Placement['bounds'], savedAt = 1): Placement {
  return { bounds, maximized: false, savedAt };
}

describe('displayKey', () => {
  it('is independent of enumeration order', () => {
    expect(displayKey([primary, secondary])).toBe(displayKey([secondary, primary]));
    expect(displayKey([primary, secondary])).toBe('0,0,1920,1080@1|1920,0,2560,1440@1.5');
  });

  it('includes the scale factor and changes when a display is added', () => {
    expect(displayKey([primary])).toBe('0,0,1920,1080@1');
    expect(displayKey([{ ...primary, scaleFactor: 2 }])).toBe('0,0,1920,1080@2');
    expect(displayKey([primary])).not.toBe(displayKey([primary, secondary]));
  });

  it('sorts by x then y', () => {
    const below: DisplayInfo = { ...primary, bounds: { x: 0, y: 1080, width: 1920, height: 1080 } };
    expect(displayKey([below, primary])).toBe('0,0,1920,1080@1|0,1080,1920,1080@1');
  });
});

describe('pickPlacement', () => {
  const key = displayKey([primary]);

  it('returns null when nothing is saved for the key', () => {
    expect(pickPlacement({}, key, [primary])).toBeNull();
    expect(pickPlacement({ other: placement({ x: 0, y: 0, width: 100, height: 100 }) }, key, [primary])).toBeNull();
  });

  it('returns the placement when it is on screen', () => {
    const saved = { [key]: placement({ x: 100, y: 100, width: 1400, height: 900 }) };
    expect(pickPlacement(saved, key, [primary])).toBe(saved[key]);
  });

  it('returns null when the window is fully off screen', () => {
    const saved = { [key]: placement({ x: 5000, y: 5000, width: 1400, height: 900 }) };
    expect(pickPlacement(saved, key, [primary])).toBeNull();
  });

  it('requires at least 50% of the area to intersect a work area', () => {
    // 1000 wide, 600 of it off the right edge → 40% visible.
    const forty = { [key]: placement({ x: 1920 - 400, y: 0, width: 1000, height: 500 }) };
    expect(pickPlacement(forty, key, [primary])).toBeNull();
    // 600 of 1000 visible → 60%.
    const sixty = { [key]: placement({ x: 1920 - 600, y: 0, width: 1000, height: 500 }) };
    expect(pickPlacement(sixty, key, [primary])).toBe(sixty[key]);
    // Spanning two displays: 40% on primary, 60% on secondary → the secondary qualifies.
    const straddle = { [key]: placement({ x: 1920 - 400, y: 0, width: 1000, height: 500 }) };
    expect(pickPlacement(straddle, key, [primary, secondary])).toBe(straddle[key]);
    expect(isMostlyVisible({ x: 1920 - 400, y: 0, width: 1000, height: 500 }, [primary])).toBe(false);
  });

  it('ignores degenerate bounds', () => {
    const saved = { [key]: placement({ x: 0, y: 0, width: 0, height: 0 }) };
    expect(pickPlacement(saved, key, [primary])).toBeNull();
  });
});

describe('rememberPlacement', () => {
  it('replaces an existing key and evicts the oldest savedAt past the cap', () => {
    let saved: Record<string, Placement> = {};
    for (let i = 0; i < 20; i += 1) {
      saved = rememberPlacement(saved, `k${i}`, placement({ x: i, y: 0, width: 10, height: 10 }, i + 1));
    }
    expect(Object.keys(saved)).toHaveLength(20);
    saved = rememberPlacement(saved, 'new', placement({ x: 0, y: 0, width: 10, height: 10 }, 100));
    expect(Object.keys(saved)).toHaveLength(20);
    expect(saved.k0).toBeUndefined();
    expect(saved.new?.savedAt).toBe(100);
    expect(saved.k1).toBeDefined();
    // Updating an existing key does not evict anything.
    saved = rememberPlacement(saved, 'k5', placement({ x: 0, y: 0, width: 10, height: 10 }, 200));
    expect(Object.keys(saved)).toHaveLength(20);
    expect(saved.k5?.savedAt).toBe(200);
  });

  it('honours a custom cap and does not mutate the input', () => {
    const original = { a: placement({ x: 0, y: 0, width: 1, height: 1 }, 1) };
    const next = rememberPlacement(original, 'b', placement({ x: 0, y: 0, width: 1, height: 1 }, 2), 1);
    expect(next).toEqual({ b: next.b });
    expect(original).toEqual({ a: original.a });
  });
});
