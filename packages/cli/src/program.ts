import { readFile, writeFile } from 'node:fs/promises';
import { Command } from 'commander';
import {
  parsePlan,
  serializePlan,
  type AuditResult,
  type Category,
  type CleanupPlan,
  type ExecuteResult,
  type PlanItem,
  type PlanSelection,
  type Tier,
} from '@diskwise/core';
import { formatExplain, formatJson, formatMarkdown, formatTable, formatBytes } from '@diskwise/report';
import { registerAppsCommand } from './commands/apps';
import { registerDoctorCommand } from './commands/doctor';
import { registerUiCommand } from './commands/ui';
import { getEngine } from './engine';
import { formatExecution, formatPlan, formatRuns, formatUndo } from './format-run';
import { confirmTyped, promptImpl } from './prompt';

export { VERSION } from './version';
import { VERSION } from './version';

const CATEGORIES = ['dev', 'system', 'browser', 'app', 'user-data', 'os-leftovers'] as const;

export interface IO {
  stdout: (s: string) => void;
  stderr: (s: string) => void;
  isTTY: boolean;
}

function isCategory(value: string): value is (typeof CATEGORIES)[number] {
  return (CATEGORIES as readonly string[]).includes(value);
}

function progressLine(p: { entries: number; path: string }): string {
  const path = p.path.length > 60 ? `…${p.path.slice(-59)}` : p.path;
  return `Scanning… ${p.entries} entries · ${path}`;
}

function ruleTable(rows: Array<{ id: string; tier: number; category: string; title: string }>): string {
  const header = ['ID', 'TIER', 'CATEGORY', 'TITLE'];
  const body = rows.map((r) => [r.id, String(r.tier), r.category, r.title]);
  const all = [header, ...body];
  const widths = header.map((_, i) => Math.max(...all.map((row) => row[i]!.length)));
  const format = (row: string[]): string =>
    row.map((cell, i) => (i === row.length - 1 ? cell : cell.padEnd(widths[i]!))).join('  ');
  return `${all.map(format).join('\n')}\n`;
}

