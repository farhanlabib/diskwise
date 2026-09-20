import { lstat } from 'node:fs/promises';
import { homedir } from 'node:os';
import type {
  AuditResult,
  Candidate,
  Category,
  Finding,
  Match,
  ProbeRunner,
  Rule,
  Tier,
  UnreadableEntry,
  WalkProgress,
} from '../types';
import { measure } from '../fs/walker';
import { runRuleMatcher } from '../rules/matchers';
import { analyzeSystemData } from '../sources/system-data';
import { allRules } from '../rules/catalog';
import { runProbe } from '../probes/run';
import { getDiskInfo } from '../sources/disk';
import { checkFullDiskAccess } from '../sources/permissions';
import { findHelper, treeSize } from '../native/helper';
import { detectTraps } from './traps';

export interface ScanOptions {
  home?: string;
  rules?: Rule[];
  category?: Category;
  signal?: AbortSignal;
  onProgress?: (p: WalkProgress) => void;
  run?: ProbeRunner;
  now?: Date;
  concurrency?: number;
  // Adds the System Data decomposition (~20-30 s extra on a full Mac).
  includeSystemData?: boolean;
  // Clone-aware reclaimable sizing: when the native helper is available, each
  // non-virtual match is walked natively so APFS clone-shared bytes are excluded
  // from `bytesReclaimable`. Default true; set false to skip the extra walk.
  clonesAware?: boolean;
  // Test seam: defaults to the native helper's tree command.
  treeSize?: typeof treeSize;
}

const DEFAULT_MIN_BYTES = 50e6;

// The native walk runs off the main measurement path and shells out per candidate,
// so only a few run at a time.
const TREE_CONCURRENCY = 4;

type Limiter = <T>(fn: () => Promise<T>) => Promise<T>;

function createLimiter(max: number): Limiter {
  let active = 0;
  const waiters: Array<() => void> = [];
  return async function run<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= max) {
      await new Promise<void>((resolve) => waiters.push(resolve));
    } else {
      active += 1;
    }
    try {
      return await fn();
    } finally {
      active -= 1;
      const next = waiters.shift();
      if (next) {
        active += 1;
        next();
      }
    }
  };
}

interface CloneSizing {
  tree: typeof treeSize;
  limit: Limiter;
}

// Walks started from a rule never descend into these. File Provider folders (iCloud,
// Google Drive, Dropbox) share the boot volume's device id, and listing them can block
// for minutes or trigger downloads, so they are skipped outright.
function walkSkip(home: string): string[] {
  return [
    '/System/Volumes/Data',
    '/Volumes',
    '/dev',
    '/Library/CloudStorage',
    `${home}/Library/CloudStorage`,
    `${home}/Library/Mobile Documents`,
  ];
}

async function measureCandidate(
  c: Candidate,
  seen: Set<string>,
  opts: ScanOptions & { home: string },
  clone?: CloneSizing,
): Promise<Match> {
  if (c.kind === 'virtual' || !c.path) {
    return {
      ...c,
      bytesAllocated: c.bytesHint?.allocated ?? 0,
      bytesApparent: c.bytesHint?.apparent ?? 0,
    };
  }
  const targetPath = c.path;
  let dev: number | undefined;
  let ino: number | undefined;
  try {
    const st = await lstat(targetPath);
    dev = st.dev;
    ino = st.ino;
  } catch {
    // vanished between match and measure
  }
  const skip = walkSkip(opts.home);
  const walk = await measure(targetPath, {
    seen,
    skip,
    ...(opts.signal ? { signal: opts.signal } : {}),
    ...(opts.onProgress ? { onProgress: opts.onProgress } : {}),
  });

  let bytesReclaimable: number | undefined;
  if (clone && !opts.signal?.aborted) {
    try {
      const native = await clone.limit(() =>
        clone.tree(targetPath, { skip, ...(opts.signal ? { signal: opts.signal } : {}) }),
      );
      bytesReclaimable = Math.min(native.privateSize, walk.allocated);
    } catch {
      // Any native failure leaves reclaimable undefined so callers fall back
      // to the allocated measurement.
      bytesReclaimable = undefined;
    }
  }

  return {
    ...c,
    ...(dev !== undefined ? { dev, ino } : {}),
    bytesAllocated: walk.allocated,
    bytesApparent: walk.apparent,
    ...(bytesReclaimable !== undefined ? { bytesReclaimable } : {}),
    ...(walk.unreadable.length ? { unreadable: walk.unreadable } : {}),
  };
}

