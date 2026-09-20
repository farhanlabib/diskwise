import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { allRules } from '../rules/catalog';
import type { CleanupPlan, Match, PlanItem, ProbeRunner } from '../types';
import { executePlan } from './execute';

let base: string;

beforeAll(async () => {
  const tmp = await fs.realpath(os.tmpdir());
  base = await fs.mkdtemp(path.join(tmp, 'diskwise-permanent-'));
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

// ios.backups preflights on AppleMobileDeviceHelper; report it as not running.
const run: ProbeRunner = async (bin) =>
  bin === 'pgrep' ? { stdout: '', stderr: '', exitCode: 1 } : { stdout: '', stderr: '', exitCode: 0 };

const RULE = allRules.find((rule) => rule.id === 'ios.backups');

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

// Builds the item exactly the way buildPlan would for the ios.backups rule.
function itemFor(target: string, over: Partial<PlanItem> = {}): PlanItem {
  if (RULE === undefined || RULE.action === null) throw new Error('ios.backups rule missing');
  return {
    id: `${RULE.id}#0`,
    ruleId: RULE.id,
    title: RULE.title,
    category: RULE.category,
    tier: RULE.tier,
    action: RULE.action,
    permanentOnly: RULE.permanentOnly ?? false,
    needsConfirmation: true,
    ...(RULE.preflight !== undefined ? { preflight: RULE.preflight } : {}),
    roots: RULE.roots,
    match: {} as Match,
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

async function makeTarget(name: string): Promise<PlanItem> {
  if (RULE === undefined) throw new Error('ios.backups rule missing');
  const root = RULE.roots[0] ?? '/';
  const dir = path.join(base, root.slice(1), name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'f.bin'), Buffer.alloc(4096, 1));
  return { ...itemFor(dir), match: await matchFor(dir) };
}

describe('executePlan --permanent', () => {
  it('deletes a confirmed tier 2 item for good without touching the trash', async () => {
    const item = await makeTarget('caseA');
    const target = item.match.path ?? '';
    const { trash, calls } = makeTrash();

    const result = await executePlan(planOf([item]), {
      apply: true,
      home: base,
      run,
      trash,
      confirmedRuleIds: ['ios.backups'],
      permanentRuleIds: ['ios.backups'],
    });

    expect(result.results[0]?.status).toBe('done');
    expect(result.results[0]?.restorable).toBe(false);
    expect(await exists(target)).toBe(false);
    expect(calls).toEqual([]);
  });

  it('skips a permanent rule that was not typed back', async () => {
    const item = await makeTarget('caseB');
    const target = item.match.path ?? '';
    const { trash, calls } = makeTrash();

    const result = await executePlan(planOf([item]), {
      apply: true,
      home: base,
      run,
      trash,
      permanentRuleIds: ['ios.backups'],
    });

    expect(result.results[0]?.status).toBe('skipped');
    expect(result.results[0]?.reason).toBe('permanent delete needs typed confirmation');
    expect(await exists(target)).toBe(true);
    expect(calls).toEqual([]);
  });

  it('uses the trash when the rule is not in permanentRuleIds', async () => {
    const item = await makeTarget('caseC');
    const target = item.match.path ?? '';
    const { trash, calls } = makeTrash();

    const result = await executePlan(planOf([item]), {
      apply: true,
      home: base,
      run,
      trash,
      confirmedRuleIds: ['ios.backups'],
      permanentRuleIds: [],
    });

    expect(result.results[0]?.status).toBe('done');
    expect(result.results[0]?.restorable).toBe(true);
    expect(await exists(target)).toBe(false);
    expect(calls).toEqual([target]);
  });

  it('rejects a plan that downgrades the tier to dodge permanent handling', async () => {
    const item = await makeTarget('caseD');
    const target = item.match.path ?? '';
    const downgraded: PlanItem = { ...item, tier: 1, needsConfirmation: false };
    const { trash } = makeTrash();

    await expect(
      executePlan(planOf([downgraded]), {
        apply: true,
        home: base,
        run,
        trash,
        confirmedRuleIds: ['ios.backups'],
        permanentRuleIds: ['ios.backups'],
      }),
    ).rejects.toThrow(/records tier 1 but rule "ios\.backups" now uses 2/);
    expect(await exists(target)).toBe(true);
  });

  it('leaves a dry run with permanent untouched', async () => {
    const item = await makeTarget('caseE');
    const target = item.match.path ?? '';
    const { trash, calls } = makeTrash();

    const result = await executePlan(planOf([item]), {
      apply: false,
      home: base,
      run,
      trash,
      confirmedRuleIds: ['ios.backups'],
      permanentRuleIds: ['ios.backups'],
    });

    expect(result.results[0]?.status).toBe('dry-run');
    expect(await exists(target)).toBe(true);
    expect(calls).toEqual([]);
  });

  it('refuses a permanent target outside its roots', async () => {
    const outside = path.join(base, 'caseF-outside');
    const target = path.join(outside, 'x');
    await fs.mkdir(target, { recursive: true });
    const item = itemFor(target, { match: await matchFor(target) });
    const { trash, calls } = makeTrash();

    const result = await executePlan(planOf([item]), {
      apply: true,
      home: base,
      run,
      trash,
      confirmedRuleIds: ['ios.backups'],
      permanentRuleIds: ['ios.backups'],
    });

    expect(result.results[0]?.status).toBe('skipped');
    expect(result.results[0]?.reason?.startsWith('refused: OUTSIDE_ROOTS')).toBe(true);
    expect(await exists(target)).toBe(true);
    expect(calls).toEqual([]);
  });
});
