import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { SafetyError } from './errors';
import { assertIdentity } from './identity';

let base: string;

async function rejectionCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (err) {
    return err instanceof Error && 'code' in err ? String((err as SafetyError).code) : 'NOT_SAFETY';
  }
}

beforeAll(async () => {
  const tmp = await fs.realpath(os.tmpdir());
  base = await fs.mkdtemp(path.join(tmp, 'macsweep-identity-'));
});

afterAll(async () => {
  if (base) await fs.rm(base, { recursive: true, force: true });
});

describe('assertIdentity', () => {
  it('passes for the same inode', async () => {
    const dir = path.join(base, 'same');
    await fs.mkdir(dir);
    const stat = await fs.lstat(dir);
    await expect(
      assertIdentity(dir, { dev: stat.dev, ino: stat.ino, kind: 'dir' }),
    ).resolves.toBeUndefined();
  });

  it('throws IDENTITY_MISMATCH when replaced by a new dir at the same path', async () => {
    const dir = path.join(base, 'replaced');
    await fs.mkdir(dir);
    const stat = await fs.lstat(dir);
    await fs.rm(dir, { recursive: true, force: true });
    await fs.mkdir(dir);
    const next = await fs.lstat(dir);
    expect(next.ino).not.toBe(stat.ino);
    expect(
      await rejectionCode(assertIdentity(dir, { dev: stat.dev, ino: stat.ino, kind: 'dir' })),
    ).toBe('IDENTITY_MISMATCH');
  });

  it('throws TYPE_MISMATCH when the dir is swapped for a symlink', async () => {
    const link = path.join(base, 'swapped');
    await fs.symlink(base, link);
    const stat = await fs.lstat(link);
    expect(await rejectionCode(assertIdentity(link, { dev: stat.dev, ino: stat.ino, kind: 'dir' }))).toBe(
      'TYPE_MISMATCH',
    );
  });

  it('throws MISSING for a deleted path', async () => {
    expect(await rejectionCode(assertIdentity(path.join(base, 'gone'), { kind: 'dir' }))).toBe('MISSING');
  });

  it('is a no-op for virtual candidates', async () => {
    await expect(assertIdentity(path.join(base, 'anything'), { kind: 'virtual' })).resolves.toBeUndefined();
  });
});
