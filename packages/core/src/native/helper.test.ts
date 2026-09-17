import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { link, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runningApps, trashItem, treeSize, volumeCapacity } from './helper';

const helperPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../native-helper/bin/diskwise-helper',
);
const helperBuilt = existsSync(helperPath);

function runHelper(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(helperPath, args, { encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr?.trim() || error.message));
        return;
      }
      resolve(stdout);
    });
  });
}

describe.skipIf(!helperBuilt)('native helper', () => {
  it('reports its version', async () => {
    const stdout = await runHelper(['version']);
    expect(JSON.parse(stdout)).toEqual({ ok: true, version: '0.1.0' });
  });

  it('reports volume capacity for the boot volume', async () => {
    const result = await volumeCapacity('/');
    expect(result.ok).toBe(true);
    expect(result.total).toBeGreaterThan(0);
    expect(result.available).toBeGreaterThan(0);
    expect(result.purgeableEstimate).toBeGreaterThanOrEqual(0);
  });

  it('lists running apps with bundle identifiers', async () => {
    const result = await runningApps();
    expect(result.apps.length).toBeGreaterThan(0);
    for (const app of result.apps) {
      expect(app.bundleId.length).toBeGreaterThan(0);
      expect(typeof app.pid).toBe('number');
    }
  });

  it('trashes a file out of its original path', async () => {
    const file = path.join(tmpdir(), `diskwise-helper-test-${process.pid}-${Date.now()}.txt`);
    await writeFile(file, 'diskwise');

    const result = await trashItem(file);
    expect(result.trashedPath).toContain('.Trash');
    expect(existsSync(file)).toBe(false);

    await rm(result.trashedPath, { force: true });
    expect(existsSync(result.trashedPath)).toBe(false);
  });
});

function execFileAsync(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(bin, args, (error) => (error ? reject(error) : resolve()));
  });
}

describe.skipIf(!helperBuilt)('treeSize', () => {
  it('reports a clone-aware private size below allocated for APFS clones', async () => {
    const dir = await realpath(await mkdtemp(path.join(tmpdir(), 'diskwise-tree-')));
    try {
      const original = path.join(dir, 'original.bin');
      const clone = path.join(dir, 'clone.bin');
      await writeFile(original, randomBytes(5_000_000));
      await execFileAsync('cp', ['-c', original, clone]);

      const result = await treeSize(dir);
      expect(result.allocated).toBeGreaterThanOrEqual(9.5e6);
      if (result.privateSizeSupported) {
        expect(result.privateSize).toBeLessThan(result.allocated * 0.75);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('counts a hardlink once', async () => {
    const dir = await realpath(await mkdtemp(path.join(tmpdir(), 'diskwise-tree-')));
    try {
      const original = path.join(dir, 'original.bin');
      await writeFile(original, randomBytes(1_000_000));
      await link(original, path.join(dir, 'hardlink.bin'));

      const result = await treeSize(dir);
      // The directory plus the single deduped inode.
      expect(result.entries).toBe(2);
      expect(result.allocated).toBeLessThan(2_000_000);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('does not follow a symlink to a file outside the tree', async () => {
    const outside = await realpath(await mkdtemp(path.join(tmpdir(), 'diskwise-outside-')));
    const dir = await realpath(await mkdtemp(path.join(tmpdir(), 'diskwise-tree-')));
    try {
      const target = path.join(outside, 'target.bin');
      await writeFile(target, randomBytes(5_000_000));
      await symlink(target, path.join(dir, 'link.bin'));

      const result = await treeSize(dir);
      expect(result.allocated).toBeLessThan(1_000_000);
    } finally {
      await rm(dir, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
});
