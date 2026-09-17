import type { Stats } from 'node:fs';

export function sizeOfStats(st: Stats): { allocated: number; apparent: number } {
  return { allocated: st.blocks * 512, apparent: st.size };
}

export function isCloudPlaceholder(st: Stats, path: string): boolean {
  const inCloud =
    path.includes('/Library/CloudStorage/') || path.includes('/Library/Mobile Documents/');
  return inCloud && st.isFile() && st.blocks === 0 && st.size > 0;
}
