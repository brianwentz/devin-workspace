export interface Size {
  width: number;
  height: number;
}

export interface Rect extends Size {
  x: number;
  y: number;
}

export interface PaneState {
  paneOpen: boolean;
  paneWidth: number;
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
export const MIN_DEVIN_WIDTH = 768;
export const DEFAULT_PANE_WIDTH = 560;
export const DEFAULT_PANE_FRACTION = 0.5;
export const DEFAULT_TERMINAL_HEIGHT = 280;

export function clampPaneWidth(width: number, windowWidth: number): number {
  const max = Math.max(
    0,
    Math.min(1200, windowWidth - RAIL_WIDTH - SPLITTER_WIDTH - MIN_DEVIN_WIDTH),
  );
  const min = Math.min(MIN_PANE_WIDTH, max);
  return Math.min(max, Math.max(min, Math.round(width)));
}

export function computeBounds(
  windowSize: Size,
  paneState: PaneState,
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

  if (!paneState.paneOpen) {
    return {
      rail,
      titleBar,
      devin: {
        x: rail.width,
        y: TITLE_BAR_HEIGHT,
        width: Math.max(0, width - rail.width),
        height: Math.max(0, height - TITLE_BAR_HEIGHT),
      },
      ghTab: null,
      splitter: null,
      terminal: null,
      terminalSplitter: null,
      paneCollapsed: false,
    };
  }

  // Auto-collapse the pane when there is not enough room for both the minimum
  // pane width and the minimum devin width. Otherwise the pane is capped at the
  // width that leaves MIN_DEVIN_WIDTH for the devin view. The user's paneOpen
  // preference is not mutated — collapse is purely derived.
  const allowedMax = width - rail.width - SPLITTER_WIDTH - MIN_DEVIN_WIDTH;
  if (allowedMax < MIN_PANE_WIDTH) {
    const closed = computeBounds(windowSize, {
      paneOpen: false,
      paneWidth: paneState.paneWidth,
    });
    return { ...closed, paneCollapsed: true };
  }
  const paneCollapsed = false;
  const paneWidth = clampPaneWidth(Math.min(paneState.paneWidth, allowedMax), width);
  const splitterX = Math.max(rail.width, width - paneWidth - SPLITTER_WIDTH);
  const paneX = Math.min(width, splitterX + SPLITTER_WIDTH);
  const paneActualWidth = Math.max(0, width - paneX);

  return {
    rail,
    titleBar,
    devin: {
      x: rail.width,
      y: TITLE_BAR_HEIGHT,
      width: Math.max(0, splitterX - rail.width),
      height: Math.max(0, height - TITLE_BAR_HEIGHT),
    },
    splitter: {
      x: splitterX,
      y: 0,
      width: Math.min(SPLITTER_WIDTH, Math.max(0, width - splitterX)),
      height,
    },
    ghTab: {
      x: paneX,
      y: TITLE_BAR_HEIGHT,
      width: paneActualWidth,
      height: Math.max(0, height - TITLE_BAR_HEIGHT),
    },
    terminal: null,
    terminalSplitter: null,
    paneCollapsed,
  };
}
