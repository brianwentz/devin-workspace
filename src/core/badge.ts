// Taskbar badge spec. Rendering happens in the shell renderer (offscreen
// <canvas> — nativeImage can't rasterise SVG), so main only needs the pure
// label/size math from here.

// Slack's notification red.
export const BADGE_COLOR = '#e01e5a';

export function badgeLabel(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return '';
  return count > 9 ? '9+' : String(Math.floor(count));
}

export interface BadgeSpec {
  size: number;
  label: string;
  fontPx: number;
  color: string;
}

export function badgeSpec(count: number, size: number): BadgeSpec {
  const label = badgeLabel(count);
  const fontPx = Math.round(size * (label.length === 1 ? 0.62 : 0.52));
  return { size, label, fontPx, color: BADGE_COLOR };
}
