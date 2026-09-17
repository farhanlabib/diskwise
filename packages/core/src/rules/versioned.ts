import { readdir, readlink } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { Candidate, MatcherContext, MatcherSpec } from '../types';
import { expandHome } from './expand';

export function extractVersion(name: string): number[] | null {
  const match = /\d+(?:\.\d+)*/.exec(name);
  if (match === null) return null;
  return match[0].split('.').map((part) => Number(part));
}

export function compareVersions(a: number[], b: number[]): number {
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    if (left !== right) return left - right;
  }
  return 0;
}

function globToRegExp(glob: string): RegExp {
  let source = '';
  for (const ch of glob) {
    if (ch === '*') source += '.*';
    else if (ch === '?') source += '.';
    else source += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`);
}

async function readRoot(root: string) {
  try {
    return await readdir(root, { withFileTypes: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'EPERM') return [];
    throw err;
  }
}

export async function runVersionedChildren(
  spec: Extract<MatcherSpec, { kind: 'versioned-children' }>,
  ctx: MatcherContext,
): Promise<Candidate[]> {
  const root = expandHome(spec.root, ctx.home);
  const entries = await readRoot(root);

  const protectedNames = new Set<string>();
  for (const entry of entries) {
    if (!entry.isSymbolicLink()) continue;
    try {
      protectedNames.add(basename(await readlink(join(root, entry.name))));
    } catch {
      // A link we cannot read protects nothing.
    }
  }

  const includes = (spec.include ?? ['*']).map(globToRegExp);
  const versioned: { name: string; version: number[]; path: string }[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!includes.some((re) => re.test(entry.name))) continue;
    if (protectedNames.has(entry.name)) continue;
    const version = extractVersion(entry.name);
    if (version === null) continue;
    versioned.push({ name: entry.name, version, path: join(root, entry.name) });
  }

  versioned.sort(
    (a, b) =>
      compareVersions(b.version, a.version) ||
      (a.name < b.name ? 1 : a.name > b.name ? -1 : 0),
  );

  return versioned.slice(spec.keepNewest).map((item) => ({
    kind: 'dir' as const,
    path: item.path,
    detail: item.name,
  }));
}
