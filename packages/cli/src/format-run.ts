import type { CleanupPlan, ExecuteResult, RunSummary, Tier, UndoItemResult } from '@diskwise/core';
import { formatBytes } from '@diskwise/report';

const WIDTH = 80;

// Same titles as the audit table and the markdown report.
const TIER_TITLES: Record<Tier, string> = {
  0: 'Tier 0 · Regenerates',
  1: 'Tier 1 · Re-download',
  2: 'Tier 2 · Your data',
  3: 'Tier 3 · Protected (report only)',
};

function row(left: string, right: string): string {
  const gap = Math.max(1, WIDTH - left.length - right.length);
  return `${left}${' '.repeat(gap)}${right}`;
}

export function formatPlan(plan: CleanupPlan): string {
  const lines: string[] = [];

  for (const tier of [0, 1, 2, 3] as Tier[]) {
    const items = plan.items.filter((item) => item.tier === tier);
    if (items.length === 0) continue;
    if (lines.length > 0) lines.push('');
    lines.push(row(TIER_TITLES[tier], formatBytes(plan.totals.byTier[tier])));
    for (const item of items) {
      const badge = item.needsConfirmation ? '  [needs confirmation]' : '';
      lines.push(row(`  ${item.title}  [${item.action}]${badge}`, formatBytes(item.match.bytesAllocated)));
    }
  }

  if (plan.items.length === 0) lines.push('Nothing to clean.');

  if (plan.manual.length > 0) {
    lines.push('');
    lines.push('Run these yourself (needs admin rights)');
    for (const step of plan.manual) lines.push(`  $ ${step.command}`);
  }

  lines.push('');
  lines.push(`Total: ${formatBytes(plan.totals.total)}`);
  return `${lines.join('\n')}\n`;
}

export function formatExecution(result: ExecuteResult, dryRunCommand?: string): string {
  const lines = result.results.map((item) => {
    const detail = item.reason ?? formatBytes(item.status === 'done' ? item.freed : item.bytesBefore);
    const permanent = item.restorable === false && item.action === 'trash-path' && item.status === 'done';
    const status = permanent ? `${item.status} (permanent)` : item.status;
    return `${status.padEnd(8)} ${item.itemId} ${detail}`.trimEnd();
  });

  lines.push('');
  if (result.apply) {
    lines.push(
      `Freed ${formatBytes(result.freed)} · run ${result.runId ?? 'unknown'} · undo Trash moves with \`diskwise undo --last\``,
    );
  } else {
    lines.push('Dry run: nothing was deleted.');
    lines.push(
      dryRunCommand !== undefined
        ? `Run this to apply it: ${dryRunCommand}`
        : 'Re-run with --apply to clean.',
    );
  }
  return `${lines.join('\n')}\n`;
}

export function formatRecap(freed: number, freeSpace?: number): string {
  if (freeSpace === undefined) {
    return `Freed ${formatBytes(freed)}. Free space could not be read.\n`;
  }
  return `Freed ${formatBytes(freed)}. Free space is now ${formatBytes(freeSpace)}.\n`;
}

export function formatRuns(runs: RunSummary[]): string {
  if (runs.length === 0) return 'No runs yet.\n';

  const header = ['STARTED', 'RUN', 'MODE', 'ITEMS', 'FREED', 'RESTORABLE', 'INCOMPLETE'];
  const body = runs.map((run) => [
    run.startedAt,
    run.runId,
    run.apply ? 'applied' : 'dry run',
    String(run.itemCount),
    formatBytes(run.freed),
    String(run.restorableCount),
    run.incomplete ? '!' : '',
  ]);

  const all = [header, ...body];
  const widths = header.map((_, i) => Math.max(...all.map((cells) => cells[i]!.length)));
  const format = (cells: string[]): string =>
    cells.map((cell, i) => (i === cells.length - 1 ? cell : cell.padEnd(widths[i]!))).join('  ');

  return `${all.map((cells) => format(cells).trimEnd()).join('\n')}\n`;
}

export function formatUndo(results: UndoItemResult[]): string {
  if (results.length === 0) return 'Nothing to restore.\n';

  const lines = results.map((entry) => {
    const detail = entry.reason ?? entry.path ?? '';
    const line = `${entry.status.padEnd(20)} ${entry.itemId}`;
    return detail ? `${line} ${detail}` : line;
  });
  return `${lines.join('\n')}\n`;
}
