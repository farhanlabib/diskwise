import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { clearBinCache } from '../probes/bin-resolver';
import type {
  ActionId,
  CleanupPlan,
  JournalRecord,
  JournalWriter,
  Match,
  PlanItem,
  ProbeResult,
  ProbeRunner,
} from '../types';
import { executePlan } from './execute';

let base: string;

const UUID = '1A2B3C4D-5E6F-7A8B-9C0D-1E2F3A4B5C6D';

beforeAll(async () => {
  const tmp = await fs.realpath(os.tmpdir());
  base = await fs.mkdtemp(path.join(tmp, 'macsweep-execute-'));
});

afterAll(async () => {
  if (base) await fs.rm(base, { recursive: true, force: true });
});

beforeEach(() => {
  clearBinCache();
});

function ok(stdout = ''): ProbeResult {
  return { stdout, stderr: '', exitCode: 0 };
}

function fail(stderr = '', exitCode = 1): ProbeResult {
  return { stdout: '', stderr, exitCode };
}

type RunHandler = (bin: string, args: string[]) => ProbeResult | undefined;

function makeRun(handler?: RunHandler): { run: ProbeRunner; calls: Array<{ bin: string; args: string[] }> } {
  const calls: Array<{ bin: string; args: string[] }> = [];
  const run: ProbeRunner = async (bin, args) => {
    calls.push({ bin, args });
    return handler?.(bin, args) ?? fail();
  };
  return { run, calls };
}

function makeJournal(runId = 'run-1'): { journal: JournalWriter; records: JournalRecord[] } {
  const records: JournalRecord[] = [];
  const journal: JournalWriter = {
    runId,
    append: async (record) => {
      records.push(record);
    },
    close: async () => {},
  };
  return { journal, records };
}

async function matchFor(target: string): Promise<Match> {
  const st = await fs.lstat(target);
  const kind = st.isDirectory() ? 'dir' : st.isFile() ? 'file' : 'virtual';
  return { kind, path: target, detail: '', bytesAllocated: st.size, bytesApparent: st.size, dev: st.dev, ino: st.ino };
}

async function itemFor(target: string, over: Partial<PlanItem> = {}): Promise<PlanItem> {
  return {
    id: `${over.ruleId ?? 'rule'}#0`,
    ruleId: 'test-rule',
    title: 'test item',
    category: 'dev',
    tier: 0,
    action: 'remove-path',
    permanentOnly: false,
    needsConfirmation: false,
    roots: [base],
    match: await matchFor(target),
    ...over,
  };
}

function virtualItem(action: ActionId, over: Partial<PlanItem> = {}, actionArgs?: Record<string, string>): PlanItem {
  return {
    id: `${over.ruleId ?? 'virtual'}#0`,
    ruleId: 'virtual-rule',
    title: 'virtual item',
    category: 'dev',
    tier: 0,
    action,
    permanentOnly: false,
    needsConfirmation: false,
    roots: [base],
    match: { kind: 'virtual', detail: '', bytesAllocated: 0, bytesApparent: 0, actionArgs },
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

async function snapshot(root: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const name of (await fs.readdir(dir)).sort()) {
      const p = path.join(dir, name);
      const st = await fs.lstat(p);
      out.push(`${path.relative(root, p)}|${st.size}|${st.mtimeMs}|${st.isDirectory() ? 'd' : 'f'}`);
      if (st.isDirectory()) await walk(p);
    }
  };
  await walk(root);
  return out.sort();
}

async function exists(p: string): Promise<boolean> {
  return fs
    .lstat(p)
    .then(
      () => true,
      () => false,
    );
}

