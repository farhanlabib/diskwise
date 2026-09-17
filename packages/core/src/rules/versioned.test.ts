import { mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MatcherContext } from '../types';
import { compareVersions, extractVersion, runVersionedChildren } from './versioned';

let home: string;

function ctx(): MatcherContext {
  return {
    home,
    now: new Date(),
    run: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
  };
}

async function makeDirs(...names: string[]): Promise<void> {
  for (const name of names) await mkdir(join(home, name), { recursive: true });
}

beforeAll(async () => {
  home = await realpath(await mkdtemp(join(tmpdir(), 'diskwise-versioned-')));

  await makeDirs(
    'ios/15.0 (A)',
    'ios/16.1 (B)',
    'ios/17.4 (C)',
    'ios/17.5 (D)',
    'sdks/MacOSX13.3.sdk',
    'sdks/MacOSX14.2.sdk',
    'sdks/MacOSX15.0.sdk',
    'mix/other-15.0',
    'mix/MacOSX14.2.sdk',
    'mix/MacOSX13.0.sdk',
    'symdir/MacOSX13.0.sdk',
    'symdir/MacOSX14.0.sdk',
    'symdir/target',
  );
  await symlink('MacOSX14.2.sdk', join(home, 'sdks', 'MacOSX.sdk'));
  await symlink('target', join(home, 'symdir', 'MacOSX99.0.sdk'));
});

afterAll(async () => {
  if (home) await rm(home, { recursive: true, force: true });
});

describe('extractVersion', () => {
  it('reads the first version-looking run in a name', () => {
    expect(extractVersion('17.4 (21E213)')).toEqual([17, 4]);
    expect(extractVersion('MacOSX14.2.sdk')).toEqual([14, 2]);
  });

  it('returns null when the name has no version', () => {
    expect(extractVersion('no-version')).toBeNull();
  });
});

describe('compareVersions', () => {
  it('compares numerically, not lexically', () => {
    expect(compareVersions([10, 0], [9, 9, 9])).toBeGreaterThan(0);
    expect(compareVersions([9, 9, 9], [10, 0])).toBeLessThan(0);
  });

  it('treats missing parts as zero', () => {
    expect(compareVersions([15], [15, 0])).toBe(0);
    expect(compareVersions([15, 1], [15])).toBeGreaterThan(0);
  });
});

describe('runVersionedChildren', () => {
  it('returns every version older than the newest keepNewest', async () => {
    const found = await runVersionedChildren(
      { kind: 'versioned-children', root: '~/ios', keepNewest: 2 },
      ctx(),
    );
    expect(found.map((c) => c.detail).sort()).toEqual(['15.0 (A)', '16.1 (B)']);
    expect(found.every((c) => c.kind === 'dir')).toBe(true);
  });

  it('protects the target of a sibling symlink even when it is not newest', async () => {
    const found = await runVersionedChildren(
      {
        kind: 'versioned-children',
        root: '~/sdks',
        include: ['MacOSX*.sdk'],
        keepNewest: 1,
      },
      ctx(),
    );
    expect(found.map((c) => c.detail)).toEqual(['MacOSX13.3.sdk']);
  });

  it('ignores children that do not match the include glob', async () => {
    const found = await runVersionedChildren(
      {
        kind: 'versioned-children',
        root: '~/mix',
        include: ['MacOSX*.sdk'],
        keepNewest: 1,
      },
      ctx(),
    );
    expect(found.map((c) => c.detail)).toEqual(['MacOSX13.0.sdk']);
  });

  it('returns [] for a missing root', async () => {
    expect(
      await runVersionedChildren({ kind: 'versioned-children', root: '~/absent', keepNewest: 1 }, ctx()),
    ).toEqual([]);
  });

  it('never treats a symlinked child as a candidate', async () => {
    const found = await runVersionedChildren(
      {
        kind: 'versioned-children',
        root: '~/symdir',
        include: ['MacOSX*.sdk'],
        keepNewest: 1,
      },
      ctx(),
    );
    expect(found.map((c) => c.detail)).toEqual(['MacOSX13.0.sdk']);
  });
});
