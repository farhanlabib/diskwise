// Decimal units, the way Finder counts (1 GB = 1e9 bytes). One decimal from KB up.
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  if (n < 1000) return `${Math.round(n)} B`;
  let value = n;
  let unit = 'B';
  for (const next of ['KB', 'MB', 'GB', 'TB', 'PB']) {
    if (value < 1000) break;
    value /= 1000;
    unit = next;
  }
  return `${value.toFixed(1)} ${unit}`;
}
