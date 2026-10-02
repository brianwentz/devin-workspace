import { describe, expect, it } from 'vitest';
import {
  clampFraction01,
  clampPaneWidth,
  clampTerminalHeight,
  computeBounds,
  DEFAULT_PANE_FRACTION,
  DEFAULT_TERMINAL_HEIGHT,
  fractionFromPx,
  MIN_TERMINAL_HEIGHT,
  paneAvailable,
  paneWidthPx,
  type LayoutState,
} from '../../src/core/layout';

function layout(overrides: Partial<LayoutState> = {}): LayoutState {
  return {
    paneOpen: true,
    paneFraction: DEFAULT_PANE_FRACTION,
    terminalOpen: false,
    terminalHeight: DEFAULT_TERMINAL_HEIGHT,
    ...overrides,
  };
}

// 1400 window: available = 1400 - 56 - 6 = 1338; 560 px = fraction 560/1338.
const F560 = 560 / 1338;

describe('computeBounds', () => {
  it('places the rail, title bar, conversation, splitter, and browser pane', () => {
    const bounds = computeBounds({ width: 1400, height: 900 }, layout({ paneFraction: F560 }));
    expect(bounds.rail).toEqual({ x: 0, y: 0, width: 56, height: 900 });
    expect(bounds.titleBar).toEqual({ x: 0, y: 0, width: 1400, height: 36 });
    expect(bounds.splitter).toEqual({ x: 834, y: 0, width: 6, height: 900 });
    expect(bounds.devin).toEqual({ x: 56, y: 36, width: 778, height: 864 });
    expect(bounds.ghTab).toEqual({ x: 840, y: 36, width: 560, height: 864 });
    expect(bounds.terminal).toBeNull();
    expect(bounds.terminalSplitter).toBeNull();
  });

  it('splits 50/50 at the 1400 px default window', () => {
    // 1400 - 56 - 6 = 1338 available → 669 px each side (both ≥ MIN_DEVIN_WIDTH 640).
    const bounds = computeBounds({ width: 1400, height: 900 }, layout());
    expect(bounds.ghTab?.width).toBe(669);
    expect(bounds.devin.width).toBe(669);
    expect(bounds.splitter?.x).toBe(725);
    expect(bounds.ghTab?.x).toBe(731);
    expect(bounds.paneCollapsed).toBe(false);
  });

  it('splits 50/50 in a wide window too', () => {
    // 2000 - 56 - 6 = 1938 available → 969 px each side.
    const bounds = computeBounds({ width: 2000, height: 900 }, layout());
    expect(bounds.ghTab?.width).toBe(969);
    expect(bounds.devin.width).toBe(969);
    expect(bounds.splitter?.x).toBe(1025);
  });

  it('clamps the rendered pane in a small window without touching the input fraction', () => {
    // 1000 - 56 - 6 = 938 available; 0.5 → 469 px, but allowedMax is 1000 - 56 - 6 - 640 = 298
    // < MIN_PANE_WIDTH, so the pane auto-collapses. Just above the threshold the pane is
    // capped at allowedMax while the devin view keeps MIN_DEVIN_WIDTH.
    const input = layout({ paneFraction: 0.5 });
    const snapshot = { ...input };
    const collapsed = computeBounds({ width: 1000, height: 800 }, input);
    expect(collapsed.paneCollapsed).toBe(true);
    expect(collapsed.ghTab).toBeNull();
    expect(collapsed.devin.width).toBe(944);
    const capped = computeBounds({ width: 1100, height: 800 }, input);
    // 1100 - 56 - 6 - 640 = 398 allowed; 0.5 * 1038 = 519 requested → 398.
    expect(capped.paneCollapsed).toBe(false);
    expect(capped.ghTab?.width).toBe(398);
    expect(capped.devin.width).toBe(640);
    expect(input).toEqual(snapshot);
    expect(input.paneFraction).toBe(0.5);
  });

  it('fills the remaining window when the pane is closed', () => {
    const bounds = computeBounds({ width: 1400, height: 900 }, layout({ paneOpen: false }));
    expect(bounds.devin).toEqual({ x: 56, y: 36, width: 1344, height: 864 });
    expect(bounds.ghTab).toBeNull();
    expect(bounds.splitter).toBeNull();
    expect(bounds.titleBar).toEqual({ x: 0, y: 0, width: 1400, height: 36 });
    expect(bounds.terminal).toBeNull();
    expect(bounds.terminalSplitter).toBeNull();
  });

  it('keeps all regions within undersized dimensions', () => {
    const bounds = computeBounds({ width: 1400, height: 20 }, layout({ paneFraction: F560 }));
    expect(bounds.titleBar?.height).toBe(20);
    expect(bounds.devin.width).toBe(778);
    expect(bounds.devin.height).toBe(0);
    expect(bounds.ghTab?.width).toBe(560);
    expect(bounds.ghTab?.height).toBe(0);
    expect(bounds.paneCollapsed).toBe(false);
  });

  it('caps a too-wide pane at the width that leaves MIN_DEVIN_WIDTH', () => {
    // 1400 - 56 - 6 - 640 = 698: pane wider than allowed shrinks to allowedMax.
    const bounds = computeBounds({ width: 1400, height: 900 }, layout({ paneFraction: 0.9 }));
    expect(bounds.paneCollapsed).toBe(false);
    expect(bounds.ghTab?.width).toBe(698);
    expect(bounds.devin.width).toBe(640);
  });

  it('stays open at the boundary where allowedMax equals MIN_PANE_WIDTH', () => {
    // 1022 - 56 - 6 - 640 = 320 = MIN_PANE_WIDTH exactly.
    const bounds = computeBounds({ width: 1022, height: 900 }, layout());
    expect(bounds.paneCollapsed).toBe(false);
    expect(bounds.ghTab?.width).toBe(320);
    expect(bounds.devin.width).toBe(640);
  });

  it('auto-collapses the pane when allowedMax is below MIN_PANE_WIDTH', () => {
    // 1021 - 56 - 6 - 640 = 319 < 320: collapse.
    const bounds = computeBounds({ width: 1021, height: 900 }, layout());
    expect(bounds.paneCollapsed).toBe(true);
    expect(bounds.ghTab).toBeNull();
    expect(bounds.devin.width).toBe(965);
    const closed = computeBounds({ width: 1021, height: 900 }, layout({ paneOpen: false }));
    expect(closed.paneCollapsed).toBe(false);
  });

  it('docks the terminal under the devin column and shrinks devin', () => {
    const bounds = computeBounds({ width: 1400, height: 900 },
      layout({ paneFraction: F560, terminalOpen: true, terminalHeight: 280 }));
    // devin column ends at the splitter (x=834); the dock spans rail..splitterX.
    expect(bounds.devin).toEqual({ x: 56, y: 36, width: 778, height: 578 });
    expect(bounds.terminalSplitter).toEqual({ x: 56, y: 614, width: 778, height: 6 });
    expect(bounds.terminal).toEqual({ x: 56, y: 620, width: 778, height: 280 });
    // Pane rects are unaffected.
    expect(bounds.ghTab).toEqual({ x: 840, y: 36, width: 560, height: 864 });
  });

  it('docks the terminal across the full width when the pane is closed', () => {
    const bounds = computeBounds({ width: 1400, height: 900 },
      layout({ paneOpen: false, terminalOpen: true, terminalHeight: DEFAULT_TERMINAL_HEIGHT }));
    expect(bounds.devin.height).toBe(578);
    expect(bounds.terminal).toEqual({ x: 56, y: 620, width: 1344, height: 280 });
    expect(bounds.terminalSplitter).toEqual({ x: 56, y: 614, width: 1344, height: 6 });
  });

  it('clamps the terminal height and survives tiny windows', () => {
    expect(clampTerminalHeight(50, 900)).toBe(MIN_TERMINAL_HEIGHT);
    // max = 900 - TITLE_BAR_HEIGHT - 200 = 664
    expect(clampTerminalHeight(9999, 900)).toBe(664);
    expect(clampTerminalHeight(280, 200)).toBe(MIN_TERMINAL_HEIGHT); // tiny window keeps the min

    const bounds = computeBounds({ width: 1400, height: 300 },
      layout({ paneFraction: F560, terminalOpen: true, terminalHeight: 500 }));
    // clamped to 300 - 36 - 200 = 64 → min 120
    expect(bounds.terminal?.height).toBe(MIN_TERMINAL_HEIGHT);
    expect(bounds.devin.height).toBe(138);
    expect(bounds.terminalSplitter?.y).toBe(174);
  });
});

