import { readdir } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { join } from 'node:path';
import type { AppLocation, AppLocationKind, AppReport, InstalledApp, Tier } from '../types';
import { measure } from '../fs/walker';

// At least three dotted parts: a bare product name like "Adobe" is never a bundle id.
const BUNDLE_ID_RE = /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+){2,}$/;

const SAVED_STATE_SUFFIX = '.savedState';
const BINARYCOOKIES_SUFFIX = '.binarycookies';
const PLIST_SUFFIX = '.plist';

const DEFAULT_MIN_BYTES = 10e6;

interface ScanSpec {
  dir: string;
  kind: AppLocationKind;
  tier: Tier;
  actionable: boolean;
  requiresFullDiskAccess?: boolean;
  // Returns the bundle id suggested by a child name, or undefined when the name
  // does not carry one (e.g. a file that does not end in the expected suffix).
  toBundleId: (name: string) => string | undefined;
}

function stripSuffix(name: string, suffix: string): string | undefined {
  return name.endsWith(suffix) ? name.slice(0, -suffix.length) : undefined;
}

function scanSpecs(home: string): ScanSpec[] {
  const lib = join(home, 'Library');
  return [
    {
      dir: join(lib, 'Caches'),
      kind: 'caches',
      tier: 0,
      actionable: true,
      toBundleId: (name) => name,
    },
    {
      dir: join(lib, 'Logs'),
      kind: 'logs',
      tier: 1,
      actionable: true,
      toBundleId: (name) => name,
    },
    {
      dir: join(lib, 'Saved Application State'),
      kind: 'saved-state',
      tier: 1,
      actionable: true,
      toBundleId: (name) => stripSuffix(name, SAVED_STATE_SUFFIX),
    },
    {
      dir: join(lib, 'HTTPStorages'),
      kind: 'sign-in-data',
      tier: 2,
      actionable: false,
      toBundleId: (name) => stripSuffix(name, BINARYCOOKIES_SUFFIX) ?? name,
    },
    {
      dir: join(lib, 'Application Support'),
      kind: 'app-data',
      tier: 2,
      actionable: true,
      toBundleId: (name) => name,
    },
    {
      dir: join(lib, 'Containers'),
      kind: 'app-data',
      tier: 2,
      actionable: true,
      requiresFullDiskAccess: true,
      toBundleId: (name) => name,
    },
    {
      dir: join(lib, 'Preferences'),
      kind: 'settings',
      tier: 3,
      actionable: false,
      toBundleId: (name) => stripSuffix(name, PLIST_SUFFIX),
    },
  ];
}

function isKnown(bundleId: string, known: Set<string>): boolean {
  if (known.has(bundleId)) return true;
  for (const id of known) {
    // known com.foo.app rules out com.foo.app.helper and com.foo.
    if (bundleId.startsWith(`${id}.`)) return true;
    if (id.startsWith(`${bundleId}.`)) return true;
  }
  return false;
}

export interface FindOrphanedAppDataOptions {
  home: string;
  installed: InstalledApp[];
  fullDiskAccess: boolean;
  signal?: AbortSignal;
  minBytes?: number;
}

interface LocationDraft {
  spec: ScanSpec;
  path: string;
}

export async function findOrphanedAppData(
  opts: FindOrphanedAppDataOptions,
): Promise<AppReport[]> {
  const minBytes = opts.minBytes ?? DEFAULT_MIN_BYTES;
  const known = new Set(opts.installed.map((app) => app.bundleId.toLowerCase()));

  const groups = new Map<string, LocationDraft[]>();

  for (const spec of scanSpecs(opts.home)) {
    if (spec.requiresFullDiskAccess === true && !opts.fullDiskAccess) continue;

    let dirents: Dirent[];
    try {
      dirents = await readdir(spec.dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const dirent of dirents) {
      if (dirent.isSymbolicLink()) continue;
      const bundleId = spec.toBundleId(dirent.name);
      if (bundleId === undefined) continue;
      if (!BUNDLE_ID_RE.test(bundleId)) continue;
      // Rotated logs and backups (e.g. warp.log.old.1) look dotted but are not bundle ids.
      if (/\.(log|bak|tmp)(\.old)?(\.\d+)?$|\.old\.\d+$|\.\d+$/i.test(bundleId)) continue;
      const lower = bundleId.toLowerCase();
      if (lower.startsWith('com.apple.')) continue;
      if (isKnown(lower, known)) continue;

      const draft: LocationDraft = { spec, path: join(spec.dir, dirent.name) };
      const existing = groups.get(bundleId);
      if (existing === undefined) groups.set(bundleId, [draft]);
      else existing.push(draft);
    }
  }

  const reports: AppReport[] = [];
  for (const [bundleId, drafts] of groups) {
    if (opts.signal?.aborted) break;

    // One shared `seen` set per report, so a path matched twice is measured once.
    const seen = new Set<string>();
    const locations: AppLocation[] = [];
    for (const draft of drafts) {
      const result = await measure(draft.path, { seen });
      if (result.allocated === 0) continue;
      locations.push({
        kind: draft.spec.kind,
        tier: draft.spec.tier,
        actionable: draft.spec.actionable,
        path: draft.path,
        bytesAllocated: result.allocated,
        source: 'generic',
      });
    }
    if (locations.length === 0) continue;

    let cleanable = 0;
    let data = 0;
    for (const location of locations) {
      if (location.actionable) cleanable += location.bytesAllocated;
      else data += location.bytesAllocated;
    }
    const all = cleanable + data;
    if (all < minBytes) continue;

    reports.push({
      orphaned: true,
      app: {
        bundleId,
        name: bundleId,
        path: '',
        running: false,
        bundleBytes: 0,
        system: false,
      },
      locations,
      totals: { cleanable, data, all },
    });
  }

  reports.sort((a, b) => b.totals.all - a.totals.all);
  return reports;
}