describe('executePlan', () => {
  it('applies remove-path for a tier 0 item and journals in order', async () => {
    const dir = path.join(base, 'case1');
    await fs.mkdir(dir);
    await fs.writeFile(path.join(dir, 'blob.bin'), Buffer.alloc(200_000, 1));

    const item = await itemFor(dir);
    const { journal, records } = makeJournal();
    const { run } = makeRun();

    const result = await executePlan(planOf([item]), { apply: true, home: base, run, journal });

    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.status).toBe('done');
    expect(result.results[0]?.freed).toBeGreaterThan(0);
    expect(result.freed).toBeGreaterThan(0);
    expect(await exists(dir)).toBe(false);

    expect(records.map((r) => r.type)).toEqual(['run-start', 'intent', 'result', 'run-end']);
    expect(records[3]).toMatchObject({ type: 'run-end', freed: result.freed });
  });

  it('leaves the tree untouched on a dry run and never touches the journal', async () => {
    const root = path.join(base, 'case2');
    await fs.mkdir(root);
    await fs.writeFile(path.join(root, 'a.bin'), Buffer.alloc(50_000, 2));
    const nested = path.join(root, 'nested');
    await fs.mkdir(nested);
    await fs.writeFile(path.join(nested, 'b.bin'), Buffer.alloc(10_000, 3));

    const before = await snapshot(root);
    const items = [await itemFor(path.join(root, 'a.bin')), await itemFor(nested)];
    const { journal, records } = makeJournal();
    const { run } = makeRun();

    const result = await executePlan(planOf(items), { apply: false, home: base, run, journal });

    expect(result.results.map((r) => r.status)).toEqual(['dry-run', 'dry-run']);
    expect(records).toHaveLength(0);
    expect(await snapshot(root)).toEqual(before);
  });

  it('refuses a target outside the rule roots', async () => {
    const roots = path.join(base, 'case3-roots');
    await fs.mkdir(roots);
    const outside = path.join(base, 'case3-outside');
    await fs.mkdir(outside);
    const target = path.join(outside, 'x');
    await fs.mkdir(target);

    const item = await itemFor(target, { roots: [roots] });
    const { run } = makeRun();

    const result = await executePlan(planOf([item]), { apply: false, home: base, run });

    expect(result.results[0]?.status).toBe('skipped');
    expect(result.results[0]?.reason?.startsWith('refused: OUTSIDE_ROOTS')).toBe(true);
    expect(await exists(target)).toBe(true);
  });

  it('refuses when the inode identity changed under the path', async () => {
    const target = path.join(base, 'case4');
    await fs.mkdir(target);
    const item = await itemFor(target);

    await fs.rm(target, { recursive: true, force: true });
    await fs.mkdir(target);

    const { run } = makeRun();
    const result = await executePlan(planOf([item]), { apply: true, home: base, run });

    expect(result.results[0]?.status).toBe('skipped');
    expect(result.results[0]?.reason).toBe('refused: IDENTITY_MISMATCH');
    expect(await exists(target)).toBe(true);
  });

  it('requires typed confirmation unless the rule id was confirmed', async () => {
    const dir = path.join(base, 'case5');
    await fs.mkdir(dir);
    const item = await itemFor(dir, { needsConfirmation: true, ruleId: 'big-rule' });

    const { run } = makeRun();
    const blocked = await executePlan(planOf([item]), { apply: true, home: base, run });
    expect(blocked.results[0]?.status).toBe('skipped');
    expect(blocked.results[0]?.reason).toBe('needs typed confirmation of the rule id');
    expect(await exists(dir)).toBe(true);

    const confirmed = await executePlan(planOf([item]), {
      apply: true,
      home: base,
      run,
      confirmedRuleIds: ['big-rule'],
    });
    expect(confirmed.results[0]?.status).toBe('done');
    expect(await exists(dir)).toBe(false);
  });

  it('trashes a path through the injected trash command', async () => {
    const target = path.join(base, 'case6');
    await fs.mkdir(target);
    await fs.writeFile(path.join(target, 'f.bin'), Buffer.alloc(4096, 4));
    const trashDir = path.join(base, 'case6-trash');
    await fs.mkdir(trashDir);

    const trash = async (p: string): Promise<{ trashedPath: string }> => {
      const dest = path.join(trashDir, path.basename(p));
      await fs.rename(p, dest);
      return { trashedPath: dest };
    };

    const item = await itemFor(target, { action: 'trash-path' });
    const { run } = makeRun();
    const result = await executePlan(planOf([item]), { apply: true, home: base, run, trash });

    const first = result.results[0];
    expect(first?.status).toBe('done');
    expect(first?.restorable).toBe(true);
    expect(first?.trashedPath).toBe(path.join(trashDir, 'case6'));
    expect(await exists(target)).toBe(false);
    expect(await exists(path.join(trashDir, 'case6'))).toBe(true);
  });

  it('empties a directory but keeps the directory itself', async () => {
    const dir = path.join(base, 'case7');
    await fs.mkdir(dir);
    await fs.writeFile(path.join(dir, 'one.bin'), Buffer.alloc(1024, 5));
    const child = path.join(dir, 'sub');
    await fs.mkdir(child);
    await fs.writeFile(path.join(child, 'two.bin'), Buffer.alloc(1024, 6));

    const item = await itemFor(dir, { action: 'remove-dir-contents' });
    const { run } = makeRun();
    const result = await executePlan(planOf([item]), { apply: true, home: base, run });

    expect(result.results[0]?.status).toBe('done');
    expect(await exists(dir)).toBe(true);
    expect(await fs.readdir(dir)).toEqual([]);
  });

  it('fails a tier 2 remove-path on the tier guard', async () => {
    const dir = path.join(base, 'case8');
    await fs.mkdir(dir);
    const item = await itemFor(dir, { tier: 2 });

    const { run } = makeRun();
    const result = await executePlan(planOf([item]), { apply: true, home: base, run });

    expect(result.results[0]?.status).toBe('failed');
    expect(result.results[0]?.reason).toBe('remove-path is only allowed for tier 0/1');
    expect(await exists(dir)).toBe(true);
  });

  it('validates the runtime uuid before deleting a simulator runtime', async () => {
    const { run: badRun } = makeRun(() => ok());
    const bad = await executePlan(planOf([virtualItem('simctl-runtime-delete', {}, { uuid: 'nope' })]), {
      apply: true,
      home: base,
      run: badRun,
    });
    expect(bad.results[0]?.status).toBe('failed');
    expect(bad.results[0]?.reason).toBe('invalid runtime uuid');

    const { run, calls } = makeRun(() => ok());
    const good = await executePlan(
      planOf([virtualItem('simctl-runtime-delete', {}, { uuid: UUID })]),
      { apply: true, home: base, run },
    );
    expect(good.results[0]?.status).toBe('done');
    expect(calls).toEqual([{ bin: 'xcrun', args: ['simctl', 'runtime', 'delete', UUID] }]);
  });

  it('skips an item blocked by a running process', async () => {
    const dir = path.join(base, 'case10');
    await fs.mkdir(dir);
    const item = await itemFor(dir, { preflight: { processes: ['Xcode'] } });

    const { run } = makeRun((bin, args) => (bin === 'pgrep' && args[1] === 'Xcode' ? ok('123\n') : undefined));
    const result = await executePlan(planOf([item]), { apply: true, home: base, run });

    expect(result.results[0]?.status).toBe('skipped');
    expect(result.results[0]?.reason).toBe('blocked: Xcode is running');
    expect(await exists(dir)).toBe(true);
  });

  it('skips everything when the signal is already aborted', async () => {
    const dir = path.join(base, 'case11');
    await fs.mkdir(dir);
    const item = await itemFor(dir);
    const { run } = makeRun();

    const result = await executePlan(planOf([item]), {
      apply: true,
      home: base,
      run,
      signal: AbortSignal.abort(),
    });

    expect(result.results[0]?.status).toBe('skipped');
    expect(result.results[0]?.reason).toBe('cancelled');
    expect(await exists(dir)).toBe(true);
  });

  it('reports the first stderr line when a command fails', async () => {
    const { run } = makeRun((_bin, args) => {
      if (args.includes('-ilc')) return ok('/fake/bin/npm\n');
      return fail('boom\nmore', 1);
    });
    const item = virtualItem('npm-cache-clean', { ruleId: 'npm-rule' });

    const result = await executePlan(planOf([item]), { apply: true, home: base, run });

    expect(result.results[0]?.status).toBe('failed');
    expect(result.results[0]?.reason).toBe('boom');
  });
});
