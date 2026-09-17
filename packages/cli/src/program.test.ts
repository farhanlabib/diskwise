import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parsePlan, serializePlan } from '@macsweep/core';
import type { CleanupPlan, PlanItem, RunSummary, Tier } from '@macsweep/core';
import { buildProgram } from './program';
import { promptImpl } from './prompt';
import { sampleEngine, setEngine, type Engine } from './engine';

function harness(argv: string[], isTTY = false) {
  const out: string[] = [];
  const err: string[] = [];
  const program = buildProgram({
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    isTTY,
  });
  program.exitOverride();
  return {
    out,
    err,
    run: () => program.parseAsync(['node', 'macsweep', ...argv]),
  };
}

function engineWith(overrides: Partial<Engine>): Engine {
  return { ...sampleEngine, ...overrides };
}

const baseItem: PlanItem = {
  id: 'xcode.derived-data#0',
  ruleId: 'xcode.derived-data',
  title: 'Xcode DerivedData - acme-web',
  category: 'dev',
  tier: 0,
  action: 'remove-path',
  permanentOnly: false,
  needsConfirmation: false,
  roots: ['/'],
  match: {
    kind: 'dir',
    path: '/tmp/acme-web',
    detail: 'acme-web (last built 12 days ago)',
    bytesAllocated: 8_400_000_000,
    bytesApparent: 8_600_000_000,
  },
};

const confirmItem: PlanItem = {
  ...baseItem,
  id: 'user-data.library#0',
  ruleId: 'user-data.library',
  title: 'User data - Library',
  category: 'user-data',
  tier: 2,
  needsConfirmation: true,
  match: {
    kind: 'dir',
    path: '/tmp/library',
    detail: 'Library (user data)',
    bytesAllocated: 2_000_000_000,
    bytesApparent: 2_000_000_000,
  },
};

const permanentItem: PlanItem = {
  ...confirmItem,
  action: 'trash-path',
  match: {
    kind: 'dir',
    path: '/tmp/library',
    detail: 'Library (user data)',
    bytesAllocated: 2_000_000_000,
    bytesApparent: 2_000_000_000,
  },
};

function planWith(items: PlanItem[]): CleanupPlan {
  const byTier: Record<Tier, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
  let total = 0;
  for (const item of items) {
    byTier[item.tier] += item.match.bytesAllocated;
    total += item.match.bytesAllocated;
  }
  return {
    schemaVersion: 1,
    id: 'plan-1',
    createdAt: '2026-09-17T09:30:00.000Z',
    auditGeneratedAt: '2026-09-17T09:30:00.000Z',
    items,
    manual: [],
    totals: { byTier, total },
  };
}

async function tempPlanFile(plan: CleanupPlan): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'macsweep-cli-'));
  const file = join(dir, 'plan.json');
  await writeFile(file, serializePlan(plan));
  return file;
}

const realAsk = promptImpl.ask;

afterEach(() => {
  setEngine(sampleEngine);
  promptImpl.ask = realAsk;
});

describe('macsweep CLI', () => {
  it('prints the sample audit table', async () => {
    const { out, run } = harness(['audit']);
    await run();
    expect(out.join('')).toContain('Tier 0 · Regenerates');
  });

  it('prints parseable JSON with --json', async () => {
    const { out, run } = harness(['audit', '--json']);
    await run();
    const parsed = JSON.parse(out.join('')) as { schemaVersion: number };
    expect(parsed.schemaVersion).toBe(1);
  });

  it('exits 2 on an invalid category', async () => {
    const { run } = harness(['audit', '--category', 'nope']);
    await expect(run()).rejects.toMatchObject({ exitCode: 2 });
  });

  it('exits 1 for an unknown rule id', async () => {
    const { run } = harness(['rules', 'show', 'nope']);
    await expect(run()).rejects.toMatchObject({ exitCode: 1 });
  });

  it('lists rules', async () => {
    const { out, run } = harness(['rules', 'list']);
    await run();
    expect(out.join('')).toContain('xcode.derived-data');
  });
});

describe('plan', () => {
  it('prints tiers and writes a parseable plan file', async () => {
    setEngine(engineWith({ buildPlan: () => planWith([baseItem]) }));
    const dir = await mkdtemp(join(tmpdir(), 'macsweep-plan-'));
    const file = join(dir, 'plan.json');

    const { out, err, run } = harness(['plan', '-o', file]);
    await run();

    expect(out.join('')).toContain('Tier 0 · Regenerates');
    expect(err.join('')).toContain(`Plan saved to ${file}`);

    const parsed = parsePlan(await readFile(file, 'utf8'));
    expect(parsed.id).toBe('plan-1');
    expect(parsed.items).toHaveLength(1);
  });

  it('rejects tier 3', async () => {
    const { run } = harness(['plan', '--tier', '3']);
    await expect(run()).rejects.toMatchObject({ exitCode: 2 });
  });
});

