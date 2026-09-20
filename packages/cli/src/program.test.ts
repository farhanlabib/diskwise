import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parsePlan, serializePlan } from '@diskwise/core';
import type { CleanupPlan, PlanItem, RunSummary, Tier } from '@diskwise/core';
import { buildProgram } from './program';
import { formatRecap } from './format-run';
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
  // Subcommands copy the exit callback when they are created, which happens
  // before the override above, so they would otherwise call process.exit().
  const overrideAll = (command: typeof program): void => {
    for (const sub of command.commands) {
      sub.exitOverride();
      overrideAll(sub);
    }
  };
  overrideAll(program);
  return {
    out,
    err,
    run: () => program.parseAsync(['node', 'diskwise', ...argv]),
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
  preflight: { processes: ['Xcode'] },
  roots: ['~/Library/Developer/Xcode/DerivedData'],
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
  const dir = await mkdtemp(join(tmpdir(), 'diskwise-cli-'));
  const file = join(dir, 'plan.json');
  await writeFile(file, serializePlan(plan));
  return file;
}

interface RawPlanItem {
  id: string;
  ruleId: string;
  action: string;
  tier: number;
  needsConfirmation: boolean;
  roots: string[];
}

interface RawPlan {
  items: RawPlanItem[];
}

async function tamperedPlanFile(mutate: (raw: RawPlan) => void): Promise<string> {
  const raw = JSON.parse(serializePlan(planWith([baseItem]))) as RawPlan;
  mutate(raw);
  const dir = await mkdtemp(join(tmpdir(), 'diskwise-cli-'));
  const file = join(dir, 'plan.json');
  await writeFile(file, JSON.stringify(raw));
  return file;
}

const realAsk = promptImpl.ask;

afterEach(() => {
  setEngine(sampleEngine);
  promptImpl.ask = realAsk;
});

