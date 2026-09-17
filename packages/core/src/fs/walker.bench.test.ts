import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { describe, it } from 'vitest';
import { findHelper, treeSize } from '../native/helper';
import { measure } from './walker';

// Opt-in only: DISKWISE_BENCH=1 pnpm vitest run packages/core/src/fs/walker.bench.test.ts
// Read-only; it never modifies the walked trees.
const skip = [
  '/System/Volumes/Data',
  '/Volumes',
  '/dev',
  '/Library/CloudStorage',
  join(homedir(), 'Library/CloudStorage'),
  join(homedir(), 'Library/Mobile Documents'),
];

const targets = [join(homedir(), 'Library/Developer'), join(homedir(), 'Documents')];

describe.skipIf(!process.env.DISKWISE_BENCH)('measurement benchmark', () => {
  for (const target of targets) {
    it(`compares the Node walker and the native tree on ${target}`, { timeout: 300_000 }, async () => {
      if (!existsSync(target)) {
        console.log(JSON.stringify({ target, skipped: 'missing' }));
        return;
      }
      if (!(await findHelper())) {
        console.log(JSON.stringify({ target, skipped: 'helper not built' }));
        return;
      }

      const walkStart = performance.now();
      const walk = await measure(target, { skip });
      const walkMs = performance.now() - walkStart;

      const treeStart = performance.now();
      const tree = await treeSize(target, { skip });
      const treeMs = performance.now() - treeStart;

      console.log(
        JSON.stringify({
          target,
          walker: { ms: Math.round(walkMs), entries: walk.entries, bytes: walk.allocated },
          tree: {
            ms: Math.round(treeMs),
            entries: tree.entries,
            bytes: tree.allocated,
            privateBytes: tree.privateSize,
          },
        }),
      );
    });
  }
});
