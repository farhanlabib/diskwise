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
  base = await fs.mkdtemp(path.join(tmp, 'diskwise-empty-trash-'));
});

afterAll(async () => {
  if (base) await fs.rm(base, { recursive: true, force: true });
});

const run: ProbeRunner = async () => ({ stdout: '', stderr: '', exitCode: 0 });

const RULE = allRules.find((rule) => rule.id === 'trash.empty');

async function matchFor(target: string): Promise<Match> {
  const st = await fs.lstat(target);
  const kind = st.isDirectory() ? 'dir' : st.isFile() ? 'file' : 'virtual';
  return { kind, path: target, detail: '', bytesAllocated: st.size, bytesApparent: st.size, dev: st.dev, ino: st.ino };
}

// Builds the item exactly the way buildPlan would for the trash.empty rule.
async function itemFor(target: string, over: Partial<PlanItem> = {}): Promise<PlanItem> {
  if (RULE === undefined || RULE.action === null) throw new Error('trash.empty rule missing');
  return {
    id: 'trash.empty#0',
    ruleId: 'trash.empty',
    title: RULE.title,
    category: RULE.category,
    tier: RULE.tier,
    action: RULE.action,
    permanentOnly: RULE.permanentOnly ?? false,
    needsConfirmation: true,
    roots: RULE.roots,
    match: await matchFor(target),
    ...over,
  };
}

function planOf(items: PlanItem[]): CleanupPlan {
  return {
    schemaVersion: 1,
    id: 'plan-empty-trash',
    createdAt: new Date().toISOString(),
    auditGeneratedAt: new Date().toISOString(),
    items,
    manual: [],
    totals: { byTier: { 0: 0, 1: 0, 2: 0, 3: 0 }, total: 0 },
  };
}

async function makeHome(name: string): Promise<{ home: string; trash: string }> {
  const home = path.join(base, name);
  const trash = path.join(home, '.Trash');
  await fs.mkdir(path.join(trash, 'dir'), { recursive: true });
  await fs.writeFile(path.join(trash, 'a.txt'), 'a');
  await fs.writeFile(path.join(trash, 'dir', 'b'), 'b');
  return { home, trash };
}

describe('empty-trash action', () => {
  it('empties ~/.Trash but keeps the folder itself when confirmed', async () => {
    const { home, trash } = await makeHome('home1');

    const result = await executePlan(planOf([await itemFor(trash)]), {
      apply: true,
      home,
      run,
      confirmedRuleIds: ['trash.empty'],
    });

    expect(result.results[0]?.status).toBe('done');
    expect(result.results[0]?.restorable).toBe(false);
    expect((await fs.lstat(trash)).isDirectory()).toBe(true);
    expect(await fs.readdir(trash)).toEqual([]);
  });

  it('skips without typed confirmation and leaves the Trash untouched', async () => {
    const { home, trash } = await makeHome('home2');

    const result = await executePlan(planOf([await itemFor(trash)]), { apply: true, home, run });

    expect(result.results[0]?.status).toBe('skipped');
    expect(result.results[0]?.reason).toBe('needs typed confirmation of the rule id');
    expect((await fs.readdir(trash)).sort()).toEqual(['a.txt', 'dir']);
  });

  it('rejects a plan that disables the confirmation for emptying the Trash', async () => {
    const { home, trash } = await makeHome('home-tamper');

    const item = await itemFor(trash, { needsConfirmation: false });

    await expect(executePlan(planOf([item]), { apply: true, home, run })).rejects.toThrow(
      /records needsConfirmation false but rule "trash\.empty" now uses true/,
    );
    expect((await fs.readdir(trash)).sort()).toEqual(['a.txt', 'dir']);
  });

  it('refuses a path outside ~/.Trash and leaves the folder untouched', async () => {
    const home = path.join(base, 'home3');
    const documents = path.join(home, 'Documents');
    await fs.mkdir(documents, { recursive: true });
    await fs.writeFile(path.join(documents, 'keep.txt'), 'keep');

    const result = await executePlan(planOf([await itemFor(documents)]), {
      apply: true,
      home,
      run,
      confirmedRuleIds: ['trash.empty'],
    });

    expect(result.results[0]?.status).toBe('skipped');
    expect(result.results[0]?.reason).toBe('refused: OUTSIDE_ROOTS');
    expect(await fs.readdir(documents)).toEqual(['keep.txt']);
  });

  it('refuses a symlinked .Trash', async () => {
    const home = path.join(base, 'home4');
    const real = path.join(home, 'real-trash');
    await fs.mkdir(real, { recursive: true });
    await fs.writeFile(path.join(real, 'a.txt'), 'a');
    await fs.symlink(real, path.join(home, '.Trash'));

    const link = path.join(home, '.Trash');
    const st = await fs.lstat(link);
    // Recorded as a plain dir, but the symlink resolves outside the rule root,
    // so the root containment check refuses it before the identity check runs.
    const match: Match = {
      kind: 'dir',
      path: link,
      dev: st.dev,
      ino: st.ino,
      detail: '',
      bytesAllocated: st.size,
      bytesApparent: st.size,
    };

    const result = await executePlan(planOf([await itemFor(link, { match })]), {
      apply: true,
      home,
      run,
      confirmedRuleIds: ['trash.empty'],
    });

    expect(result.results[0]?.status).toBe('skipped');
    expect(result.results[0]?.reason).toBe('refused: OUTSIDE_ROOTS');
    expect(await fs.readdir(real)).toEqual(['a.txt']);
  });
});
