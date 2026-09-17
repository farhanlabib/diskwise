import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { SafetyError } from './errors';
import { assertSafeTarget } from './paths';

let base: string;
let home: string;
let root: string;

async function rejectionCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (err) {
    return err instanceof Error && 'code' in err ? String((err as SafetyError).code) : 'NOT_SAFETY';
  }
}

async function expectCode(
  target: string,
  roots: string[],
  code: SafetyError['code'],
  opts: { caseInsensitive?: boolean } = {},
): Promise<void> {
  const promise = assertSafeTarget(target, { roots, id: 'test' }, { home, ...opts });
  expect(await rejectionCode(promise)).toBe(code);
}

beforeAll(async () => {
  const tmp = await fs.realpath(os.tmpdir());
  base = await fs.mkdtemp(path.join(tmp, 'macsweep-safety-'));
  home = path.join(base, 'home');
  root = path.join(base, 'root');
  await fs.mkdir(path.join(home, 'Library', 'Keychains'), { recursive: true });
  await fs.mkdir(path.join(root, 'child'), { recursive: true });
  await fs.mkdir(path.join(base, 'outside'), { recursive: true });
  await fs.mkdir(path.join(base, 'caf\u00e9', 'child'), { recursive: true });
});

afterAll(async () => {
  if (base) await fs.rm(base, { recursive: true, force: true });
});

describe('canonicalTarget / assertSafeTarget', () => {
  it('accepts a valid child and returns its canonical path', async () => {
    const target = path.join(root, 'child');
    const result = await assertSafeTarget(target, { roots: [root], id: 'test' }, { home });
    expect(await fs.realpath(target)).toBe(result);
  });

  it('refuses a ../ traversal escaping the root', async () => {
    await expectCode(`${root}/../escape`, [root], 'OUTSIDE_ROOTS');
  });

  it('refuses a relative path', async () => {
    await expectCode('relative/thing', [root], 'NOT_ABSOLUTE');
  });

  it('refuses / as a target', async () => {
    await expectCode('/', ['/'], 'DENYLISTED');
  });

  it('refuses the home directory itself and home/Library', async () => {
    await expectCode(home, [base], 'DENYLISTED');
    await expectCode(path.join(home, 'Library'), [base], 'DENYLISTED');
  });

  it('refuses ~/Library/Keychains/x', async () => {
    await expectCode(path.join(home, 'Library', 'Keychains', 'x'), [base], 'DENYLISTED');
  });

  it('refuses a symlink inside the root pointing outside (parent-symlink case)', async () => {
    await fs.symlink(path.join(base, 'outside'), path.join(root, 'link'));
    await expectCode(path.join(root, 'link', 'file'), [root], 'SYMLINK_IN_PATH');
  });

  it('refuses case variants of denylisted system paths', async () => {
    await expectCode('/SYSTEM/Library', ['/'], 'DENYLISTED');
    await expectCode('/system', ['/'], 'DENYLISTED');
  });

  it('normalizes NFC vs NFD home folder names on both sides', async () => {
    const nfcDir = path.join(base, 'caf\u00e9');
    const nfdTarget = path.join(base, 'cafe\u0301', 'child');
    const result = await assertSafeTarget(nfdTarget, { roots: [nfcDir], id: 'test' }, { home });
    expect(result.normalize('NFD')).toBe(nfdTarget.normalize('NFD'));
  });

  it('refuses an app bundle directly under /Applications', async () => {
    await expectCode('/Applications/Foo.app', ['/'], 'DENYLISTED');
  });

  it('accepts a path inside a root whose case differs when caseInsensitive', async () => {
    const target = path.join(base, 'ROOT', 'child');
    const result = await assertSafeTarget(target, { roots: [root], id: 'test' }, { home });
    expect(result.normalize('NFD')).toBe(path.join(root, 'child').normalize('NFD'));
  });
});
