import type { AuditResult, Finding, Tier } from '@diskwise/core';
import { formatBytes } from './format-bytes';

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';

const TIER_COLORS: Record<Tier, string> = {
  0: '\x1b[32m',
  1: '\x1b[34m',
  2: '\x1b[33m',
  3: '\x1b[90m',
};

const TIER_TITLES: Record<Tier, string> = {
  0: 'Tier 0 · Regenerates',
  1: 'Tier 1 · Re-download',
  2: 'Tier 2 · Your data',
  3: 'Tier 3 · Protected (report only)',
};

export interface TableOptions {
  color?: boolean;
  width?: number;
}

type Paint = (s: string) => string;

const identity: Paint = (s) => s;

function row(left: string, right: string, width: number, paint: Paint = identity): string {
  const gap = Math.max(1, width - left.length - right.length);
  return `${paint(left)}${' '.repeat(gap)}${right}`;
}

function titleWithBadges(finding: Finding): string {
  const badges: string[] = [];
  if (finding.needsRoot) badges.push('[needs root]');
  if (finding.permanentOnly) badges.push('[permanent only]');
  if (finding.blockedBy && finding.blockedBy.length > 0) {
    badges.push(`[blocked: ${finding.blockedBy.join(', ')}]`);
  }
  const title = badges.length > 0 ? `${finding.title} ${badges.join(' ')}` : finding.title;
  // Clone-aware sizing can report much less than allocated when APFS clones share
  // blocks: say so on the row rather than letting the allocated figure mislead.
  const reclaimable = finding.totals.reclaimable;
  if (reclaimable !== undefined && reclaimable < 0.95 * finding.totals.allocated) {
    return `${title} (frees ~${formatBytes(reclaimable)}; rest shared with clones)`;
  }
  return title;
}

export function formatTable(result: AuditResult, opts: TableOptions = {}): string {
  const width = opts.width ?? 80;
  const color = opts.color ?? false;
  const paint = (code: string): Paint => (color ? (s) => `${code}${s}${RESET}` : identity);
  const dim = paint(DIM);

  const lines: string[] = [];

  if (result.disk) {
    const d = result.disk;
    lines.push(
      `Container ${formatBytes(d.containerTotal)} · used ${formatBytes(d.containerUsed)} · free ${formatBytes(d.containerFree)}`,
    );
  }

  if (result.permissions?.fullDiskAccess === 'limited') {
    const hint = result.permissions.hint ? ` — ${result.permissions.hint}` : '';
    lines.push(`Full Disk Access: limited${hint}`);
  }

  const tiers: Tier[] = [0, 1, 2, 3];
  for (const tier of tiers) {
    const findings = result.findings.filter((f) => f.tier === tier);
    if (findings.length === 0) continue;
    const tierPaint = paint(TIER_COLORS[tier]);
    if (lines.length > 0) lines.push('');
    lines.push(row(TIER_TITLES[tier], formatBytes(result.totals.byTier[tier]), width, tierPaint));

    for (const finding of findings) {
      lines.push(
        row(`  ${titleWithBadges(finding)}`, formatBytes(finding.totals.allocated), width, tierPaint),
      );
      lines.push(dim(`    because ${finding.rationale} · restore cost: ${finding.regeneration}`));

      for (const m of finding.matches.slice(0, 5)) {
        lines.push(`    - ${m.detail}  ${formatBytes(m.bytesAllocated)}`);
      }
      if (finding.matches.length > 5) {
        lines.push(dim(`    … and ${finding.matches.length - 5} more`));
      }
      if (finding.needsRoot && finding.manualCommand) {
        lines.push(dim(`    $ ${finding.manualCommand}`));
      }
    }
  }

  if (result.traps.length > 0) {
    lines.push('');
    lines.push('Traps');
    for (const trap of result.traps) {
      lines.push(
        `  ${trap.path} looks like ${formatBytes(trap.apparent)} but uses ${formatBytes(trap.allocated)} - ${trap.note}`,
      );
    }
  }

  if (result.unreadable.length > 0) {
    lines.push('');
    lines.push(`Unreadable: ${result.unreadable.length} ${result.unreadable.length === 1 ? 'path' : 'paths'}`);
  }

  lines.push('');
  lines.push(
    `Reclaimable: ${formatBytes(result.totals.reclaimable)}  (tier 0: ${formatBytes(result.totals.byTier[0])} · tier 1: ${formatBytes(result.totals.byTier[1])} · tier 2: ${formatBytes(result.totals.byTier[2])})`,
  );
  lines.push('Nothing was deleted. Run `diskwise plan` to build a cleanup plan.');

  return `${lines.join('\n')}\n`;
}
