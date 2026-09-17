const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  if (unit === 0) return `${Math.round(value)} ${UNITS[0]}`;
  const rounded = value.toFixed(1).replace(/\.0$/, '');
  return `${rounded} ${UNITS[unit]}`;
}

export function middleTruncate(path: string, max: number): string {
  if (max <= 1) return '…';
  if (path.length <= max) return path;
  const keep = max - 1;
  const left = Math.ceil(keep / 2);
  const right = Math.floor(keep / 2);
  return `${path.slice(0, left)}…${path.slice(path.length - right)}`;
}

export function formatElapsed(seconds: number): string {
  return `${seconds.toFixed(1)} s`;
}

export function formatCount(n: number): string {
  return n.toLocaleString('en-US');
}
