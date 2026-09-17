import { lstat, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { Dirent } from 'node:fs';
import type {
  DiskInfo,
  ProbeRunner,
  SystemDataBucket,
  SystemDataReport,
  Tier,
  WalkOptions,
} from '../types';
import { measure } from '../fs/walker';
import { listLocalSnapshots } from './snapshots';

// Never descended into, on every measurement. The cloud-storage entries are
// File Provider mounts: they share the boot volume's device id, so the walker's
// device check does not stop at them, and enumerating them can block for
// minutes while the provider syncs. They are cloud data, not local System Data.
function baseSkip(home: string): string[] {
  return [
    '/System/Volumes/Data',
    '/Volumes',
    '/dev',
    '/Library/CloudStorage',
    join(home, 'Library/CloudStorage'),
    join(home, 'Library/Mobile Documents'),
  ];
}

// User-visible folders counted as visible space rather than System Data.
const VISIBLE_HOME_DIRS = ['Desktop', 'Documents', 'Downloads', 'Pictures', 'Movies', 'Music'];

const MAX_HIDDEN_CHILDREN = 10;

const SNAPSHOT_COMMAND = 'tmutil thinlocalsnapshots / 10000000000 4';

export interface SystemDataRoots {
  // Default '/Library'.
  library?: string;
  // Default '/private/var'.
  privateVar?: string;
  // Candidate prefixes in priority order; the first that exists is used.
  // Default ['/opt/homebrew', '/usr/local/Homebrew'].
  homebrew?: string[];
  // Default ['/Applications'].
  applications?: string[];
}

export interface AnalyzeSystemDataOptions {
  home: string;
  disk: DiskInfo;
  run?: ProbeRunner;
  signal?: AbortSignal;
  onProgress?: WalkOptions['onProgress'];
  // Every bucket root is overridable so callers and tests can point elsewhere.
  // A supplied field replaces its default.
  roots?: SystemDataRoots;
}

interface Ctx {
  seen: Set<string>;
  baseSkip: string[];
  signal?: AbortSignal;
  onProgress?: WalkOptions['onProgress'];
}

interface ChildSpec {
  id: string;
  title: string;
  path: string;
  explanation: string;
  skip?: string[];
}

async function measureBytes(root: string, ctx: Ctx, skip: string[] = []): Promise<number> {
  const result = await measure(root, {
    seen: ctx.seen,
    skip: [...ctx.baseSkip, ...skip],
    signal: ctx.signal,
    onProgress: ctx.onProgress,
  });
  return result.allocated;
}

async function firstExisting(paths: string[]): Promise<string | undefined> {
  for (const path of paths) {
    try {
      await lstat(path);
      return path;
    } catch {
      // Try the next candidate.
    }
  }
  return undefined;
}

async function listHiddenHomeDirs(home: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(home, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.name.startsWith('.') && entry.name !== '.Trash' && entry.isDirectory())
    .map((entry) => join(home, entry.name));
}

// Measures children first with the shared `seen` set, then the parent with the
// children skipped, so parent bytes = sum(children) + remainder and nothing is
// counted twice.
async function decompose(args: {
  id: string;
  title: string;
  path: string;
  tier: Tier | 'mixed';
  explanation: string;
  manualCommand?: string;
  children: ChildSpec[];
  parentSkip?: string[];
  ctx: Ctx;
}): Promise<SystemDataBucket | null> {
  const { ctx } = args;

  const children: SystemDataBucket[] = [];
  for (const spec of args.children) {
    const bytes = await measureBytes(spec.path, ctx, spec.skip);
    if (bytes <= 0) continue;
    children.push({
      id: spec.id,
      title: spec.title,
      path: spec.path,
      bytes,
      tier: args.tier,
      explanation: spec.explanation,
    });
  }
  children.sort((a, b) => b.bytes - a.bytes);

  const childSum = children.reduce((sum, child) => sum + child.bytes, 0);
  const remainder = await measureBytes(args.path, ctx, [
    ...(args.parentSkip ?? []),
    ...args.children.map((spec) => spec.path),
  ]);
  const bytes = childSum + remainder;
  if (bytes <= 0) return null;

  const bucket: SystemDataBucket = {
    id: args.id,
    title: args.title,
    path: args.path,
    bytes,
    tier: args.tier,
    explanation: args.explanation,
  };
  if (args.manualCommand !== undefined) bucket.manualCommand = args.manualCommand;
  if (children.length > 0) bucket.children = children;
  return bucket;
}

async function hiddenHomeBucket(home: string, ctx: Ctx): Promise<SystemDataBucket | null> {
  const dirs = await listHiddenHomeDirs(home);
  const children: SystemDataBucket[] = [];
  let bytes = 0;

  for (const path of dirs) {
    const size = await measureBytes(path, ctx);
    if (size <= 0) continue;
    bytes += size;
    children.push({
      id: `hidden-home-${basename(path).replace(/^\./, '')}`,
      title: basename(path),
      path,
      bytes: size,
      tier: 'mixed',
      explanation: 'Hidden data in your home folder.',
    });
  }
  if (bytes <= 0) return null;

  children.sort((a, b) => b.bytes - a.bytes);
  return {
    id: 'hidden-home',
    title: 'Hidden home folders',
    path: home,
    bytes,
    tier: 'mixed',
    explanation:
      'Hidden folders in your home directory, such as tool caches and configs like ~/.npm or ~/.cache. Caches rebuild, but credentials and settings live here too, so treat these as user data.',
    children: children.slice(0, MAX_HIDDEN_CHILDREN),
  };
}

function buildReport(
  disk: DiskInfo,
  visible: number,
  buckets: SystemDataBucket[],
  snapshots: { name: string; date?: string }[],
): SystemDataReport {
  const total = Math.max(0, disk.containerUsed - visible);
  const measured = buckets.reduce((sum, bucket) => sum + bucket.bytes, 0);
  const unmeasured = Math.max(0, total - measured);
  return { total, measured, unmeasured, buckets, snapshots };
}

export async function analyzeSystemData(opts: AnalyzeSystemDataOptions): Promise<SystemDataReport> {
  const { home, disk } = opts;
  const roots = opts.roots ?? {};
  const library = roots.library ?? '/Library';
  const privateVar = roots.privateVar ?? '/private/var';
  const applications = roots.applications ?? ['/Applications'];
  const homebrewCandidates = roots.homebrew ?? ['/opt/homebrew', '/usr/local/Homebrew'];

  const ctx: Ctx = {
    seen: new Set<string>(),
    baseSkip: baseSkip(home),
    signal: opts.signal,
    onProgress: opts.onProgress,
  };
  const aborted = (): boolean => opts.signal?.aborted === true;

  const coresimulator = join(library, 'Developer', 'CoreSimulator');
  const userLibrary = join(home, 'Library');

  const buckets: SystemDataBucket[] = [];

  // Visible space: app bundles and the user's own folders. Not System Data, but
  // it is subtracted from the container total below.
  let visible = 0;
  for (const root of [
    ...applications,
    ...VISIBLE_HOME_DIRS.map((dir) => join(home, dir)),
    join(home, '.Trash'),
  ]) {
    if (aborted()) return buildReport(disk, visible, buckets, []);
    visible += await measureBytes(root, ctx);
  }

  const snapshots = aborted() ? [] : await listLocalSnapshots(opts.run);

  const steps: (() => Promise<SystemDataBucket | null>)[] = [
    () =>
      decompose({
        id: 'coresimulator',
        title: 'CoreSimulator',
        path: coresimulator,
        tier: 'mixed',
        explanation:
          'Xcode simulator data: runtime images, simulated devices and caches. The walker does not cross into the mounted runtime volumes, so each runtime image is counted once.',
        children: [
          {
            id: 'coresimulator-images',
            title: 'Images',
            path: join(coresimulator, 'Images'),
            explanation: 'Downloaded simulator runtime images. Delete unused ones in Xcode Settings → Platforms.',
          },
          {
            id: 'coresimulator-devices',
            title: 'Devices',
            path: join(coresimulator, 'Devices'),
            explanation: 'Simulated device data. Erase old devices in Xcode or with `xcrun simctl delete`.',
          },
          {
            id: 'coresimulator-caches',
            title: 'Caches',
            path: join(coresimulator, 'Caches'),
            explanation: 'Dyld and shader caches, rebuilt on the next simulator boot.',
          },
        ],
        ctx,
      }),
    () =>
      decompose({
        id: 'library-other',
        title: '/Library (other)',
        path: library,
        tier: 'mixed',
        explanation:
          'Shared support files for macOS and installed apps: application support, caches, staged updates and developer tools. Most of it belongs to the system or to apps that expect it to stay.',
        parentSkip: [coresimulator],
        children: [
          {
            id: 'library-application-support',
            title: 'Application Support',
            path: join(library, 'Application Support'),
            explanation: 'Per-app support files in the shared library.',
          },
          {
            id: 'library-caches',
            title: 'Caches',
            path: join(library, 'Caches'),
            explanation: 'System-wide caches that rebuild on demand.',
          },
          {
            id: 'library-updates',
            title: 'Updates',
            path: join(library, 'Updates'),
            explanation: 'Staged macOS and App Store updates; macOS removes them after installing.',
          },
          {
            id: 'library-developer',
            title: 'Developer',
            path: join(library, 'Developer'),
            explanation: 'Shared developer tools and runtimes outside CoreSimulator.',
            skip: [coresimulator],
          },
        ],
        ctx,
      }),
    () =>
      decompose({
        id: 'private-var',
        title: '/private/var',
        path: privateVar,
        tier: 3,
        explanation:
          'Runtime state for macOS and apps: swap, per-user temporary folders, databases and logs. Almost none of it is safe to remove by hand.',
        children: [
          {
            id: 'private-var-vm',
            title: 'vm',
            path: join(privateVar, 'vm'),
            explanation: 'Swap files and the sleep image. macOS manages swap; it shrinks after a restart.',
          },
          {
            id: 'private-var-folders',
            title: 'folders',
            path: join(privateVar, 'folders'),
            explanation: 'Per-user temporary folders. macOS clears them at reboot.',
          },
          {
            id: 'private-var-db',
            title: 'db',
            path: join(privateVar, 'db'),
            explanation: 'System databases and installer receipts. Reading only; never delete.',
          },
          {
            id: 'private-var-log',
            title: 'log',
            path: join(privateVar, 'log'),
            explanation: 'System logs. macOS rotates and ages them out.',
          },
        ],
        ctx,
      }),
    async () => {
      const path = await firstExisting(homebrewCandidates);
      if (path === undefined) return null;
      const bytes = await measureBytes(path, ctx);
      if (bytes <= 0) return null;
      return {
        id: 'homebrew',
        title: 'Homebrew',
        path,
        bytes,
        tier: 'mixed',
        explanation:
          'Homebrew packages, downloads and build caches. `brew cleanup` reclaims the parts that rebuild.',
      };
    },
    () =>
      decompose({
        id: 'user-library',
        title: '~/Library',
        path: userLibrary,
        tier: 'mixed',
        explanation:
          'Your Library folder: caches, sandboxed app containers and support files. Caches and logs rebuild themselves; containers, Mail and Messages hold real data.',
        children: [
          {
            id: 'user-library-caches',
            title: 'Caches',
            path: join(userLibrary, 'Caches'),
            explanation: 'App caches that rebuild when the app runs again.',
          },
          {
            id: 'user-library-containers',
            title: 'Containers',
            path: join(userLibrary, 'Containers'),
            explanation: 'Sandboxed app containers. Many hold real data; not safe to delete wholesale.',
          },
          {
            id: 'user-library-group-containers',
            title: 'Group Containers',
            path: join(userLibrary, 'Group Containers'),
            explanation: 'Data shared between apps from the same developer.',
          },
          {
            id: 'user-library-application-support',
            title: 'Application Support',
            path: join(userLibrary, 'Application Support'),
            explanation: 'Per-app support files and databases.',
          },
          {
            id: 'user-library-developer',
            title: 'Developer',
            path: join(userLibrary, 'Developer'),
            explanation: 'Xcode, simulator and device support data under your account.',
          },
          {
            id: 'user-library-logs',
            title: 'Logs',
            path: join(userLibrary, 'Logs'),
            explanation: 'App and diagnostic logs.',
          },
          {
            id: 'user-library-mail',
            title: 'Mail',
            path: join(userLibrary, 'Mail'),
            explanation: 'Your local mail database and attachments. Real data.',
          },
          {
            id: 'user-library-messages',
            title: 'Messages',
            path: join(userLibrary, 'Messages'),
            explanation: 'Your iMessage history and attachments. Real data.',
          },
        ],
        ctx,
      }),
    () => hiddenHomeBucket(home, ctx),
  ];

  for (const step of steps) {
    if (aborted()) break;
    const bucket = await step();
    if (bucket) buckets.push(bucket);
  }

  if (!aborted() && snapshots.length > 0) {
    buckets.push({
      id: 'snapshots',
      title: 'Local Time Machine snapshots',
      bytes: 0,
      tier: 3,
      explanation: "Local Time Machine snapshots. Their size can't be measured without admin rights.",
      manualCommand: SNAPSHOT_COMMAND,
    });
  }

  buckets.sort((a, b) => b.bytes - a.bytes);

  return buildReport(disk, visible, buckets, snapshots);
}
