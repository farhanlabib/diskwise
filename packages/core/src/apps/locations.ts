import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  AppLocation,
  AppLocationKind,
  AppLocationState,
  AppProfile,
  InstalledApp,
  Tier,
} from '../types';
import { profileForBundleId } from './profiles';
import { appLocationState } from './state';

export const CHROMIUM_CACHE_DIRS: string[] = [
  'Cache',
  'Code Cache',
  'GPUCache',
  'DawnCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'ShaderCache',
  'GrShaderCache',
  'Service Worker/CacheStorage',
  'Service Worker/ScriptCache',
  'CachedData',
  'CachedProfilesData',
];

interface LocationSpec {
  kind: AppLocationKind;
  tier: Tier;
  state: AppLocationState;
  path: string;
  source: AppLocation['source'];
  note?: string;
}

const KIND_META: Record<AppLocationKind, { tier: Tier }> = {
  caches: { tier: 0 },
  logs: { tier: 1 },
  'saved-state': { tier: 1 },
  'sign-in-data': { tier: 2 },
  'app-data': { tier: 2 },
  settings: { tier: 3 },
};

// Defends against a plist value turning a home-relative path into a traversal or
// pointing at the shared parent directory.
function isSafeComponent(value: string): boolean {
  return value.length > 0 && !value.includes('/') && value !== '..' && value !== '.';
}

async function existsNonSymlink(path: string): Promise<boolean> {
  try {
    const stats = await lstat(path);
    return !stats.isSymbolicLink();
  } catch {
    return false;
  }
}

// Profile paths are written as '~/' strings; resolve them against the scan home.
function expandHome(path: string, home: string): string {
  if (path === '~') return home;
  if (path.startsWith('~/')) return join(home, path.slice(2));
  return path;
}

function isAtOrInside(path: string, root: string): boolean {
  return path === root || path.startsWith(root.endsWith('/') ? root : `${root}/`);
}

async function resolveProfileCaches(profile: AppProfile, home: string): Promise<LocationSpec[]> {
  const specs: LocationSpec[] = [];
  for (const cache of profile.caches) {
    const path = expandHome(cache.path, home);
    if (!(await existsNonSymlink(path))) continue;
    const spec: LocationSpec = {
      kind: 'caches',
      tier: cache.tier,
      state: 'cleanable',
      path,
      source: 'profile',
    };
    if (cache.note !== undefined) spec.note = cache.note;
    specs.push(spec);
  }
  return specs;
}

export async function resolveAppLocations(
  app: Pick<InstalledApp, 'bundleId' | 'name'>,
  opts: { home: string; fullDiskAccess: boolean },
): Promise<Omit<AppLocation, 'bytesAllocated'>[]> {
  const { bundleId, name } = app;
  if (!isSafeComponent(bundleId) || !isSafeComponent(name)) return [];

  const lib = join(opts.home, 'Library');
  const appSupport = join(lib, 'Application Support');
  const candidates: LocationSpec[] = [];

  const add = (kind: AppLocationKind, path: string): void => {
    const meta = KIND_META[kind];
    candidates.push({
      kind,
      tier: meta.tier,
      // Installed apps: their own app data and settings are report-only.
      state: appLocationState(kind, meta.tier, false),
      path,
      source: 'generic',
    });
  };

  // caches (tier 0, cleanable)
  add('caches', join(lib, 'Caches', bundleId));
  for (const dir of CHROMIUM_CACHE_DIRS) add('caches', join(appSupport, name, dir));
  for (const dir of CHROMIUM_CACHE_DIRS) add('caches', join(appSupport, bundleId, dir));
  // Reading ~/Library/Containers without Full Disk Access triggers a macOS 14+
  // privacy prompt, so it is never touched unless the permission is granted.
  if (opts.fullDiskAccess) {
    add('caches', join(lib, 'Containers', bundleId, 'Data', 'Library', 'Caches'));
  }

  // logs (tier 1, cleanable)
  add('logs', join(lib, 'Logs', name));
  add('logs', join(lib, 'Logs', bundleId));

  // saved-state (tier 1, cleanable)
  add('saved-state', join(lib, 'Saved Application State', `${bundleId}.savedState`));

  // sign-in-data (tier 2, report-only)
  add('sign-in-data', join(lib, 'HTTPStorages', bundleId));
  add('sign-in-data', join(lib, 'HTTPStorages', `${bundleId}.binarycookies`));
  add('sign-in-data', join(lib, 'Cookies', `${bundleId}.binarycookies`));
  add('sign-in-data', join(lib, 'WebKit', bundleId));

  // app-data (tier 2, report-only)
  add('app-data', join(appSupport, name));
  add('app-data', join(appSupport, bundleId));
  if (opts.fullDiskAccess) add('app-data', join(lib, 'Containers', bundleId));

  // settings (tier 3, report-only)
  add('settings', join(lib, 'Preferences', `${bundleId}.plist`));

  let ordered = candidates;
  const profile = profileForBundleId(bundleId);
  if (profile) {
    const protect = (profile.protect ?? []).map((entry) => expandHome(entry, opts.home));

    // A generic cache inside a folder the profile protects is report-only.
    for (const candidate of candidates) {
      if (candidate.kind !== 'caches') continue;
      if (protect.some((entry) => isAtOrInside(candidate.path, entry))) {
        candidate.state = 'reportOnly';
      }
    }

    const profileCaches = await resolveProfileCaches(profile, opts.home);
    const profilePaths = new Set(profileCaches.map((cache) => cache.path));

    // A profile entry replaces a generic entry with the same path, and profile
    // caches sit right after the generic caches so report.ts measures them
    // before app-data (which is what keeps the shared `seen` set honest).
    const withoutGenerics = candidates.filter(
      (candidate) => !(candidate.source === 'generic' && profilePaths.has(candidate.path)),
    );
    const cacheEnd = withoutGenerics.findIndex((candidate) => candidate.kind !== 'caches');
    const insertAt = cacheEnd === -1 ? withoutGenerics.length : cacheEnd;
    withoutGenerics.splice(insertAt, 0, ...profileCaches);
    ordered = withoutGenerics;
  }

  const out: Omit<AppLocation, 'bytesAllocated'>[] = [];
  const seen = new Set<string>();
  for (const candidate of ordered) {
    if (seen.has(candidate.path)) continue;
    seen.add(candidate.path);
    if (await existsNonSymlink(candidate.path)) out.push(candidate);
  }
  return out;
}
