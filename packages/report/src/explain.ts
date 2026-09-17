import type { SystemDataBucket, SystemDataReport, Tier } from '@diskwise/core';
import { formatBytes } from './format-bytes';

const BAR_WIDTH = 24;
const NAME_WIDTH = 28;
const SIZE_WIDTH = 10;

const RESET = '\x1b[0m';
const TIER_COLORS: Record<Tier, string> = {
  0: '\x1b[32m',
  1: '\x1b[34m',
  2: '\x1b[33m',
  3: '\x1b[90m',
};
const MIXED_COLOR = '\x1b[36m';

const UNMEASURED_TITLE = 'Unmeasured';
const UNMEASURED_EXPLANATION =
  'Protected areas, admin-only folders and snapshots. macOS keeps them from being read, so diskwise reports the gap instead of guessing.';

export interface ExplainOptions {
  color?: boolean;
}

function bar(bytes: number, total: number): string {
  if (total <= 0 || bytes <= 0) return ' '.repeat(BAR_WIDTH);
  const filled = Math.min(BAR_WIDTH, Math.max(0, Math.round((bytes / total) * BAR_WIDTH)));
  return '█'.repeat(filled).padEnd(BAR_WIDTH, ' ');
}

function colorFor(tier: Tier | 'mixed'): string {
  return tier === 'mixed' ? MIXED_COLOR : TIER_COLORS[tier];
}

function titleField(title: string): string {
  return title.length >= NAME_WIDTH ? title : title.padEnd(NAME_WIDTH);
}

function row(
  title: string,
  bytes: number,
  tier: Tier | 'mixed',
  total: number,
  color: boolean,
): string {
  const painted = color ? `${colorFor(tier)}${bar(bytes, total)}${RESET}` : bar(bytes, total);
  return `${titleField(title)} ${painted} ${formatBytes(bytes).padStart(SIZE_WIDTH)}`;
}

function childRow(child: SystemDataBucket): string {
  return `  └ ${child.title}  ${formatBytes(child.bytes)}`;
}

function indent(text: string): string {
  return `    ${text}`;
}

export function formatExplain(report: SystemDataReport, opts: ExplainOptions = {}): string {
  const color = opts.color ?? false;
  const lines: string[] = [];

  lines.push(`What macOS calls "System Data": ${formatBytes(report.total)}`);
  lines.push('');

  for (const bucket of report.buckets) {
    lines.push(row(bucket.title, bucket.bytes, bucket.tier, report.total, color));
    lines.push(indent(bucket.explanation));
    if (bucket.manualCommand) lines.push(indent(`$ ${bucket.manualCommand}`));
    for (const child of bucket.children ?? []) {
      lines.push(childRow(child));
    }
  }

  lines.push(row(UNMEASURED_TITLE, report.unmeasured, 3, report.total, color));
  lines.push(indent(UNMEASURED_EXPLANATION));
  lines.push('');
  lines.push(`Measured ${formatBytes(report.measured)} of ${formatBytes(report.total)}`);

  return `${lines.join('\n')}\n`;
}
