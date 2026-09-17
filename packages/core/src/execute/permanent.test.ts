import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { CleanupPlan, Match, PlanItem, ProbeRunner } from '../types';
import { executePlan } from './execute';

let base: string;

beforeAll(async () => {
  const tmp = await fs.realpath(os.tmpdir());
  base = await fs.mkdtemp(path.join(tmp, 'macsweep-permanent-'));
});

afterAll(async () => {
  if (base) await fs.rm(base, { recursive: true, force: true });
});

type Trash = (p: string) => Promise<{ trashedPath: string }>;

function makeTrash(): { trash: Trash; calls: string[] } {
  const calls: string[] = [];
  const trash: Trash = async (p) => {
    calls.push(p);
    const dest = path.join(base, 'trash', path.basename(p));
    await fs.mkdir(path.join(base, 'trash'), { recursive: true });
    await fs.rename(p, dest);
    return { trashedPath: dest };
  };
  return { trash, calls };
}

const run: ProbeRunner = async () => ({ stdout: '', stderr: '', exitCode: 0 });

async function matchFor(target: string): Promise<Match> {
  const st = await fs.lstat(target);
  return {
    kind: st.isDirectory() ? 'dir' : 'file',
    path: target,
    detail: '',
    bytesAllocated: st.size,
    bytesApparent: st.size,
    dev: st.dev,
    ino: st.ino,
  };
}

async function itemFor(target: string, over: Partial<PlanItem> = {}): Promise<PlanItem> {
  return {
    id: `${over.ruleId ?? 'rule'}#0`,
    ruleId: 'test-rule',
    title: 'test item',
    category: 'user-data',
    tier: 2,
    action: 'trash-path',
    permanentOnly: false,
    needsConfirmation: true,
    roots: [base],
    match: await matchFor(target),
    ...over,
  };
}

function planOf(items: PlanItem[]): CleanupPlan {
  return {
    schemaVersion: 1,
    id: 'plan-1',
    createdAt: new Date().toISOString(),
    auditGeneratedAt: new Date().toISOString(),
    items,
    manual: [],
    totals: { byTier: { 0: 0, 1: 0, 2: 0, 3: 0 }, total: 0 },
  };
}

async function exists(p: string): Promise<boolean> {
  return fs
    .lstat(p)
    .then(
      () => true,
      () => false,
    );
}

async function makeDir(name: string): Promise<string> {
  const dir = path.join(base, name);
  await fs.mkdir(dir);
  await fs.writeFile(path.join(dir, 'f.bin'), Buffer.alloc(4096, 1));
  return dir;
}

describe('executePlan --permanent', () => {
  it('deletes a confirmed tier 2 item for good without touching the trash', async () => {
    const target = await makeDir('caseA');
    const item = await itemFor(target, { ruleId: 'user-data.rule-a' });
    const { trash, calls } = makeTrash();

    const result = await executePlan(planOf([item]), {
      apply: true,
      home: base,
      run,
      trash,
      confirmedRuleIds: ['user-data.rule-a'],
      permanentRuleIds: ['user-data.rule-a'],
    });

    expect(result.results[0]?.status).toBe('done');
    expect(result.results[0]?.restorable).toBe(false);
    expect(await exists(target)).toBe(false);
    expect(calls).toEqual([]);
  });

  it('skips a permanent rule that was not typed back', async () => {
    const target = await makeDir('caseB');
    const item = await itemFor(target, { ruleId: 'user-data.rule-b' });
    const { trash, calls } = makeTrash();

    const result = await executePlan(planOf([item]), {
      apply: true,
      home: base,
      run,
      trash,
      permanentRuleIds: ['user-data.rule-b'],
    });

    expect(result.results[0]?.status).toBe('skipped');
    expect(result.results[0]?.reason).toBe('permanent delete needs typed confirmation');
    expect(await exists(target)).toBe(true);
    expect(calls).toEqual([]);
  });

  it('uses the trash when the rule is not in permanentRuleIds', async () => {
    const target = await makeDir('caseC');
    const item = await itemFor(target, { ruleId: 'user-data.rule-c' });
    const { trash, calls } = makeTrash();

    const result = await executePlan(planOf([item]), {
      apply: true,
      home: base,
      run,
      trash,
      confirmedRuleIds: ['user-data.rule-c'],
      permanentRuleIds: [],
    });

    expect(result.results[0]?.status).toBe('done');
    expect(result.results[0]?.restorable).toBe(true);
    expect(await exists(target)).toBe(false);
    expect(calls).toEqual([target]);
  });

  it('ignores the flag for a tier 1 item and trashes it', async () => {
    const target = await makeDir('caseD');
    const item = await itemFor(target, { ruleId: 'user-data.rule-d', tier: 1 });
    const { trash, calls } = makeTrash();

    const result = await executePlan(planOf([item]), {
      apply: true,
      home: base,
      run,
      trash,
      confirmedRuleIds: ['user-data.rule-d'],
      permanentRuleIds: ['user-data.rule-d'],
    });

    expect(result.results[0]?.status).toBe('done');
    expect(result.results[0]?.restorable).toBe(true);
    expect(await exists(target)).toBe(false);
    expect(calls).toEqual([target]);
  });

  it('leaves a dry run with permanent untouched', async () => {
    const target = await makeDir('caseE');
    const item = await itemFor(target, { ruleId: 'user-data.rule-e' });
    const { trash, calls } = makeTrash();

    const result = await executePlan(planOf([item]), {
      apply: false,
      home: base,
      run,
      trash,
      confirmedRuleIds: ['user-data.rule-e'],
      permanentRuleIds: ['user-data.rule-e'],
    });

    expect(result.results[0]?.status).toBe('dry-run');
    expect(await exists(target)).toBe(true);
    expect(calls).toEqual([]);
  });

  it('refuses a permanent target outside its roots', async () => {
    const roots = path.join(base, 'caseF-roots');
    await fs.mkdir(roots);
    const outside = path.join(base, 'caseF-outside');
    await fs.mkdir(outside);
    const target = path.join(outside, 'x');
    await fs.mkdir(target);

    const item = await itemFor(target, { ruleId: 'user-data.rule-f', roots: [roots] });
    const { trash, calls } = makeTrash();

    const result = await executePlan(planOf([item]), {
      apply: true,
      home: base,
      run,
      trash,
      confirmedRuleIds: ['user-data.rule-f'],
      permanentRuleIds: ['user-data.rule-f'],
    });

    expect(result.results[0]?.status).toBe('skipped');
    expect(result.results[0]?.reason?.startsWith('refused: OUTSIDE_ROOTS')).toBe(true);
    expect(await exists(target)).toBe(true);
    expect(calls).toEqual([]);
  });
});
