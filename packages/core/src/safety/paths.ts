import fs from 'node:fs/promises';
import path from 'node:path';

import type { Rule } from '../types';
import { SafetyError } from './errors';

export function expandHome(p: string, home: string): string {
  if (p === '~') return home;
  if (p.startsWith('~/')) return path.join(home, p.slice(2));
  return p;
}

export function normalizeForCompare(p: string, caseInsensitive: boolean): string {
  let out = path.resolve(p).normalize('NFD');
  if (caseInsensitive) out = out.toLowerCase();
  if (out !== '/' && out.endsWith('/')) out = out.replace(/\/+$/, '');
  return out === '' ? '/' : out;
}

export function isInside(child: string, parent: string): boolean {
  if (child === parent) return true;
  const prefix = parent === '/' ? '/' : `${parent}/`;
  return child.startsWith(prefix);
}

// Exact-match entries: a target equal to one is denied, children are allowed.
export const DENY_EXACT: string[] = [
  '/',
  '/System/Volumes',
  '/usr',
  '/Library',
  '/Applications',
  '/Users',
  '/var',
  '~',
  '~/Library',
  '~/Documents',
  '~/Desktop',
  '~/Pictures',
  '~/Movies',
  '~/Music',
];

// Subtree entries: a target equal to one, or inside it, is denied.
export const DENY_SUBTREE: string[] = [
  '/System',
  '/private/var/vm',
  '/private/var/db',
  '/bin',
  '/sbin',
  '/etc',
  '/private/etc',
  '/Library/Keychains',
  '~/Library/Keychains',
  '~/Library/Messages',
  '~/Library/Mail',
  '~/Library/Preferences',
  '~/Library/Mobile Documents',
  '~/Library/CloudStorage',
];

export const DENYLIST: string[] = [...new Set([...DENY_EXACT, ...DENY_SUBTREE])];

const PRIVATE_ALIASES: Array<[string, string]> = [
  ['/var', '/private/var'],
  ['/tmp', '/private/tmp'],
  ['/etc', '/private/etc'],
];

function rewritePrivate(p: string): string {
  for (const [from, to] of PRIVATE_ALIASES) {
    if (p === from) return to;
    if (p.startsWith(`${from}/`)) return to + p.slice(from.length);
  }
  return p;
}

function isDenied(
  target: string,
  home: string,
  caseInsensitive: boolean,
): boolean {
  const c = normalizeForCompare(rewritePrivate(target), caseInsensitive);

  for (const entry of DENY_EXACT) {
    const denied = normalizeForCompare(rewritePrivate(expandHome(entry, home)), caseInsensitive);
    if (c === denied) return true;
  }

  for (const entry of DENY_SUBTREE) {
    const denied = normalizeForCompare(rewritePrivate(expandHome(entry, home)), caseInsensitive);
    if (isInside(c, denied)) return true;
  }

  // An app bundle itself, directly under either Applications dir.
  for (const appDirEntry of ['/Applications', '~/Applications']) {
    const appDir = normalizeForCompare(rewritePrivate(expandHome(appDirEntry, home)), caseInsensitive);
    if (!isInside(c, appDir) || c === appDir) continue;
    const rel = c.slice(appDir.length + 1);
    if (!rel.includes('/') && rel.endsWith('.app')) return true;
  }

  return false;
}

export async function canonicalTarget(target: string, home: string): Promise<string> {
  const expanded = expandHome(target, home);

  if (!path.isAbsolute(expanded)) {
    throw new SafetyError('NOT_ABSOLUTE', target);
  }
  if (expanded.split('/').includes('..')) {
    throw new SafetyError('OUTSIDE_ROOTS', target);
  }

  const rewritten = rewritePrivate(path.resolve(expanded));
  const parent = path.dirname(rewritten);
  const base = path.basename(rewritten);

  let realParent: string;
  try {
    realParent = await fs.realpath(parent);
  } catch {
    realParent = path.resolve(parent);
  }

  if (normalizeForCompare(realParent, true) !== normalizeForCompare(parent, true)) {
    throw new SafetyError('SYMLINK_IN_PATH', target);
  }

  return path.join(realParent, base);
}

export async function assertSafeTarget(
  target: string,
  rule: Pick<Rule, 'roots' | 'id'>,
  opts: { home: string; caseInsensitive?: boolean },
): Promise<string> {
  const caseInsensitive = opts.caseInsensitive ?? true;
  const canonical = await canonicalTarget(target, opts.home);

  const roots = await Promise.all(
    rule.roots.map(async (root) => {
      const expanded = rewritePrivate(expandHome(root, opts.home));
      try {
        return await fs.realpath(expanded);
      } catch {
        return path.resolve(expanded);
      }
    }),
  );

  const c = normalizeForCompare(canonical, caseInsensitive);
  let inside = false;
  let equal = false;
  for (const root of roots) {
    const r = normalizeForCompare(root, caseInsensitive);
    if (c === r) equal = true;
    if (isInside(c, r)) inside = true;
  }

  const allowedByRoots = (inside && !equal) || (roots.length === 1 && equal);
  if (!allowedByRoots) {
    throw new SafetyError('OUTSIDE_ROOTS', canonical);
  }

  if (isDenied(canonical, opts.home, caseInsensitive)) {
    throw new SafetyError('DENYLISTED', canonical);
  }

  return canonical;
}
