import { mkdir, mkdtemp, realpath, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ProbeRunner, Rule } from '../types';
import { scan } from './scan';
import { isTrap } from './traps';

const noProbe: ProbeRunner = async () => ({ stdout: '', stderr: '', exitCode: 127 });

const base = {
  schemaVersion: 1,
  category: 'dev',
  rationale: 'Test rule rationale that is long enough.',
  regeneration: 'Rebuilt by the test.',
} as const;

describe('scan', () => {
  let home: string;

  beforeAll(async () => {
    home = await realpath(await mkdtemp(join(tmpdir(), 'macsweep-scan-')));
    const derived = join(home, 'Library/Developer/Xcode/DerivedData');
    await mkdir(join(derived, 'App-abc'), { recursive: true });
    await writeFile(join(derived, 'App-abc/blob'), Buffer.alloc(2_000_000, 1));
    for (const [name, lock] of [
      ['locked', true],
      ['unlocked', false],
    ] as const) {
      const project = join(home, 'code', name);
      await mkdir(join(project, 'node_modules/dep'), { recursive: true });
      await writeFile(join(project, 'node_modules/dep/index.js'), Buffer.alloc(1_000_000, 1));
      await writeFile(join(project, 'package.json'), '{}');
      if (lock) await writeFile(join(project, 'package-lock.json'), '{}');
      const old = new Date(Date.now() - 60 * 86400_000);
      await utimes(join(project, 'package.json'), old, old);
      await utimes(join(project, 'node_modules'), old, old);
    }
  });

  afterAll(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it('measures rule matches and splits guard-downgraded items into report-only findings', async () => {
    const rules: Rule[] = [
      {
        ...base,
        id: 'test.derived',
        title: 'Derived',
        tier: 0,
        roots: ['~/Library/Developer/Xcode/DerivedData'],
        matcher: { kind: 'glob-children', root: '~/Library/Developer/Xcode/DerivedData' },
        action: 'remove-path',
        minBytes: 1,
      },
      {
        ...base,
        id: 'test.node-modules',
        title: 'node_modules',
        tier: 1,
        roots: ['~'],
        matcher: {
          kind: 'project-dirs',
          searchRoots: ['~'],
          name: 'node_modules',
          marker: 'package.json',
          maxAgeDays: 14,
          excludePrefixes: [],
        },
        action: 'remove-path',
        minBytes: 1,
      },
    ];
    const { findings } = await scan({ home, rules, run: noProbe });
    const derived = findings.find((f) => f.ruleId === 'test.derived');
    expect(derived?.totals.allocated).toBeGreaterThanOrEqual(2_000_000);
    expect(derived?.matches[0]?.ino).toBeTypeOf('number');

    const nm = findings.filter((f) => f.ruleId === 'test.node-modules');
    expect(nm.map((f) => f.tier).sort()).toEqual([1, 2]);
    const reportOnly = nm.find((f) => f.tier === 2);
    expect(reportOnly?.action).toBeNull();
    expect(findings.map((f) => f.tier)).toEqual([...findings.map((f) => f.tier)].sort());
  });

  it('drops findings below minBytes', async () => {
    const rules: Rule[] = [
      {
        ...base,
        id: 'test.tiny',
        title: 'Tiny',
        tier: 0,
        roots: ['~/code'],
        matcher: { kind: 'path', path: '~/code' },
        action: 'remove-path',
        minBytes: 1e12,
      },
    ];
    const { findings } = await scan({ home, rules, run: noProbe });
    expect(findings).toEqual([]);
  });

  it('flags sparse traps only when apparent size far exceeds allocated', () => {
    expect(isTrap(2.7e9, 228e9)).toBe(true);
    expect(isTrap(10e9, 12e9)).toBe(false);
  });
});