describe('pane fraction helpers', () => {
  it('converts between px and fraction over the available width', () => {
    expect(paneAvailable(1400)).toBe(1338);
    expect(paneAvailable(10)).toBe(0);
    expect(paneWidthPx(0.5, 1400)).toBe(669);
    expect(paneWidthPx(0.5, 2000)).toBe(969);
    expect(fractionFromPx(669, 1400)).toBeCloseTo(0.5, 6);
    expect(paneWidthPx(fractionFromPx(500, 1400), 1400)).toBe(500);
  });

  it('clamps px to [0, 1] and falls back to the default for bad input', () => {
    expect(fractionFromPx(-50, 1400)).toBe(0);
    expect(fractionFromPx(5000, 1400)).toBe(1);
    expect(fractionFromPx(500, 10)).toBe(DEFAULT_PANE_FRACTION);
    expect(fractionFromPx(Number.NaN, 1400)).toBe(DEFAULT_PANE_FRACTION);
    expect(paneWidthPx(Number.NaN, 1400)).toBe(669);
    expect(paneWidthPx(7, 1400)).toBe(1338);
  });

  it('clampPaneWidth keeps the px guards (no 1200 px cap)', () => {
    // Too small → MIN_PANE_WIDTH 320.
    expect(clampPaneWidth(1, 1400)).toBe(320);
    // Too large → devin keeps MIN_DEVIN_WIDTH: 1400 - 56 - 6 - 640 = 698.
    expect(clampPaneWidth(2000, 1400)).toBe(698);
    // In range → unchanged px.
    expect(clampPaneWidth(500, 1400)).toBe(500);
    // Wide window: 3000 - 56 - 6 - 640 = 2298 > 1200 — the old cap is gone.
    expect(clampPaneWidth(2500, 3000)).toBe(2298);
  });

  it('clampFraction01 sanitises the persisted preference without px guards', () => {
    expect(clampFraction01(0.05)).toBe(0.05);
    expect(clampFraction01(0.95)).toBe(0.95);
    expect(clampFraction01(-1)).toBe(0);
    expect(clampFraction01(2)).toBe(1);
    expect(clampFraction01(Number.NaN)).toBe(DEFAULT_PANE_FRACTION);
  });
});
