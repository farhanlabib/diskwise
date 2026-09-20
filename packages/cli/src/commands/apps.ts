import { homedir } from 'node:os';
import { Command } from 'commander';
import { formatBytes } from '@diskwise/report';
import {
  buildAppPlan,
  buildAppReports,
  checkFullDiskAccess,
  defaultJournalDir,
  defaultLockPath,
  executePlan,
  findOrphanedAppData,
  listInstalledApps,
  openJournal,
} from '@diskwise/core';
import type {
  AppLocationKind,
  AppLocationState,
  AppReport,
  ItemResult,
} from '@diskwise/core/types';
import { promptImpl } from '../prompt';
import type { IO } from '../program';

const FDA_HINT =
  'Sandboxed app containers were skipped: grant Full Disk Access to your terminal to include them.';

const KIND_LABELS: Record<AppLocationKind, string> = {
  caches: 'Caches',
  logs: 'Logs',
  'saved-state': 'Saved window state',
  'sign-in-data': 'Sign-in & site data',
  'app-data': 'App data',
  settings: 'Settings',
};

const STATE_LABELS: Record<AppLocationState, string> = {
  cleanable: 'cleanable',
  deletableWithConfirmation: 'app data — moved to Trash only with clean --include-data',
  reportOnly: 'report only',
};

function appTable(rows: AppReport[]): string {
  const header = ['NAME', 'VERSION', 'RUNNING', 'CLEANABLE', 'DATA', 'TOTAL'];
  const body = rows.map((report) => [
    report.app.name,
    report.app.version ?? '',
    report.app.running ? 'running' : '',
    formatBytes(report.totals.cleanable),
    formatBytes(report.totals.data),
    formatBytes(report.totals.all),
  ]);
  const all = [header, ...body];
  const widths = header.map((_, index) => Math.max(...all.map((row) => row[index]!.length)));
  const format = (row: string[]): string =>
    row.map((cell, index) => (index === row.length - 1 ? cell : cell.padEnd(widths[index]!))).join('  ');
  return `${all.map(format).join('\n')}\n`;
}

function orphanTable(rows: AppReport[]): string {
  const header = ['BUNDLE ID', 'CLEANABLE', 'DATA', 'TOTAL'];
  const body = rows.map((report) => [
    report.app.bundleId,
    formatBytes(report.totals.cleanable),
    formatBytes(report.totals.data),
    formatBytes(report.totals.all),
  ]);
  const all = [header, ...body];
  const widths = header.map((_, index) => Math.max(...all.map((row) => row[index]!.length)));
  const format = (row: string[]): string =>
    row.map((cell, index) => (index === row.length - 1 ? cell : cell.padEnd(widths[index]!))).join('  ');
  return `${all.map(format).join('\n')}\n`;
}

function formatResult(result: ItemResult): string {
  const where = result.path ?? result.itemId;
  const reason = result.reason ? ` — ${result.reason}` : '';
  // A dry run frees nothing, so show what would be freed instead.
  const bytes = result.status === 'dry-run' ? result.bytesBefore : result.freed;
  return `${result.status}  ${where}  ${formatBytes(bytes)}${reason}\n`;
}