function toFindings(rule: Rule, matches: Match[]): Finding[] {
  // A matcher guard can downgrade individual items (e.g. node_modules without a lockfile),
  // so matches are grouped by effective tier; downgraded groups are report-only.
  const groups = new Map<string, { tier: Tier; reportOnly: boolean; matches: Match[] }>();
  for (const m of matches) {
    const tier = m.tierOverride ?? rule.tier;
    const reportOnly = m.reportOnly === true;
    const key = `${tier}:${reportOnly}`;
    const g = groups.get(key) ?? { tier, reportOnly, matches: [] };
    g.matches.push(m);
    groups.set(key, g);
  }
  const findings: Finding[] = [];
  for (const g of groups.values()) {
    const allocated = g.matches.reduce((n, m) => n + m.bytesAllocated, 0);
    const apparent = g.matches.reduce((n, m) => n + m.bytesApparent, 0);
    const minBytes = rule.minBytes ?? (g.tier === 3 ? 0 : DEFAULT_MIN_BYTES);
    if (allocated === 0 || allocated < minBytes) continue;
    // Only meaningful once clone-aware sizing ran for at least one match: the rest
    // fall back to their allocated bytes (no shared blocks to discount).
    const reclaimable = g.matches.some((m) => m.bytesReclaimable !== undefined)
      ? g.matches.reduce((n, m) => n + (m.bytesReclaimable ?? m.bytesAllocated), 0)
      : undefined;
    g.matches.sort((a, b) => b.bytesAllocated - a.bytesAllocated);
    findings.push({
      ruleId: rule.id,
      title: g.reportOnly ? `${rule.title} (report only)` : rule.title,
      category: rule.category,
      tier: g.tier,
      rationale: rule.rationale,
      regeneration: rule.regeneration,
      action: g.reportOnly ? null : rule.action,
      needsRoot: rule.needsRoot === true,
      ...(rule.manualCommand ? { manualCommand: rule.manualCommand } : {}),
      permanentOnly: rule.permanentOnly === true,
      matches: g.matches,
      totals: { allocated, apparent, ...(reclaimable !== undefined ? { reclaimable } : {}) },
    });
  }
  return findings;
}

export async function scan(
  opts: ScanOptions = {},
): Promise<{ findings: Finding[]; unreadable: UnreadableEntry[] }> {
  const home = opts.home ?? homedir();
  const run = opts.run ?? runProbe;
  const rules = (opts.rules ?? allRules).filter(
    (r) => !opts.category || r.category === opts.category,
  );
  const seen = new Set<string>();
  const findings: Finding[] = [];
  const unreadable: UnreadableEntry[] = [];
  const queue = [...rules];
  // One context per scan so probes shared by several rules (docker) run once.
  const ctx = { home, now: opts.now ?? new Date(), run, ...(opts.signal ? { signal: opts.signal } : {}) };

  // Clone-aware sizing only runs when it was not disabled and a walker is
  // available: either the test seam or the real helper on disk.
  const clone =
    opts.clonesAware === false
      ? undefined
      : await (async (): Promise<CloneSizing | undefined> => {
          const tree = opts.treeSize ?? ((await findHelper()) ? treeSize : undefined);
          return tree ? { tree, limit: createLimiter(TREE_CONCURRENCY) } : undefined;
        })();

  const worker = async (): Promise<void> => {
    for (let rule = queue.shift(); rule; rule = queue.shift()) {
      if (opts.signal?.aborted) return;
      const candidates = await runRuleMatcher(rule, ctx);
      const matches: Match[] = [];
      for (const c of candidates) {
        if (opts.signal?.aborted) return;
        const m = await measureCandidate(c, seen, { ...opts, home }, clone);
        if (m.unreadable) unreadable.push(...m.unreadable);
        matches.push(m);
      }
      findings.push(...toFindings(rule, matches));
    }
  };
  await Promise.all(Array.from({ length: opts.concurrency ?? 4 }, worker));

  findings.sort((a, b) => a.tier - b.tier || b.totals.allocated - a.totals.allocated);
  return { findings, unreadable };
}

async function macosVersion(run: ProbeRunner): Promise<string | undefined> {
  const r = await run('sw_vers', ['-productVersion']);
  return r.exitCode === 0 ? r.stdout.trim() : undefined;
}

export async function audit(opts: ScanOptions = {}): Promise<AuditResult> {
  const home = opts.home ?? homedir();
  const run = opts.run ?? runProbe;
  const [scanned, traps, disk, permissions, version] = await Promise.all([
    scan({ ...opts, home, run }),
    detectTraps(home),
    getDiskInfo(run).catch(() => undefined),
    checkFullDiskAccess(home).catch(() => undefined),
    macosVersion(run),
  ]);
  const byTier: Record<Tier, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
  let reclaimable = 0;
  for (const f of scanned.findings) {
    byTier[f.tier] += f.totals.allocated;
    if (f.tier < 3 && f.action !== null) {
      reclaimable += f.totals.reclaimable ?? f.totals.allocated;
    }
  }
  const systemData =
    opts.includeSystemData && disk
      ? await analyzeSystemData({
          home,
          disk,
          run,
          ...(opts.signal ? { signal: opts.signal } : {}),
          ...(opts.onProgress ? { onProgress: opts.onProgress } : {}),
        })
      : undefined;
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    ...(systemData ? { systemData } : {}),
    ...(version ? { macosVersion: version } : {}),
    ...(disk ? { disk } : {}),
    ...(permissions ? { permissions } : {}),
    findings: scanned.findings,
    traps,
    unreadable: scanned.unreadable,
    totals: { byTier, reclaimable },
  };
}