describe('diskwise CLI', () => {
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

describe('bare invocation', () => {
  it('prints a short plain-language starting point instead of the raw help', async () => {
    const { out, run } = harness([]);
    await run();
    const text = out.join('');
    expect(text).toContain('diskwise scan');
    expect(text).toContain('diskwise fix');
    expect(text).toContain('diskwise web');
    expect(text).toContain('diskwise check');
    expect(text).not.toContain('Usage:');
  });

  it('still errors for an unknown command', async () => {
    const { err, run } = harness(['nope']);
    await expect(run()).rejects.toMatchObject({ exitCode: 1 });
    expect(err.join('')).toContain("unknown command 'nope'");
  });
});

describe('aliases', () => {
  it.each([
    ['scan', 'audit', 'audit|scan'],
    ['fix', 'clean', 'clean|fix'],
    ['web', 'ui', 'ui|web'],
    ['check', 'doctor', 'doctor|check'],
    ['leftovers', 'report', 'report|leftovers'],
  ])('%s reaches %s', async (alias, long, helpTerm) => {
    const viaAlias = harness([alias, '--help']);
    const viaLong = harness([long, '--help']);
    await expect(viaAlias.run()).rejects.toMatchObject({ exitCode: 0 });
    await expect(viaLong.run()).rejects.toMatchObject({ exitCode: 0 });

    const aliasHelp = viaAlias.out.join('');
    expect(aliasHelp).toBe(viaLong.out.join(''));
    expect(aliasHelp).toContain(helpTerm);
  });

  it('scan behaves like audit', async () => {
    const viaAlias = harness(['scan', '--json']);
    const viaLong = harness(['audit', '--json']);
    await viaAlias.run();
    await viaLong.run();
    expect(viaAlias.out.join('')).toBe(viaLong.out.join(''));
  });
});

describe('plan', () => {
  it('prints tiers and writes a parseable plan file', async () => {
    setEngine(engineWith({ buildPlan: () => planWith([baseItem]) }));
    const dir = await mkdtemp(join(tmpdir(), 'diskwise-plan-'));
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
    expect(err.join('')).toContain('Another diskwise run is in progress.');
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

describe('clean --plan rejects plans that disagree with the rule catalog', () => {
  it('rejects widened roots', async () => {
    const file = await tamperedPlanFile((raw) => {
      raw.items[0]!.roots = ['/'];
    });
    const { run } = harness(['clean', '--plan', file]);
    await expect(run()).rejects.toThrow(/^Invalid plan:.*records roots/);
  });

  it('rejects a substituted action', async () => {
    const file = await tamperedPlanFile((raw) => {
      raw.items[0]!.action = 'trash-path';
    });
    const { run } = harness(['clean', '--plan', file]);
    await expect(run()).rejects.toThrow(/records action "trash-path" but rule "xcode\.derived-data" now uses "remove-path"/);
  });

  it('rejects a substituted tier', async () => {
    const file = await tamperedPlanFile((raw) => {
      raw.items[0]!.tier = 2;
    });
    const { run } = harness(['clean', '--plan', file]);
    await expect(run()).rejects.toThrow(/records tier 2 but rule "xcode\.derived-data" now uses 0/);
  });

  it('rejects a removed confirmation requirement', async () => {
    const file = await tamperedPlanFile((raw) => {
      raw.items[0]!.ruleId = 'ios.backups';
      raw.items[0]!.action = 'trash-path';
      raw.items[0]!.tier = 2;
      raw.items[0]!.roots = ['~/Library/Application Support/MobileSync/Backup'];
      raw.items[0]!.needsConfirmation = false;
    });
    const { run } = harness(['clean', '--plan', file]);
    await expect(run()).rejects.toThrow(/records needsConfirmation false but rule "ios\.backups" now uses true/);
  });

  it('rejects an unknown rule id', async () => {
    const file = await tamperedPlanFile((raw) => {
      raw.items[0]!.ruleId = 'evil.rule';
    });
    const { run } = harness(['clean', '--plan', file]);
    await expect(run()).rejects.toThrow(/unknown rule id "evil\.rule"/);
  });

  it('rejects duplicate item ids', async () => {
    const file = await tamperedPlanFile((raw) => {
      raw.items.push(JSON.parse(JSON.stringify(raw.items[0])) as RawPlanItem);
    });
    const { run } = harness(['clean', '--plan', file]);
    await expect(run()).rejects.toThrow(/duplicate item id/);
  });
});

describe('fix', () => {
  it('is a dry run by default and says the exact apply command', async () => {
    let captured: { apply: boolean } | undefined;
    setEngine(
      engineWith({
        buildPlan: () => planWith([baseItem]),
        executePlan: async (plan, opts) => {
          captured = { apply: opts.apply };
          return { planId: plan.id, apply: opts.apply, results: [], freed: 0 };
        },
      }),
    );

    const { out, run } = harness(['fix']);
    await run();

    expect(captured?.apply).toBe(false);
    const text = out.join('');
    expect(text).toContain('Dry run');
    expect(text).toContain('diskwise fix --apply');
  });

  it('reports freed bytes and the recalculated free space after --apply', async () => {
    setEngine(
      engineWith({
        buildPlan: () => planWith([baseItem]),
        executePlan: async (plan, opts) => ({
          planId: plan.id,
          apply: opts.apply,
          results: [],
          freed: 4_200_000_000,
        }),
      }),
    );

    const { out, run } = harness(['fix', '--apply']);
    await run();

    const text = out.join('');
    expect(text).toContain('Freed 4.2 GB');
    expect(text).toContain('Free space');
  });
});

describe('run', () => {
  it('refuses to execute without confirmation', async () => {
    const { out, err, run } = harness(['run', 'docker.volumes']);
    await expect(run()).rejects.toMatchObject({ exitCode: 2 });
    expect(err.join('')).toContain('without confirmation');
    expect(out.join('')).toContain('docker volume ls');
  });

  it('cancels when the prompt is not answered yes', async () => {
    promptImpl.ask = async () => 'n';
    const { out, run } = harness(['run', 'docker.volumes'], true);
    await run();
    expect(out.join('')).toContain('Cancelled. Nothing was run.');
  });

  it('refuses commands that need root unless --root is passed', async () => {
    const { err, run } = harness(['run', 'os.install-data', '--yes']);
    await expect(run()).rejects.toMatchObject({ exitCode: 2 });
    expect(err.join('')).toContain('administrator (root)');
    expect(err.join('')).toContain('--root');
  });

  it('points at the tier flag for rules without a manual command', async () => {
    const { err, run } = harness(['run', 'xcode.derived-data']);
    await expect(run()).rejects.toMatchObject({ exitCode: 1 });
    expect(err.join('')).toContain('diskwise fix --tier 0 --rule xcode.derived-data');
  });
});

describe('storage recap', () => {
  it('reports freed bytes and the recalculated free space in plain words', () => {
    expect(formatRecap(4_200_000_000, 61_800_000_000)).toBe(
      'Freed 4.2 GB. Free space is now 61.8 GB.\n',
    );
  });

  it('says so when the free space is unavailable', () => {
    expect(formatRecap(100, undefined)).toContain('Free space could not be read');
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
    expect(out.join('')).toContain('# diskwise disk report');
  });
});
