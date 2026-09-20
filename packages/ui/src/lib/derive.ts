import type {
  AppLocation,
  AppLocationKind,
  AppReport,
  AuditResult,
  Category,
  DiskInfo,
  Finding,
  RunSummary,
  Tier,
  Trap,
} from '@diskwise/core/types';
import type {
  AppEntry,
  AppLocationAction,
  AppLocationGroup,
  DiskSegment,
  HistoryRun,
  LargestWin,
} from '../mock/types';

const GB = 1_000_000_000;

export interface OverviewData {
  reclaimable: number;
  byTier: Record<Tier, number>;
  disk?: DiskInfo;
  segments: DiskSegment[];
  largest: LargestWin[];
  traps: Trap[];
}

function categoryBytes(audit: AuditResult, categories: Category[]): number {
  return audit.findings
    .filter((finding) => categories.includes(finding.category))
    .reduce((sum, finding) => sum + finding.totals.allocated, 0);
}

function tierBytes(audit: AuditResult, tier: Tier): number {
  return audit.findings
    .filter((finding) => finding.tier === tier)
    .reduce((sum, finding) => sum + finding.totals.allocated, 0);
}

export function overviewFromAudit(audit: AuditResult): OverviewData {
  const dev = categoryBytes(audit, ['dev']);
  const caches = categoryBytes(audit, ['browser', 'app']);
  const userData = categoryBytes(audit, ['user-data']);
  const system = tierBytes(audit, 3);
  const leftovers = categoryBytes(audit, ['os-leftovers']);

  const known = dev + caches + userData + system + leftovers;
  const used = audit.disk?.containerUsed ?? 0;
  const free = audit.disk?.containerFree ?? 0;
  const unmeasured = Math.max(0, used - known);

  const segments: DiskSegment[] = audit.disk
    ? [
        { id: 'dev', label: 'Developer', sizeGb: dev / GB, color: 'seg-dev' },
        { id: 'caches', label: 'Caches', sizeGb: caches / GB, color: 'seg-cache' },
        { id: 'data', label: 'Your data', sizeGb: userData / GB, color: 'seg-data' },
        { id: 'system', label: 'System', sizeGb: system / GB, color: 'seg-sys' },
        { id: 'leftovers', label: 'Old macOS leftovers', sizeGb: leftovers / GB, color: 'seg-purge' },
        { id: 'unmeasured', label: 'Unmeasured', sizeGb: unmeasured / GB, hatch: true },
        { id: 'free', label: 'Free', sizeGb: free / GB, color: 'seg-free' },
      ]
    : [];

  const largest: LargestWin[] = audit.findings
    .filter((finding) => finding.tier !== 3 && finding.action !== null)
    .slice()
    .sort((a, b) => b.totals.allocated - a.totals.allocated)
    .slice(0, 5)
    .map((finding) => ({
      ruleId: finding.ruleId,
      title: finding.title,
      detail: finding.matches[0]?.detail ?? finding.regeneration,
      sizeBytes: finding.totals.allocated,
      tier: finding.tier,
    }));

  return {
    reclaimable: audit.totals.reclaimable,
    byTier: audit.totals.byTier,
    disk: audit.disk,
    segments,
    largest,
    traps: audit.traps,
  };
}

export interface CleanupRow extends Finding {
  id: string;
}

export function cleanupRowsFromAudit(audit: AuditResult): CleanupRow[] {
  return audit.findings.map((finding) => ({ ...finding, id: finding.ruleId }));
}

export function unmeasuredFromAudit(audit: AuditResult): number {
  return overviewFromAudit(audit).segments
    .filter((segment) => segment.id === 'unmeasured')
    .reduce((sum, segment) => sum + segment.sizeGb * GB, 0);
}

const APP_COLORS = [
  '#1db954',
  '#5059c9',
  '#4a154b',
  '#5865f2',
  '#0078d4',
  '#a259ff',
  '#2d8cff',
  '#e8710a',
  '#d9544f',
  '#158a66',
];

function colorFor(key: string): string {
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) >>> 0;
  }
  return APP_COLORS[hash % APP_COLORS.length] ?? '#8a8a90';
}

function lastUsedLabel(iso: string | undefined, now: number): string {
  if (!iso) return 'unknown';
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return 'unknown';
  const days = Math.floor((now - time) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

export function appsFromReports(reports: AppReport[], now: number = Date.now()): AppEntry[] {
  return reports.map((report) => {
    const { app } = report;
    return {
      id: app.bundleId,
      name: app.name,
      initial: app.name.trim().charAt(0).toUpperCase() || '?',
      bundleId: app.bundleId,
      version: app.version ? `v${app.version}` : '—',
      lastUsed: lastUsedLabel(app.lastUsed, now),
      running: app.running,
      orphan: report.orphaned === true,
      knownProfile: report.profileId !== undefined,
      // Totals are classified once in core (AppLocation.state); the UI must not
      // re-derive them or orphaned app data would leak back into the cache total.
      cachesBytes: report.totals.cleanable,
      appDataBytes: report.totals.data,
      totalBytes: report.totals.all,
      color: colorFor(app.bundleId),
    };
  });
}

const LOCATION_NAMES: Record<AppLocationKind, string> = {
  caches: 'Caches',
  logs: 'Logs',
  'saved-state': 'Saved state',
  'sign-in-data': 'Sign-in & site data',
  'app-data': 'App data',
  settings: 'Settings',
};

function locationAction(location: AppLocation): AppLocationAction {
  if (location.state === 'cleanable') return 'clean';
  if (location.state === 'deletableWithConfirmation') return 'trash';
  if (location.kind === 'sign-in-data') return 'report';
  if (location.kind === 'app-data') return 'finder';
  return 'protected';
}

export function appGroupsFromReport(report: AppReport): AppLocationGroup[] {
  return report.locations.map((location, index) => ({
    id: `${location.kind}-${index}`,
    name: LOCATION_NAMES[location.kind],
    sizeBytes: location.bytesAllocated,
    tier: location.tier,
    note:
      location.note ??
      (location.state === 'cleanable'
        ? `${report.app.name} rebuilds these the next time it opens. You stay signed in.`
        : location.state === 'deletableWithConfirmation'
          ? `Left behind by ${report.app.name}. Never cleaned like a cache — you move it to the Trash and can undo that.`
          : `Report only — ${location.path}`),
    action: locationAction(location),
  }));
}

export function historyFromRuns(runs: RunSummary[]): HistoryRun[] {
  return runs.map((run) => ({
    id: run.runId,
    date: formatRunDate(run.startedAt),
    items: run.itemCount,
    freedBytes: run.freed,
    undoable: run.restorableCount > 0 && !run.incomplete,
    reason: run.incomplete ? 'Run incomplete' : 'Nothing to restore',
  }));
}

function formatRunDate(iso: string): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return iso;
  return new Date(time).toLocaleString();
}
