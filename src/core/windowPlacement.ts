import type { Rect } from './layout';

// F2: window bounds remembered per display configuration. Pure logic; the
// Electron glue (screen events, BaseWindow bounds) lives in main/windowPlacement.ts.

export interface DisplayInfo {
  bounds: Rect;
  workArea: Rect;
  scaleFactor: number;
}

export interface Placement {
  bounds: Rect;
  maximized: boolean;
  savedAt: number;
}

// Geometry-based key (display ids drift on Windows between sessions). Sorted
// by (x, y) so enumeration order does not matter.
export function displayKey(displays: ReadonlyArray<Pick<DisplayInfo, 'bounds' | 'scaleFactor'>>): string {
  return [...displays]
    .sort((a, b) => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y)
    .map(({ bounds, scaleFactor }) => `${bounds.x},${bounds.y},${bounds.width},${bounds.height}@${scaleFactor}`)
    .join('|');
}

function intersectionArea(a: Rect, b: Rect): number {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return width > 0 && height > 0 ? width * height : 0;
}

// True when at least half of `bounds` is inside some display work area.
export function isMostlyVisible(bounds: Rect, displays: ReadonlyArray<Pick<DisplayInfo, 'workArea'>>): boolean {
  const area = bounds.width * bounds.height;
  if (!(area > 0)) return false;
  return displays.some((display) => intersectionArea(bounds, display.workArea) >= area / 2);
}

// The placement saved for `key`, if it still lands on screen.
export function pickPlacement(
  saved: Record<string, Placement>,
  key: string,
  displays: ReadonlyArray<Pick<DisplayInfo, 'workArea'>>,
): Placement | null {
  const placement = saved[key];
  if (!placement) return null;
  return isMostlyVisible(placement.bounds, displays) ? placement : null;
}

// Insert/replace `key` and keep only the `max` most recently saved entries.
export function rememberPlacement(
  saved: Record<string, Placement>,
  key: string,
  placement: Placement,
  max = 20,
): Record<string, Placement> {
  const next: Record<string, Placement> = { ...saved, [key]: placement };
  const entries = Object.entries(next).sort(([, a], [, b]) => b.savedAt - a.savedAt);
  return Object.fromEntries(entries.slice(0, Math.max(1, max)));
}
