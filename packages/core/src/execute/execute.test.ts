import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearBinCache, resolveBin } from '../probes/bin-resolver';
import { allRules } from '../rules/catalog';
import type {
  CleanupPlan,
  JournalRecord,
  JournalWriter,
  Match,
  PlanItem,
  ProbeResult,
  ProbeRunner,
} from '../types';
import { executePlan } from './execute';

vi.mock('../probes/bin-resolver', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../probes/bin-resolver')>();
  return { ...actual, resolveBin: vi.fn(actual.resolveBin) };
});

let base: string;

const UUID = '1A2B3C4D-5E6F-7A8B-9C0D-1E2F3A4B5C6D';

beforeAll(async () => {
  const tmp = await fs.realpath(os.tmpdir());
  base = await fs.mkdtemp(path.join(tmp, 'diskwise-execute-'));
});

afterAll(async () => {
  if (base) await fs.rm(base, { recursive: true, force: true });
});

beforeEach(() => {
  clearBinCache();
});

const RULES = new Map(allRules.map((rule) => [rule.id, rule] as const));

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

// Simulates an attacker swapping the target between executePlan's identity
// check and the action: the swap runs when the intent record is written, which
// happens after assertIdentity and right before runAction.
function swapOnIntentJournal(swap: () => Promise<void>): { journal: JournalWriter; records: JournalRecord[] } {
  const records: JournalRecord[] = [];
  const journal: JournalWriter = {
    runId: 'run-1',
    append: async (record) => {
      records.push(record);
      if (record.type === 'intent') await swap();
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

function virtualMatch(actionArgs?: Record<string, string>): Match {
  return {
    kind: 'virtual',
    detail: '',
    bytesAllocated: 0,
    bytesApparent: 0,
    ...(actionArgs !== undefined ? { actionArgs } : {}),
  };
}

// Builds the item exactly the way buildPlan would for this catalog rule, so it
// satisfies the catalog-authority checks executePlan applies.
function itemFor(ruleId: string, match: Match, over: Partial<PlanItem> = {}): PlanItem {
  const rule = RULES.get(ruleId);
  if (rule === undefined || rule.action === null) throw new Error(`test references unknown rule ${ruleId}`);
  return {
    id: `${ruleId}#0`,
    ruleId,
    title: `${rule.title} - ${match.detail}`,
    category: rule.category,
    tier: rule.tier,
    action: rule.action,
    permanentOnly: rule.permanentOnly ?? false,
    needsConfirmation: rule.tier === 2 || rule.permanentOnly === true,
    ...(rule.preflight !== undefined ? { preflight: rule.preflight } : {}),
    roots: rule.roots,
    match,
    ...over,
  };
}

// A path inside the rule's first root, with '~' resolved against the test home.
function targetUnder(ruleId: string, name: string): string {
  const rule = RULES.get(ruleId);
  if (rule === undefined) throw new Error(`test references unknown rule ${ruleId}`);
  const root = rule.roots[0] ?? '/';
  const expanded = root.startsWith('~') ? `${base}${root.slice(1)}` : root;
  return path.join(expanded, name);
}

async function makeTarget(dir: string): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'blob.bin'), Buffer.alloc(4096, 1));
  return dir;
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

function makeTrash(destDir: string): (p: string) => Promise<{ trashedPath: string }> {
  return async (p: string) => {
    const dest = path.join(destDir, path.basename(p));
    await fs.mkdir(destDir, { recursive: true });
    await fs.rename(p, dest);
    return { trashedPath: dest };
  };
}

describe('executePlan', () => {
  it('applies remove-path for a tier 0 item and journals in order', async () => {
    const dir = await makeTarget(targetUnder('xcode.derived-data', 'case1'));

    const item = itemFor('xcode.derived-data', await matchFor(dir));
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

  it('records the Trash destination before the result so undo survives a crash', async () => {
    const dir = await makeTarget(targetUnder('ios.backups', 'caseTrash'));
    const item = itemFor('ios.backups', await matchFor(dir));
    const { journal, records } = makeJournal();
    const { run } = makeRun();
    const trash = async (p: string): Promise<{ trashedPath: string }> => ({
      trashedPath: `${p}.trashed`,
    });

    const result = await executePlan(planOf([item]), {
      apply: true,
      home: base,
      run,
      journal,
      trash,
      confirmedRuleIds: ['ios.backups'],
    });

    expect(result.results[0]?.status).toBe('done');
    expect(records.map((r) => r.type)).toEqual([
      'run-start',
      'intent',
      'trash-destination',
      'result',
      'run-end',
    ]);
    expect(records[2]).toMatchObject({
      type: 'trash-destination',
      itemId: item.id,
      trashedPath: `${dir}.trashed`,
    });
  });

  it('leaves the tree untouched on a dry run and never touches the journal', async () => {
    const root = await makeTarget(targetUnder('xcode.derived-data', 'case2'));
    const nested = path.join(root, 'nested');
    await fs.mkdir(nested);
    await fs.writeFile(path.join(nested, 'b.bin'), Buffer.alloc(10_000, 3));

    const before = await snapshot(root);
    const items = [
      itemFor('xcode.derived-data', await matchFor(path.join(root, 'blob.bin')), { id: 'xcode.derived-data#0' }),
      itemFor('xcode.derived-data', await matchFor(nested), { id: 'xcode.derived-data#1' }),
    ];
    const { journal, records } = makeJournal();
    const { run } = makeRun();

    const result = await executePlan(planOf(items), { apply: false, home: base, run, journal });

    expect(result.results.map((r) => r.status)).toEqual(['dry-run', 'dry-run']);
    expect(records).toHaveLength(0);
    expect(await snapshot(root)).toEqual(before);
  });

  it('refuses a target outside the rule roots', async () => {
    const outside = path.join(base, 'case3-outside');
    const target = path.join(outside, 'x');
    await fs.mkdir(target, { recursive: true });

    const item = itemFor('xcode.derived-data', await matchFor(target));
    const { run } = makeRun();

    const result = await executePlan(planOf([item]), { apply: false, home: base, run });

    expect(result.results[0]?.status).toBe('skipped');
    expect(result.results[0]?.reason?.startsWith('refused: OUTSIDE_ROOTS')).toBe(true);
    expect(await exists(target)).toBe(true);
  });

  it('refuses when the inode identity changed under the path', async () => {
    const target = await makeTarget(targetUnder('xcode.derived-data', 'case4'));
    const item = itemFor('xcode.derived-data', await matchFor(target));

    await fs.rm(target, { recursive: true, force: true });
    await fs.mkdir(target);

    const { run } = makeRun();
    const result = await executePlan(planOf([item]), { apply: true, home: base, run });

    expect(result.results[0]?.status).toBe('skipped');
    expect(result.results[0]?.reason).toBe('refused: IDENTITY_MISMATCH');
    expect(await exists(target)).toBe(true);
  });

  it('requires typed confirmation unless the rule id was confirmed', async () => {
    const dir = await makeTarget(targetUnder('ios.backups', 'case5'));
    const item = itemFor('ios.backups', await matchFor(dir));
    const trash = makeTrash(path.join(base, 'case5-trash'));
    const { run } = makeRun();

    const blocked = await executePlan(planOf([item]), { apply: true, home: base, run, trash });
    expect(blocked.results[0]?.status).toBe('skipped');
    expect(blocked.results[0]?.reason).toBe('needs typed confirmation of the rule id');
    expect(await exists(dir)).toBe(true);

    const confirmed = await executePlan(planOf([item]), {
      apply: true,
      home: base,
      run,
      trash,
      confirmedRuleIds: ['ios.backups'],
    });
    expect(confirmed.results[0]?.status).toBe('done');
    expect(await exists(dir)).toBe(false);
  });

  it('trashes a path through the injected trash command', async () => {
    const target = await makeTarget(targetUnder('ios.backups', 'case6'));
    const trashDir = path.join(base, 'case6-trash');
    const trash = makeTrash(trashDir);

    const item = itemFor('ios.backups', await matchFor(target));
    const { run } = makeRun();
    const result = await executePlan(planOf([item]), {
      apply: true,
      home: base,
      run,
      trash,
      confirmedRuleIds: ['ios.backups'],
    });

    const first = result.results[0];
    expect(first?.status).toBe('done');
    expect(first?.restorable).toBe(true);
    expect(first?.trashedPath).toBe(path.join(trashDir, 'case6'));
    expect(await exists(target)).toBe(false);
    expect(await exists(path.join(trashDir, 'case6'))).toBe(true);
  });

  it('empties a directory but keeps the directory itself', async () => {
    const dir = await makeTarget(targetUnder('python.pip-cache', 'case7'));
    await fs.writeFile(path.join(dir, 'one.bin'), Buffer.alloc(1024, 5));
    const child = path.join(dir, 'sub');
    await fs.mkdir(child);
    await fs.writeFile(path.join(child, 'two.bin'), Buffer.alloc(1024, 6));

    const item = itemFor('python.pip-cache', await matchFor(dir));
    const { run } = makeRun();
    const result = await executePlan(planOf([item]), { apply: true, home: base, run });

    expect(result.results[0]?.status).toBe('done');
    expect(await exists(dir)).toBe(true);
    expect(await fs.readdir(dir)).toEqual([]);
  });

  it('validates the runtime uuid before deleting a simulator runtime', async () => {
    const { run: badRun } = makeRun(() => ok());
    const bad = await executePlan(planOf([itemFor('simulator.runtimes', virtualMatch({ uuid: 'nope' }))]), {
      apply: true,
      home: base,
      run: badRun,
    });
    expect(bad.results[0]?.status).toBe('failed');
    expect(bad.results[0]?.reason).toBe('invalid runtime uuid');

    const { run, calls } = makeRun(() => ok());
    const good = await executePlan(planOf([itemFor('simulator.runtimes', virtualMatch({ uuid: UUID }))]), {
      apply: true,
      home: base,
      run,
    });
    expect(good.results[0]?.status).toBe('done');
    expect(calls).toEqual([
      { bin: 'xcrun', args: ['simctl', 'list', 'devices', 'booted', '-j'] },
      { bin: 'xcrun', args: ['simctl', 'runtime', 'delete', UUID] },
    ]);
  });

  it('skips an item blocked by a running process', async () => {
    const dir = await makeTarget(targetUnder('xcode.derived-data', 'case10'));
    const item = itemFor('xcode.derived-data', await matchFor(dir));

    const { run } = makeRun((bin, args) => (bin === 'pgrep' && args[1] === 'Xcode' ? ok('123\n') : undefined));
    const result = await executePlan(planOf([item]), { apply: true, home: base, run });

    expect(result.results[0]?.status).toBe('skipped');
    expect(result.results[0]?.reason).toBe('blocked: Xcode is running');
    expect(await exists(dir)).toBe(true);
  });

  it('skips everything when the signal is already aborted', async () => {
    const dir = await makeTarget(targetUnder('xcode.derived-data', 'case11'));
    const item = itemFor('xcode.derived-data', await matchFor(dir));
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
    vi.mocked(resolveBin).mockResolvedValueOnce('/fake/bin/npm');
    const { run } = makeRun(() => fail('boom\nmore', 1));
    const item = itemFor('node.npm-cache', virtualMatch());

    const result = await executePlan(planOf([item]), { apply: true, home: base, run });

    expect(result.results[0]?.status).toBe('failed');
    expect(result.results[0]?.reason).toBe('boom');
  });
});

describe('executePlan rejects crafted plans', () => {
  it('rejects a plan that widens the rule roots', async () => {
    const dir = await makeTarget(targetUnder('xcode.derived-data', 'adv-roots'));
    const item = itemFor('xcode.derived-data', await matchFor(dir), { roots: [base] });
    const { run } = makeRun();

    await expect(executePlan(planOf([item]), { apply: true, home: base, run })).rejects.toThrow(
      /records roots \[".*"\] but rule "xcode\.derived-data" now uses/,
    );
    expect(await exists(dir)).toBe(true);
  });

  it('rejects a plan that substitutes a more destructive action', async () => {
    const dir = await makeTarget(targetUnder('ios.backups', 'adv-action'));
    const item = itemFor('ios.backups', await matchFor(dir), { action: 'remove-path' });
    const { run } = makeRun();

    await expect(executePlan(planOf([item]), { apply: true, home: base, run })).rejects.toThrow(
      /records action "remove-path" but rule "ios\.backups" now uses "trash-path"/,
    );
    expect(await exists(dir)).toBe(true);
  });

  it('rejects a plan that substitutes the tier', async () => {
    const dir = await makeTarget(targetUnder('ios.backups', 'adv-tier'));
    const item = itemFor('ios.backups', await matchFor(dir), { tier: 1 });
    const { run } = makeRun();

    await expect(executePlan(planOf([item]), { apply: true, home: base, run })).rejects.toThrow(
      /records tier 1 but rule "ios\.backups" now uses 2/,
    );
    expect(await exists(dir)).toBe(true);
  });

  it('rejects a plan that disables the typed confirmation of a tier 2 rule', async () => {
    const dir = await makeTarget(targetUnder('ios.backups', 'adv-confirm'));
    const item = itemFor('ios.backups', await matchFor(dir), { needsConfirmation: false });
    const { run } = makeRun();

    await expect(executePlan(planOf([item]), { apply: true, home: base, run })).rejects.toThrow(
      /records needsConfirmation false but rule "ios\.backups" now uses true/,
    );
    expect(await exists(dir)).toBe(true);
  });

  it('rejects a vendor action injected under an unrelated rule id', async () => {
    const item = itemFor('node.npm-cache', virtualMatch({ all: 'true' }), { action: 'docker-image-prune' });
    const { run } = makeRun();

    await expect(executePlan(planOf([item]), { apply: true, home: base, run })).rejects.toThrow(
      /records action "docker-image-prune" but rule "node\.npm-cache" now uses "npm-cache-clean"/,
    );
  });

  it('rejects a virtual action claimed by a path rule', async () => {
    const item = itemFor('xcode.derived-data', virtualMatch({ uuid: UUID }), { action: 'simctl-runtime-delete' });
    const { run } = makeRun();

    await expect(executePlan(planOf([item]), { apply: true, home: base, run })).rejects.toThrow(
      /records action "simctl-runtime-delete" but rule "xcode\.derived-data" now uses "remove-path"/,
    );
  });

  it('rejects an unknown rule id', async () => {
    const dir = await makeTarget(targetUnder('xcode.derived-data', 'adv-unknown'));
    const item = itemFor('xcode.derived-data', await matchFor(dir), { ruleId: 'evil.rule', id: 'evil.rule#0' });
    const { run } = makeRun();

    await expect(executePlan(planOf([item]), { apply: true, home: base, run })).rejects.toThrow(
      /unknown rule id "evil\.rule" in plan item "evil\.rule#0"/,
    );
    expect(await exists(dir)).toBe(true);
  });

  it('rejects duplicate item ids', async () => {
    const a = await makeTarget(targetUnder('xcode.derived-data', 'adv-dup-a'));
    const b = await makeTarget(targetUnder('xcode.derived-data', 'adv-dup-b'));
    const items = [itemFor('xcode.derived-data', await matchFor(a)), itemFor('xcode.derived-data', await matchFor(b))];
    const { run } = makeRun();

    await expect(executePlan(planOf(items), { apply: true, home: base, run })).rejects.toThrow(
      /duplicate item id "xcode\.derived-data#0"/,
    );
    expect(await exists(a)).toBe(true);
    expect(await exists(b)).toBe(true);
  });

  it('rejects a virtual match on a path action so identity checks cannot be skipped', async () => {
    const dir = await makeTarget(targetUnder('xcode.derived-data', 'adv-noidentity'));
    const item = itemFor('xcode.derived-data', {
      kind: 'virtual',
      path: dir,
      detail: '',
      bytesAllocated: 1,
      bytesApparent: 1,
    });
    const { run } = makeRun();

    await expect(executePlan(planOf([item]), { apply: true, home: base, run })).rejects.toThrow(
      /records no target identity/,
    );
    expect(await exists(dir)).toBe(true);
  });

  it('skips a stale target that has vanished since the plan was made', async () => {
    const target = targetUnder('xcode.derived-data', 'adv-gone');
    const item = itemFor('xcode.derived-data', {
      kind: 'dir',
      path: target,
      dev: 1234,
      ino: 5678,
      detail: '',
      bytesAllocated: 100,
      bytesApparent: 100,
    });
    const { run } = makeRun();

    const result = await executePlan(planOf([item]), { apply: true, home: base, run });

    expect(result.results[0]?.status).toBe('skipped');
    expect(result.results[0]?.reason).toBe('refused: MISSING');
    expect(await exists(target)).toBe(false);
  });
});

describe('executePlan refuses targets swapped mid-flight', () => {
  it('refuses to remove a directory replaced by a different directory after the identity check', async () => {
    const target = await makeTarget(targetUnder('xcode.derived-data', 'race-dir'));
    const item = itemFor('xcode.derived-data', await matchFor(target));

    const { journal } = swapOnIntentJournal(async () => {
      await fs.rename(target, `${target}-old`);
      await fs.mkdir(target);
      await fs.writeFile(path.join(target, 'replacement.txt'), 'survivor');
    });
    const { run } = makeRun();

    const result = await executePlan(planOf([item]), { apply: true, home: base, run, journal });

    expect(result.results[0]?.status).toBe('failed');
    expect(result.results[0]?.reason).toContain('IDENTITY_MISMATCH');
    expect(await exists(path.join(target, 'replacement.txt'))).toBe(true);
    expect(await exists(`${target}-old`)).toBe(true);
  });

  it('refuses to empty a cache directory replaced by a symlink to a victim tree', async () => {
    const target = await makeTarget(targetUnder('python.pip-cache', 'race-symlink'));
    const victim = path.join(base, 'race-symlink-victim');
    await fs.mkdir(victim);
    await fs.writeFile(path.join(victim, 'sentinel.txt'), 'do not delete');
    const item = itemFor('python.pip-cache', await matchFor(target));

    const { journal } = swapOnIntentJournal(async () => {
      await fs.rm(target, { recursive: true, force: true });
      await fs.symlink(victim, target);
    });
    const { run } = makeRun();

    const result = await executePlan(planOf([item]), { apply: true, home: base, run, journal });

    expect(result.results[0]?.status).toBe('failed');
    expect(result.results[0]?.reason).toContain('TYPE_MISMATCH');
    expect(await fs.lstat(target).then((st) => st.isSymbolicLink())).toBe(true);
    expect(await fs.readFile(path.join(victim, 'sentinel.txt'), 'utf8')).toBe('do not delete');
    expect(await fs.readdir(victim)).toEqual(['sentinel.txt']);
  });
});
