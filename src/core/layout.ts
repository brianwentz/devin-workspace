export interface Size {
  width: number;
  height: number;
}

export interface Rect extends Size {
  x: number;
  y: number;
}

export interface LayoutState {
  paneOpen: boolean;
  paneFraction: number; // pane share of (windowWidth - RAIL_WIDTH - SPLITTER_WIDTH); 0..1
  terminalOpen: boolean;
  terminalHeight: number; // px
}

export interface WindowBounds {
  devin: Rect;
  ghTab: Rect | null;
  splitter: Rect | null;
  titleBar: Rect | null;
  terminal: Rect | null;
  terminalSplitter: Rect | null;
  rail: Rect;
  paneCollapsed: boolean;
}

export const RAIL_WIDTH = 56;
export const SPLITTER_WIDTH = 6;
export const TITLE_BAR_HEIGHT = 36;
export const MIN_PANE_WIDTH = 320;
// 640 keeps the default 50/50 split real at the 1400 px default window
// (available 1338 → 669 / 669). Auto-collapse threshold: 56 + 6 + 640 + 320 = 1022.
export const MIN_DEVIN_WIDTH = 640;
export const DEFAULT_PANE_FRACTION = 0.5;
export const DEFAULT_TERMINAL_HEIGHT = 280;
export const MIN_TERMINAL_HEIGHT = 120;
// Minimum px the main column keeps above an open terminal dock (below the title bar).
export const TERMINAL_RESERVED_MAIN = 200;

export function clampTerminalHeight(height: number, windowHeight: number): number {
  const max = Math.max(
    MIN_TERMINAL_HEIGHT,
    windowHeight - TITLE_BAR_HEIGHT - TERMINAL_RESERVED_MAIN,
  );
  return Math.min(max, Math.max(MIN_TERMINAL_HEIGHT, Math.round(height)));
}

// Persisted fraction sanitiser: 0..1, default for non-finite input. The px
// guards are NOT applied here — they are derived in computeBounds so the stored
// preference survives a temporarily small window.
export function clampFraction01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : DEFAULT_PANE_FRACTION;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

// Width the pane and the devin view share (window minus rail minus splitter).
export function paneAvailable(windowWidth: number): number {
  return Math.max(0, Math.floor(windowWidth) - RAIL_WIDTH - SPLITTER_WIDTH);
}

// Pane width in px for a fraction (not clamped to the px guards).
export function paneWidthPx(fraction: number, windowWidth: number): number {
  const safe = Number.isFinite(fraction) ? clamp01(fraction) : DEFAULT_PANE_FRACTION;
  return Math.round(safe * paneAvailable(windowWidth));
}

// Fraction for a pane width in px (clamped to 0..1).
export function fractionFromPx(px: number, windowWidth: number): number {
  const available = paneAvailable(windowWidth);
  if (available <= 0 || !Number.isFinite(px)) return DEFAULT_PANE_FRACTION;
  return clamp01(px / available);
}

// px guards: the pane never drops below MIN_PANE_WIDTH and the devin view keeps
// MIN_DEVIN_WIDTH (when the window is too narrow for both, the smaller wins and
// computeBounds auto-collapses the pane).
export function clampPaneWidth(width: number, windowWidth: number): number {
  const max = Math.max(0, windowWidth - RAIL_WIDTH - SPLITTER_WIDTH - MIN_DEVIN_WIDTH);
  const min = Math.min(MIN_PANE_WIDTH, max);
  return Math.min(max, Math.max(min, Math.round(width)));
}

export function computeBounds(
  windowSize: Size,
  layout: LayoutState,
): WindowBounds {
  const width = Math.max(0, Math.floor(windowSize.width));
  const height = Math.max(0, Math.floor(windowSize.height));
  const rail: Rect = { x: 0, y: 0, width: Math.min(RAIL_WIDTH, width), height };
  const titleBar: Rect = {
    x: 0,
    y: 0,
    width,
    height: Math.min(TITLE_BAR_HEIGHT, height),
  };

  const terminalHeight = layout.terminalOpen
    ? clampTerminalHeight(layout.terminalHeight, height)
    : 0;
  // Dock rects sit at the bottom of the devin column only — pane rects are
  // unaffected. devinHeight is the main column height below the title bar.
  const dock = (devinColumnWidth: number) => {
    if (terminalHeight === 0) {
      return {
        terminal: null,
        terminalSplitter: null,
        devinHeight: Math.max(0, height - TITLE_BAR_HEIGHT),
      };
    }
    return {
      terminal: {
        x: rail.width,
        y: height - terminalHeight,
        width: devinColumnWidth,
        height: terminalHeight,
      } as Rect,
      terminalSplitter: {
        x: rail.width,
        y: height - terminalHeight - SPLITTER_WIDTH,
        width: devinColumnWidth,
        height: SPLITTER_WIDTH,
      } as Rect,
      devinHeight: Math.max(0, height - TITLE_BAR_HEIGHT - terminalHeight - SPLITTER_WIDTH),
    };
  };

  if (!layout.paneOpen) {
    const docked = dock(Math.max(0, width - rail.width));
    return {
      rail,
      titleBar,
      devin: {
        x: rail.width,
        y: TITLE_BAR_HEIGHT,
        width: Math.max(0, width - rail.width),
        height: docked.devinHeight,
      },
      ghTab: null,
      splitter: null,
      terminal: docked.terminal,
      terminalSplitter: docked.terminalSplitter,
      paneCollapsed: false,
    };
  }

  // Auto-collapse the pane when there is not enough room for both the minimum
  // pane width and the minimum devin width. Otherwise the pane is capped at the
  // width that leaves MIN_DEVIN_WIDTH for the devin view. The user's paneOpen
  // preference is not mutated — collapse is purely derived.
  const allowedMax = width - rail.width - SPLITTER_WIDTH - MIN_DEVIN_WIDTH;
  if (allowedMax < MIN_PANE_WIDTH) {
    const closed = computeBounds(windowSize, { ...layout, paneOpen: false });
    return { ...closed, paneCollapsed: true };
  }
  const paneCollapsed = false;
  const paneWidth = clampPaneWidth(
    Math.min(paneWidthPx(layout.paneFraction, width), allowedMax),
    width,
  );
  const splitterX = Math.max(rail.width, width - paneWidth - SPLITTER_WIDTH);
  const paneX = Math.min(width, splitterX + SPLITTER_WIDTH);
  const paneActualWidth = Math.max(0, width - paneX);
  const docked = dock(Math.max(0, splitterX - rail.width));

  return {
    rail,
    titleBar,
    devin: {
      x: rail.width,
      y: TITLE_BAR_HEIGHT,
      width: Math.max(0, splitterX - rail.width),
      height: docked.devinHeight,
    },
    splitter: {
      x: splitterX,
      y: TITLE_BAR_HEIGHT,
      width: Math.min(SPLITTER_WIDTH, Math.max(0, width - splitterX)),
      height: Math.max(0, height - TITLE_BAR_HEIGHT),
    },
    ghTab: {
      x: paneX,
      y: TITLE_BAR_HEIGHT,
      width: paneActualWidth,
      height: Math.max(0, height - TITLE_BAR_HEIGHT),
    },
    terminal: docked.terminal,
    terminalSplitter: docked.terminalSplitter,
    paneCollapsed,
  };
}
