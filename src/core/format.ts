// Pure formatting helpers shared by the shell.

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  if (minutes < 60) return `${minutes}m ${String(total % 60).padStart(2, '0')}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

// Compact SI-ish counts: 842 → '842', 1,000 → '1.0k', 1,234 → '1.2k',
// 84,795 → '84.8k', 200,000 → '200k', 1,200,000 → '1.2M'.
export function formatTokens(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const abs = Math.abs(n);
  if (abs < 1000) return `${Math.round(n)}`;
  for (const [divisor, suffix] of [[1e6, 'M'], [1e3, 'k']] as const) {
    if (abs >= divisor) {
      const scaled = n / divisor;
      return scaled >= 100 ? `${Math.round(scaled)}${suffix}` : `${scaled.toFixed(1)}${suffix}`;
    }
  }
  return `${Math.round(n)}`;
}
