import type { AppProfile } from '../../types';

// Cache folders this deep inside a protected path are known cache directories,
// so they are safe even though their parent is protected (e.g. Chrome's
// `.../Chrome/Default/Code Cache` under the protected `.../Chrome/Default`).
const ALLOWED_DEEP_SEGMENTS = new Set([
  'Cache',
  'Code Cache',
  'GPUCache',
  'CacheStorage',
  'ScriptCache',
  'GrShaderCache',
  'ShaderCache',
  'DawnCache',
  'Caches',
]);

// A cache folder whose last segment names one of these holds user data (or is
// itself protected elsewhere), so a profile may never offer it.
const USER_DATA_WORDS = [
  'Cookies',
  'Local Storage',
  'IndexedDB',
  'databases',
  'Session Storage',
  'workspaceStorage',
  'Messages',
  'Preferences',
  'Keychains',
];

function lastSegment(path: string): string {
  const trimmed = path.replace(/\/+$/, '');
  const index = trimmed.lastIndexOf('/');
  return index === -1 ? trimmed : trimmed.slice(index + 1);
}

function isAtOrInside(path: string, root: string): boolean {
  return path === root || path.startsWith(root.endsWith('/') ? root : `${root}/`);
}

export function lintProfile(profile: AppProfile): string[] {
  const messages: string[] = [];
  const protect = profile.protect ?? [];

  for (const entry of protect) {
    if (entry.includes('..')) messages.push(`protected path '${entry}' must not contain '..'`);
  }

  for (const cache of profile.caches) {
    const { path } = cache;

    // (a) profiles only describe home-relative Library / dotfile caches.
    if (!path.startsWith('~/Library/') && !path.startsWith('~/.')) {
      messages.push(`cache '${path}' must start with '~/Library/' or '~/.`);
    }

    // (b) no traversal, anywhere.
    if (path.includes('..')) messages.push(`cache '${path}' must not contain '..'`);

    // (c) a cache folder that names user data is never cleanable.
    const segment = lastSegment(path);
    for (const word of USER_DATA_WORDS) {
      if (segment.includes(word)) {
        messages.push(`cache '${path}' looks like user data ('${word}')`);
      }
    }

    // (d) caches may not overlap a protected path unless they are a known cache
    // directory strictly below it.
    for (const entry of protect) {
      if (!isAtOrInside(path, entry)) continue;
      const deeper = path !== entry && path.startsWith(entry + '/');
      if (deeper && ALLOWED_DEEP_SEGMENTS.has(segment)) continue;
      messages.push(`cache '${path}' is equal to or inside protected path '${entry}'`);
    }
  }

  return messages;
}

export function lintProfiles(profiles: AppProfile[]): string[] {
  const messages: string[] = [];
  const owners = new Map<string, string>();

  for (const profile of profiles) {
    for (const message of lintProfile(profile)) messages.push(`${profile.id}: ${message}`);

    for (const bundleId of profile.bundleIds) {
      const owner = owners.get(bundleId);
      if (owner !== undefined) {
        messages.push(`bundleId '${bundleId}' is claimed by both '${owner}' and '${profile.id}'`);
      } else {
        owners.set(bundleId, profile.id);
      }
    }
  }

  return messages;
}
