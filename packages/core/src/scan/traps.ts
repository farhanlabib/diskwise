import { lstat } from 'node:fs/promises';
import type { Trap } from '../types';
import { expandHome } from '../rules/expand';

// Known large sparse disk images that look alarming in Finder.
const KNOWN_SPARSE_FILES: { path: string; note: string }[] = [
  {
    path: '~/Library/Containers/com.docker.docker/Data/vms/0/data/Docker.raw',
    note: 'Docker Desktop disk image (sparse). Nothing to do.',
  },
  { path: '~/.orbstack/data/data.img', note: 'OrbStack disk image (sparse). Nothing to do.' },
  {
    path: '~/Library/Containers/com.utmapp.UTM/Data/Documents',
    note: 'UTM virtual machine disks may be sparse. Nothing to do.',
  },
];

const MIN_GAP_BYTES = 1e9;
const MIN_RATIO = 4;

export function isTrap(allocated: number, apparent: number): boolean {
  return apparent - allocated >= MIN_GAP_BYTES && apparent >= allocated * MIN_RATIO;
}

export async function detectTraps(home: string): Promise<Trap[]> {
  const traps: Trap[] = [];
  for (const known of KNOWN_SPARSE_FILES) {
    const path = expandHome(known.path, home);
    try {
      const st = await lstat(path);
      if (!st.isFile()) continue;
      const allocated = st.blocks * 512;
      if (isTrap(allocated, st.size)) {
        traps.push({ path, allocated, apparent: st.size, note: known.note });
      }
    } catch {
      // not present
    }
  }
  return traps;
}
