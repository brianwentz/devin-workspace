import { describe, expect, it } from 'vitest';
import { clampPaneWidth, computeBounds } from '../../src/core/layout';

describe('computeBounds', () => {
  it('places the rail, title bar, conversation, splitter, and browser pane', () => {
    const bounds = computeBounds({ width: 1400, height: 900 }, { paneOpen: true, paneWidth: 560 });
    expect(bounds.rail).toEqual({ x: 0, y: 0, width: 56, height: 900 });
    expect(bounds.titleBar).toEqual({ x: 0, y: 0, width: 1400, height: 36 });
    expect(bounds.splitter).toEqual({ x: 834, y: 0, width: 6, height: 900 });
    expect(bounds.devin).toEqual({ x: 56, y: 36, width: 778, height: 864 });
    expect(bounds.ghTab).toEqual({ x: 840, y: 36, width: 560, height: 864 });
    expect(bounds.terminal).toBeNull();
    expect(bounds.terminalSplitter).toBeNull();
  });

  it('clamps the pane to both width limits', () => {
    expect(clampPaneWidth(1, 1400)).toBe(320);
    // 1400 - 56 - 6 - 768 = 570: the devin view keeps MIN_DEVIN_WIDTH.
    expect(clampPaneWidth(2000, 1400)).toBe(570);
    expect(clampPaneWidth(500, 1400)).toBe(500);
  });

  it('fills the remaining window when the pane is closed', () => {
    const bounds = computeBounds({ width: 1400, height: 900 }, { paneOpen: false, paneWidth: 560 });
    expect(bounds.devin).toEqual({ x: 56, y: 36, width: 1344, height: 864 });
    expect(bounds.ghTab).toBeNull();
    expect(bounds.splitter).toBeNull();
    expect(bounds.titleBar).toEqual({ x: 0, y: 0, width: 1400, height: 36 });
    expect(bounds.terminal).toBeNull();
    expect(bounds.terminalSplitter).toBeNull();
  });

  it('keeps all regions within undersized dimensions', () => {
    const bounds = computeBounds({ width: 1400, height: 20 }, { paneOpen: true, paneWidth: 560 });
    expect(bounds.titleBar?.height).toBe(20);
    expect(bounds.devin.width).toBe(778);
    expect(bounds.devin.height).toBe(0);
    expect(bounds.ghTab?.width).toBe(560);
    expect(bounds.ghTab?.height).toBe(0);
    expect(bounds.paneCollapsed).toBe(false);
  });

  it('caps a too-wide pane at the width that leaves MIN_DEVIN_WIDTH', () => {
    // 1400 - 56 - 6 - 768 = 570: pane wider than allowed shrinks to allowedMax.
    const bounds = computeBounds({ width: 1400, height: 900 }, { paneOpen: true, paneWidth: 1000 });
    expect(bounds.paneCollapsed).toBe(false);
    expect(bounds.ghTab?.width).toBe(570);
    expect(bounds.devin.width).toBe(768);
  });

  it('stays open at the boundary where allowedMax equals MIN_PANE_WIDTH', () => {
    // 1150 - 56 - 6 - 768 = 320 = MIN_PANE_WIDTH exactly.
    const bounds = computeBounds({ width: 1150, height: 900 }, { paneOpen: true, paneWidth: 560 });
    expect(bounds.paneCollapsed).toBe(false);
    expect(bounds.ghTab?.width).toBe(320);
    expect(bounds.devin.width).toBe(768);
  });

  it('auto-collapses the pane when allowedMax is below MIN_PANE_WIDTH', () => {
    // 1149 - 56 - 6 - 768 = 319 < 320: collapse.
    const bounds = computeBounds({ width: 1149, height: 900 }, { paneOpen: true, paneWidth: 560 });
    expect(bounds.paneCollapsed).toBe(true);
    expect(bounds.ghTab).toBeNull();
    expect(bounds.devin.width).toBe(1093);
    const closed = computeBounds({ width: 1149, height: 900 }, { paneOpen: false, paneWidth: 560 });
    expect(closed.paneCollapsed).toBe(false);
  });
});
