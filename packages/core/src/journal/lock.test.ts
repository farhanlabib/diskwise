import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { acquireLock } from './lock';

const dirs: string[] = [];

async function makeDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'macsweep-lock-'));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('acquireLock', () => {
  it('throws LOCKED while another live process holds the lock', async () => {
    const dir = await makeDir();
    const lockPath = join(dir, 'lock');

    const release = await acquireLock(lockPath);
    await expect(acquireLock(lockPath)).rejects.toThrow(/LOCKED/);

    await release();
  });

  it('takes over a stale lock left by a dead pid', async () => {
    const dir = await makeDir();
    const lockPath = join(dir, 'lock');
    await writeFile(lockPath, JSON.stringify({ pid: 999999, startedAt: '2026-01-01T00:00:00.000Z' }));

    const release = await acquireLock(lockPath);
    await release();

    await expect(readFile(lockPath, 'utf8')).rejects.toThrow();
  });

  it('takes over a garbage lock file', async () => {
    const dir = await makeDir();
    const lockPath = join(dir, 'lock');
    await writeFile(lockPath, 'not json at all');

    const release = await acquireLock(lockPath);
    await release();

    await expect(readFile(lockPath, 'utf8')).rejects.toThrow();
  });

  it('release is idempotent', async () => {
    const dir = await makeDir();
    const lockPath = join(dir, 'lock');

    const release = await acquireLock(lockPath);
    await release();

    await expect(release()).resolves.toBeUndefined();
  });
});