export function registerAppsCommand(
  program: Command,
  io: IO,
  deps: {
    reports?: () => Promise<AppReport[]>;
    orphans?: () => Promise<AppReport[]>;
    execute?: typeof executePlan;
    runningBundleIds?: () => Promise<string[]>;
  } = {},
): void {
  const reportsWithHint = async (): Promise<AppReport[]> => {
    const permissions = await checkFullDiskAccess(homedir());
    if (permissions.fullDiskAccess === 'limited') io.stderr(`${FDA_HINT}\n`);
    const apps = await listInstalledApps({ home: homedir(), measureBundles: false });
    return buildAppReports({
      home: homedir(),
      fullDiskAccess: permissions.fullDiskAccess === 'granted',
      apps,
    });
  };

  const orphansWithHint = async (): Promise<AppReport[]> => {
    const permissions = await checkFullDiskAccess(homedir());
    if (permissions.fullDiskAccess === 'limited') io.stderr(`${FDA_HINT}\n`);
    const apps = await listInstalledApps({ home: homedir(), measureBundles: false });
    return findOrphanedAppData({
      home: homedir(),
      installed: apps,
      fullDiskAccess: permissions.fullDiskAccess === 'granted',
    });
  };

  const reports = deps.reports ?? reportsWithHint;
  const orphans = deps.orphans ?? orphansWithHint;
  const execute = deps.execute ?? executePlan;

  const pickReport = (all: AppReport[], query: string): AppReport => {
    const exact = all.filter((report) => report.app.bundleId === query);
    const matches =
      exact.length > 0
        ? exact
        : all.filter((report) => report.app.name.toLowerCase() === query.toLowerCase());
    if (matches.length === 0) {
      program.error(`no app matches "${query}"`, { exitCode: 1 });
    }
    if (matches.length > 1) {
      for (const match of matches) io.stdout(`  ${match.app.name} (${match.app.bundleId})\n`);
      program.error(`"${query}" matches ${matches.length} apps`, { exitCode: 2 });
    }
    return matches[0]!;
  };

  const resolveReport = async (query: string): Promise<AppReport> =>
    pickReport(await reports(), query);
  const resolveOrphan = async (query: string): Promise<AppReport> =>
    pickReport(await orphans(), query);

  const apps = program
    .command('apps')
    .description('List installed apps and their caches')
    .option('--json', 'print the app reports as JSON')
    .option('--all', 'include apps with nothing cleanable')
    .option('--orphans', 'list data left behind by apps that are no longer installed')
    .action(async (options: { json?: boolean; all?: boolean; orphans?: boolean }) => {
      if (options.orphans === true) {
        const orphaned = await orphans();
        io.stdout(options.json === true ? `${JSON.stringify(orphaned, null, 2)}\n` : orphanTable(orphaned));
        return;
      }
      const all = await reports();
      const rows = options.all === true ? all : all.filter((report) => report.totals.cleanable > 0);
      if (options.json === true) {
        io.stdout(`${JSON.stringify(rows, null, 2)}\n`);
        return;
      }
      io.stdout(appTable(rows));
    });

  apps
    .command('show <query>')
    .description('Show one app and its locations')
    .action(async (query: string) => {
      const report = await resolveReport(query);
      const { app } = report;
      const lines = [
        `${app.name}${app.version ? ` ${app.version}` : ''}`,
        `  bundle id: ${app.bundleId}`,
        `  running: ${app.running ? 'yes' : 'no'}`,
      ];
      for (const location of report.locations) {
        lines.push(
          `  ${KIND_LABELS[location.kind]}  tier ${location.tier}  ${formatBytes(location.bytesAllocated)}  ${location.path}  ${STATE_LABELS[location.state]}`,
        );
      }
      io.stdout(`${lines.join('\n')}\n`);
    });

  apps
    .command('clean <query>')
    .description('Clean one app: caches, logs and saved state')
    .option('--apply', 'actually delete (default is a dry run)')
    .option('--orphaned', 'clean data left behind by an app that is no longer installed')
    .option('--include-data', 'with --orphaned, also trash the app data')
    .action(
      async (
        query: string,
        options: { apply?: boolean; orphaned?: boolean; includeData?: boolean },
      ) => {
        const report =
          options.orphaned === true ? await resolveOrphan(query) : await resolveReport(query);
        const plan = await buildAppPlan(
          report,
          options.includeData === true ? { includeOrphanData: true } : {},
        );
        if (plan.items.length === 0) {
          io.stdout(`Nothing to clean for ${report.app.name}.\n`);
          return;
        }
        const apply = options.apply === true;
        const confirmedRuleIds: string[] = [];
        if (apply && plan.items.some((item) => item.needsConfirmation)) {
          if (io.isTTY) {
            const answer = await promptImpl.ask(
              `Type ${report.app.bundleId} to confirm deleting app data: `,
            );
            if (answer.trim() === report.app.bundleId) confirmedRuleIds.push('app.orphaned-data');
          } else {
            io.stderr(
              `Skipping app data for ${report.app.bundleId}: needs typed confirmation in an interactive terminal\n`,
            );
          }
        }
        const journal = apply
          ? await openJournal({ dir: defaultJournalDir(), lockPath: defaultLockPath() })
          : undefined;
        try {
          const result = await execute(plan, {
            apply,
            confirmedRuleIds,
            signal: new AbortController().signal,
            onItem: (item) => io.stdout(formatResult(item)),
            ...(deps.runningBundleIds ? { runningBundleIds: deps.runningBundleIds } : {}),
            ...(journal ? { journal } : {}),
          });
          if (apply) {
            io.stdout(`Freed ${formatBytes(result.freed)}.\n`);
          } else {
            io.stdout('Dry run: nothing was deleted. Re-run with --apply.\n');
          }
        } finally {
          await journal?.close();
        }
      },
    );
}
