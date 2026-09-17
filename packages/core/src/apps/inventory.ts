import { lstat, readdir, realpath } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { basename, join } from 'node:path';
import type { InstalledApp, ProbeRunner } from '../types';
import { measure } from '../fs/walker';
import { runProbe } from '../probes/run';
import { runningApps } from '../native/helper';

export interface ListInstalledAppsOptions {
  home: string;
  run?: ProbeRunner;
  roots?: string[];
  runningBundleIds?: () => Promise<string[]>;
  measureBundles?: boolean;
}

const APP_BUNDLE_CONCURRENCY = 8;

function defaultRoots(home: string): string[] {
  return [
    '/Applications',
    '/Applications/Utilities',
    `${home}/Applications`,
    '/Applications/Setapp',
    '/System/Applications',
    '/System/Applications/Utilities',
  ];
}

const defaultRunningBundleIds = async (): Promise<string[]> => {
  try {
    const result = await runningApps();
    return result.apps.map((app) => app.bundleId);
  } catch {
    return [];
  }
};

async function isRealDirectory(path: string): Promise<boolean> {
  try {
    const stats = await lstat(path);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

async function findAppsInRoot(root: string): Promise<string[]> {
  let dirents: Dirent[];
  try {
    dirents = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const found: string[] = [];
  for (const dirent of dirents) {
    const full = join(root, dirent.name);
    if (dirent.name.endsWith('.app')) {
      if (await isRealDirectory(full)) found.push(full);
      continue;
    }
    if (!dirent.isDirectory()) continue;

    let children: Dirent[];
    try {
      children = await readdir(full, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const child of children) {
      if (!child.name.endsWith('.app')) continue;
      const childPath = join(full, child.name);
      if (await isRealDirectory(childPath)) found.push(childPath);
    }
  }
  return found;
}

async function readInfoPlist(
  run: ProbeRunner,
  plistPath: string,
): Promise<Record<string, unknown> | null> {
  const result = await run('plutil', ['-convert', 'json', '-o', '-', plistPath]);
  if (result.exitCode !== 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  return parsed as Record<string, unknown>;
}

async function readLastUsed(run: ProbeRunner, appPath: string): Promise<string | undefined> {
  const result = await run('mdls', ['-raw', '-name', 'kMDItemLastUsedDate', appPath]);
  if (result.exitCode !== 0) return undefined;
  const raw = result.stdout.trim();
  if (raw === '' || raw === '(null)') return undefined;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

interface DescribeContext {
  run: ProbeRunner;
  running: Set<string>;
  measureBundles: boolean;
}

async function describeApp(appPath: string, ctx: DescribeContext): Promise<InstalledApp | null> {
  const plist = await readInfoPlist(ctx.run, join(appPath, 'Contents', 'Info.plist'));
  if (plist === null) return null;

  const bundleId = plist.CFBundleIdentifier;
  if (typeof bundleId !== 'string' || bundleId.length === 0) return null;

  const displayName = plist.CFBundleDisplayName;
  const bundleName = plist.CFBundleName;
  const name =
    (typeof displayName === 'string' && displayName.length > 0 ? displayName : undefined) ??
    (typeof bundleName === 'string' && bundleName.length > 0 ? bundleName : undefined) ??
    basename(appPath, '.app');

  const versionValue = plist.CFBundleShortVersionString;
  const version =
    typeof versionValue === 'string' && versionValue.length > 0 ? versionValue : undefined;

  const lastUsed = await readLastUsed(ctx.run, appPath);
  const bundleBytes = ctx.measureBundles ? (await measure(appPath)).allocated : 0;

  return {
    bundleId,
    name,
    version,
    path: appPath,
    lastUsed,
    running: ctx.running.has(bundleId),
    bundleBytes,
    system: appPath.startsWith('/System/'),
  };
}

async function mapLimited<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export async function listInstalledApps(opts: ListInstalledAppsOptions): Promise<InstalledApp[]> {
  const run = opts.run ?? runProbe;
  const roots = opts.roots ?? defaultRoots(opts.home);
  const measureBundles = opts.measureBundles !== false;

  const candidates: string[] = [];
  for (const root of roots) {
    candidates.push(...(await findAppsInRoot(root)));
  }

  const unique = new Map<string, string>();
  for (const candidate of candidates) {
    try {
      const real = await realpath(candidate);
      if (!unique.has(real)) unique.set(real, real);
    } catch {
      // Vanished between readdir and realpath; ignore.
    }
  }

  const paths = [...unique.values()];
  if (paths.length === 0) return [];

  const resolveRunning = opts.runningBundleIds ?? defaultRunningBundleIds;
  let runningIds: string[] = [];
  try {
    runningIds = await resolveRunning();
  } catch {
    runningIds = [];
  }
  const running = new Set(runningIds);

  const described = await mapLimited(paths, APP_BUNDLE_CONCURRENCY, (path) =>
    describeApp(path, { run, running, measureBundles }),
  );

  const apps = described.filter((app): app is InstalledApp => app !== null);
  apps.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  return apps;
}