describe('clean', () => {
  it('defaults to a dry run', async () => {
    let captured: { apply: boolean; confirmedRuleIds: string[] } | undefined;
    setEngine(
      engineWith({
        buildPlan: () => planWith([baseItem]),
        executePlan: async (plan, opts) => {
          captured = { apply: opts.apply, confirmedRuleIds: opts.confirmedRuleIds };
          return { planId: plan.id, apply: opts.apply, results: [], freed: 0 };
        },
      }),
    );

    const { out, run } = harness(['clean']);
    await run();

    expect(captured?.apply).toBe(false);
    expect(captured?.confirmedRuleIds).toEqual([]);
    expect(out.join('')).toContain('Dry run');
  });

  it('never asks for typed confirmation without a terminal', async () => {
    let captured: string[] | undefined;
    setEngine(
      engineWith({
        buildPlan: () => planWith([confirmItem]),
        executePlan: async (plan, opts) => {
          captured = opts.confirmedRuleIds;
          return { planId: plan.id, apply: opts.apply, results: [], freed: 0 };
        },
      }),
    );

    const { err, run } = harness(['clean', '--apply']);
    await run();

    expect(captured).toEqual([]);
    expect(err.join('')).toContain('Skipping user-data.library');
  });

  it('passes a typed rule id through in a terminal', async () => {
    let captured: string[] | undefined;
    setEngine(
      engineWith({
        buildPlan: () => planWith([confirmItem]),
        executePlan: async (plan, opts) => {
          captured = opts.confirmedRuleIds;
          return { planId: plan.id, apply: opts.apply, results: [], freed: 0 };
        },
      }),
    );
    promptImpl.ask = async () => 'user-data.library';

    const { run } = harness(['clean', '--apply'], true);
    await run();

    expect(captured).toEqual(['user-data.library']);
  });

  it('uses the plan id from a --plan file', async () => {
    let planId: string | undefined;
    setEngine(
      engineWith({
        executePlan: async (plan, opts) => {
          planId = plan.id;
          return { planId: plan.id, apply: opts.apply, results: [], freed: 0 };
        },
      }),
    );
    const file = await tempPlanFile(planWith([baseItem]));

    const { run } = harness(['clean', '--plan', file]);
    await run();

    expect(planId).toBe('plan-1');
  });

  it('reports a lock conflict', async () => {
    setEngine(
      engineWith({
        buildPlan: () => planWith([baseItem]),
        executePlan: async () => {
          throw new Error('LOCKED: another run holds the lock');
        },
      }),
    );

    const { err, run } = harness(['clean', '--apply']);
    await expect(run()).rejects.toMatchObject({ exitCode: 1 });
    expect(err.join('')).toContain('Another macsweep run is in progress.');
  });

  it('requires a terminal for --interactive', async () => {
    const { run } = harness(['clean', '--interactive']);
    await expect(run()).rejects.toMatchObject({ exitCode: 2 });
  });

  it('requires --apply for --permanent', async () => {
    const { run } = harness(['clean', '--permanent']);
    await expect(run()).rejects.toMatchObject({ exitCode: 2 });
  });

  it('requires an interactive terminal for --permanent', async () => {
    const { run } = harness(['clean', '--apply', '--permanent']);
    await expect(run()).rejects.toMatchObject({ exitCode: 2 });
  });

  it('confirms a permanent rule with the typed phrase', async () => {
    let captured: { confirmedRuleIds: string[]; permanentRuleIds?: string[] } | undefined;
    setEngine(
      engineWith({
        buildPlan: () => planWith([permanentItem]),
        executePlan: async (plan, opts) => {
          captured = { confirmedRuleIds: opts.confirmedRuleIds, permanentRuleIds: opts.permanentRuleIds };
          return { planId: plan.id, apply: opts.apply, results: [], freed: 0 };
        },
      }),
    );
    promptImpl.ask = async () => 'delete user-data.library permanently';

    const { out, run } = harness(['clean', '--apply', '--permanent'], true);
    await run();

    expect(captured?.permanentRuleIds).toEqual(['user-data.library']);
    expect(captured?.confirmedRuleIds).toEqual(['user-data.library']);
    expect(out.join('')).toContain('Deleting permanently (not to Trash): user-data.library');
  });

  it('falls back to the normal confirmation when the permanent phrase is wrong', async () => {
    let captured: { confirmedRuleIds: string[]; permanentRuleIds?: string[] } | undefined;
    setEngine(
      engineWith({
        buildPlan: () => planWith([permanentItem]),
        executePlan: async (plan, opts) => {
          captured = { confirmedRuleIds: opts.confirmedRuleIds, permanentRuleIds: opts.permanentRuleIds };
          return { planId: plan.id, apply: opts.apply, results: [], freed: 0 };
        },
      }),
    );
    const answers = ['nope', 'user-data.library'];
    promptImpl.ask = async () => answers.shift() ?? '';

    const { run } = harness(['clean', '--apply', '--permanent'], true);
    await run();

    expect(captured?.permanentRuleIds).toEqual([]);
    expect(captured?.confirmedRuleIds).toEqual(['user-data.library']);
  });
});

describe('undo', () => {
  it('needs a run id or --last', async () => {
    const { run } = harness(['undo']);
    await expect(run()).rejects.toMatchObject({ exitCode: 2 });
  });

  it('says nothing to undo when there is no applied run', async () => {
    setEngine(engineWith({ lastAppliedRunId: async () => undefined }));
    const { err, run } = harness(['undo', '--last']);
    await expect(run()).rejects.toMatchObject({ exitCode: 1 });
    expect(err.join('')).toContain('Nothing to undo.');
  });
});

describe('history', () => {
  it('prints parseable JSON', async () => {
    const runs: RunSummary[] = [
      {
        runId: 'r1',
        planId: 'p1',
        startedAt: '2026-09-17T09:30:00.000Z',
        apply: true,
        itemCount: 2,
        freed: 100,
        restorableCount: 1,
        incomplete: false,
      },
    ];
    setEngine(engineWith({ listRuns: async () => runs }));

    const { out, run } = harness(['history', '--json']);
    await run();

    expect(JSON.parse(out.join(''))).toEqual(runs);
  });
});

describe('report', () => {
  it('redacts when asked', async () => {
    let called = false;
    setEngine(
      engineWith({
        redact: (audit) => {
          called = true;
          return audit;
        },
      }),
    );

    const { out, run } = harness(['report', '--redact']);
    await run();

    expect(called).toBe(true);
    expect(out.join('')).toContain('# macsweep disk report');
  });
});