export function buildProgram(io: IO): Command {
  const program = new Command();

  program
    .name('diskwise')
    .description("Explains where your Mac's disk space went and only deletes what is provably safe.")
    .version(VERSION);

  program.configureOutput({
    writeOut: (s) => io.stdout(s),
    writeErr: (s) => io.stderr(s),
  });

  const requireCategory = (category: string | undefined): void => {
    if (category !== undefined && !isCategory(category)) {
      program.error(`invalid category "${category}" (expected one of: ${CATEGORIES.join(', ')})`, {
        exitCode: 2,
      });
    }
  };

  const parseTiers = (value: string | undefined): Tier[] | undefined => {
    if (value === undefined) return undefined;
    const tiers: Tier[] = [];
    for (const part of value.split(',')) {
      const token = part.trim();
      if (token === '3') program.error('tier 3 is report-only', { exitCode: 2 });
      if (token !== '0' && token !== '1' && token !== '2') {
        program.error(`invalid tier "${token}" (expected 0, 1 or 2)`, { exitCode: 2 });
      }
      tiers.push(Number(token) as Tier);
    }
    return tiers;
  };

  const buildSelection = (options: {
    tier?: string;
    category?: string;
    rule?: string[];
  }): PlanSelection => {
    const selection: PlanSelection = {};
    const tiers = parseTiers(options.tier);
    if (tiers !== undefined) selection.tiers = tiers;
    if (options.category !== undefined) selection.categories = [options.category as Category];
    if (options.rule !== undefined && options.rule.length > 0) selection.ruleIds = options.rule;
    return selection;
  };

  const runAudit = async (options: {
    category?: string;
    quiet?: boolean;
    explain?: boolean;
  }): Promise<AuditResult> => {
    const showProgress = io.isTTY && options.quiet !== true;
    const controller = new AbortController();
    const onSigint = (): void => controller.abort();
    process.once('SIGINT', onSigint);
    try {
      const result = await getEngine().audit({
        ...(options.category !== undefined ? { category: options.category } : {}),
        ...(options.explain ? { explain: true } : {}),
        signal: controller.signal,
        onProgress: (p) => {
          if (showProgress) io.stderr(`\r${progressLine(p)}`);
        },
      });
      if (showProgress) io.stderr('\r\x1b[2K');
      return result;
    } finally {
      process.removeListener('SIGINT', onSigint);
    }
  };

  program
    .command('audit')
    .description('Scan the disk and report reclaimable space by tier')
    .option('--json', 'print the audit as JSON')
    .option('--category <name>', `limit to one category: ${CATEGORIES.join(', ')}`)
    .option('--explain', 'also break down what macOS calls "System Data" (slower)')
    .action(async (options: { json?: boolean; category?: string; explain?: boolean }) => {
      requireCategory(options.category);

      const useColor = io.isTTY && !process.env.NO_COLOR;
      const result = await runAudit({
        category: options.category,
        quiet: options.json === true,
        explain: options.explain === true,
      });
      if (options.json === true) {
        io.stdout(formatJson(result));
        return;
      }
      io.stdout(formatTable(result, { color: useColor }));
      if (options.explain === true) {
        io.stdout(
          result.systemData
            ? `\n${formatExplain(result.systemData, { color: useColor })}`
            : '\nSystem Data breakdown unavailable (disk info could not be read).\n',
        );
      }
    });

  program
    .command('plan')
    .description('Build a cleanup plan')
    .option('--tier <list>', 'tiers to include (comma list of 0, 1, 2)')
    .option('--category <name>', `limit to one category: ${CATEGORIES.join(', ')}`)
    .option('--rule <ids...>', 'limit to specific rule ids')
    .option('-o, --output <file>', 'write the plan JSON to a file')
    .option('--json', 'print the plan as JSON')
    .action(
      async (options: {
        tier?: string;
        category?: string;
        rule?: string[];
        output?: string;
        json?: boolean;
      }) => {
        requireCategory(options.category);
        const selection = buildSelection(options);
        const result = await runAudit({ category: options.category });
        const plan = getEngine().buildPlan(result, selection);

        io.stdout(options.json === true ? serializePlan(plan) : formatPlan(plan));
        if (options.output !== undefined) {
          await writeFile(options.output, serializePlan(plan));
          io.stderr(`Plan saved to ${options.output}\n`);
        }
      },
    );

  program
    .command('clean')
    .description('Execute a cleanup plan (dry run unless --apply)')
    .option('--tier <list>', 'tiers to include (comma list of 0, 1, 2)')
    .option('--category <name>', `limit to one category: ${CATEGORIES.join(', ')}`)
    .option('--rule <ids...>', 'limit to specific rule ids')
    .option('--plan <file>', 'use a plan saved by `diskwise plan`')
    .option('--apply', 'actually delete; the default is a dry run')
    .option('--interactive', 'choose items one at a time')
    .option(
      '--permanent',
      'delete Tier 2 items permanently instead of moving them to Trash; requires typed confirmation',
    )
    .action(
      async (options: {
        tier?: string;
        category?: string;
        rule?: string[];
        plan?: string;
        apply?: boolean;
        interactive?: boolean;
        permanent?: boolean;
      }) => {
        requireCategory(options.category);

        const apply = options.apply === true;
        if (options.permanent === true && !apply) {
          program.error('use --permanent together with --apply', { exitCode: 2 });
        }
        if (options.permanent === true && !io.isTTY) {
          program.error('permanent delete needs an interactive terminal', { exitCode: 2 });
        }

        let plan: CleanupPlan;
        if (options.plan !== undefined) {
          plan = parsePlan(await readFile(options.plan, 'utf8'));
        } else {
          const result = await runAudit({ category: options.category });
          plan = getEngine().buildPlan(result, buildSelection(options));
        }

        if (options.interactive === true) {
          if (!io.isTTY) program.error('--interactive requires an interactive terminal', { exitCode: 2 });
          plan = await selectInteractively(io, plan);
        }

        let confirmedRuleIds: string[] = [];
        let permanentRuleIds: string[] = [];
        if (apply) {
          permanentRuleIds = options.permanent === true ? await confirmPermanent(io, plan) : [];
          confirmedRuleIds = await confirmRules(io, plan, permanentRuleIds);
        }

        const controller = new AbortController();
        const onSigint = (): void => controller.abort();
        process.once('SIGINT', onSigint);
        let execution: ExecuteResult;
        try {
          execution = await getEngine().executePlan(plan, {
            apply,
            confirmedRuleIds,
            permanentRuleIds,
            signal: controller.signal,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (message.startsWith('LOCKED')) {
            program.error('Another diskwise run is in progress.', { exitCode: 1 });
          }
          throw err;
        } finally {
          process.removeListener('SIGINT', onSigint);
        }

        io.stdout(formatExecution(execution));
        if (execution.results.some((result) => result.status === 'failed')) process.exitCode = 1;
      },
    );

  program
    .command('undo [runId]')
    .description('Undo the last cleanup')
    .option('--last', 'undo the most recent applied run')
    .action(async (runId: string | undefined, options: { last?: boolean }) => {
      if ((runId !== undefined) === (options.last === true)) {
        program.error('provide a run id or --last (exactly one)', { exitCode: 2 });
      }
      const target = options.last === true ? await getEngine().lastAppliedRunId() : runId;
      if (target === undefined) {
        program.error('Nothing to undo.', { exitCode: 1 });
        return;
      }
      io.stdout(formatUndo(await getEngine().undo(target)));
    });

  program
    .command('history')
    .description('List past cleanup runs')
    .option('--json', 'print the runs as JSON')
    .action(async (options: { json?: boolean }) => {
      const runs = await getEngine().listRuns();
      io.stdout(options.json === true ? `${JSON.stringify(runs, null, 2)}\n` : formatRuns(runs));
    });

  program
    .command('report')
    .description('Write a shareable disk report')
    .option('--markdown', 'print markdown (the default)')
    .option('--json', 'print JSON instead of markdown')
    .option('--redact', 'remove usernames, hostnames and home paths')
    .option('--hash-paths', 'hash project and app names (implies --redact)')
    .option('-o, --output <file>', 'write the report to a file instead of stdout')
    .action(
      async (options: {
        markdown?: boolean;
        json?: boolean;
        redact?: boolean;
        hashPaths?: boolean;
        output?: string;
      }) => {
        const result = await runAudit({});
        const shouldRedact = options.redact === true || options.hashPaths === true;
        const report = shouldRedact
          ? getEngine().redact(result, { hashPaths: options.hashPaths === true })
          : result;
        const text =
          options.json === true ? formatJson(report) : formatMarkdown(report, { version: VERSION });

        if (options.output !== undefined) {
          await writeFile(options.output, text);
          io.stderr(`Report saved to ${options.output}\n`);
        } else {
          io.stdout(text);
        }
      },
    );

  const rules = program.command('rules').description('Inspect the rule catalog');

  rules
    .command('list')
    .description('List every known rule')
    .action(() => {
      io.stdout(ruleTable(getEngine().listRules()));
    });

  rules
    .command('show <id>')
    .description('Explain one rule')
    .action((id: string) => {
      const rule = getEngine().listRules().find((r) => r.id === id);
      if (rule === undefined) {
        program.error(`unknown rule: ${id}`, { exitCode: 1 });
        return;
      }
      io.stdout(
        `${[
          rule.title,
          `  id: ${rule.id}`,
          `  tier: ${rule.tier}`,
          `  category: ${rule.category}`,
          `  because: ${rule.rationale}`,
          `  restore cost: ${rule.regeneration}`,
        ].join('\n')}\n`,
      );
    });

  registerAppsCommand(program, io);
  registerUiCommand(program, io);
  registerDoctorCommand(program, io);

  return program;
}

async function selectInteractively(io: IO, plan: CleanupPlan): Promise<CleanupPlan> {
  const kept: PlanItem[] = [];
  for (const item of plan.items) {
    const answer = await promptImpl.ask(
      `Clean ${item.title} (${formatBytes(item.match.bytesAllocated)})? [y/N] `,
    );
    const normalized = answer.trim().toLowerCase();
    if (normalized === 'y' || normalized === 'yes') kept.push(item);
  }

  const byTier: Record<Tier, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
  let total = 0;
  for (const item of kept) {
    byTier[item.tier] += item.match.bytesAllocated;
    total += item.match.bytesAllocated;
  }
  return { ...plan, items: kept, totals: { byTier, total } };
}

async function confirmPermanent(io: IO, plan: CleanupPlan): Promise<string[]> {
  const ruleIds: string[] = [];
  for (const item of plan.items) {
    if (item.tier === 2 && item.action === 'trash-path' && !ruleIds.includes(item.ruleId)) {
      ruleIds.push(item.ruleId);
    }
  }

  const permanent: string[] = [];
  for (const ruleId of ruleIds) {
    const answer = await promptImpl.ask(
      `Type "delete ${ruleId} permanently" to delete it for good (it will NOT go to the Trash): `,
    );
    if (answer.trim() === `delete ${ruleId} permanently`) permanent.push(ruleId);
  }

  if (permanent.length > 0) {
    io.stdout(`Deleting permanently (not to Trash): ${permanent.join(', ')}\n`);
  }
  return permanent;
}

async function confirmRules(io: IO, plan: CleanupPlan, alreadyConfirmed: string[] = []): Promise<string[]> {
  const confirmed = new Set(alreadyConfirmed);
  const titles = new Map<string, string>();
  for (const item of plan.items) {
    if (item.needsConfirmation && !titles.has(item.ruleId)) titles.set(item.ruleId, item.title);
  }

  for (const [ruleId, title] of titles) {
    if (confirmed.has(ruleId)) continue;
    if (io.isTTY) {
      if (await confirmTyped(ruleId, title)) confirmed.add(ruleId);
    } else {
      io.stderr(`Skipping ${ruleId}: needs typed confirmation in an interactive terminal\n`);
    }
  }
  return [...confirmed];
}
