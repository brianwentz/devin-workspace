import { badgeSpec } from '../core/badge';

// Draws the taskbar badge (Slack-style red circle + white bold label) on an
// offscreen canvas; main applies the resulting PNG via setOverlayIcon.
export function renderBadgeDataUrl(count: number, size: number): string | null {
  const spec = badgeSpec(count, size);
  if (!spec.label) return null;
  const canvas = document.createElement('canvas');
  canvas.width = spec.size;
  canvas.height = spec.size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.clearRect(0, 0, spec.size, spec.size);
  ctx.fillStyle = spec.color;
  ctx.beginPath();
  ctx.arc(spec.size / 2, spec.size / 2, spec.size / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = `700 ${spec.fontPx}px "Segoe UI", Helvetica, Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // Optical centring: nudge the baseline a hair under the geometric centre.
  ctx.fillText(spec.label, spec.size / 2, spec.size / 2 + spec.size * 0.02);
  return canvas.toDataURL('image/png');
}
