import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { resolveBin } from '../probes/bin-resolver';
import type { Candidate, MatcherContext, MatcherSpec, Rule } from '../types';
import { expandHome } from './expand';
import { runVersionedChildren } from './versioned';
import { parseSimctlRuntimes } from './probes/simctl';
import { aggregateUnavailableDevices, parseUnavailableDevices } from './probes/simctl-devices';
import { dockerDfCandidates, filterDockerGroup, type DockerGroup } from './probes/docker';

const LOCKFILES = ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'bun.lock'];

function tilde(p: string, home: string): string {
  if (p === home) return '~';
  if (p.startsWith(home + '/')) return '~' + p.slice(home.length);
  return p;
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

async function lstatOrNull(p: string): Promise<Awaited<ReturnType<typeof lstat>> | null> {
  try {
    return await lstat(p);
  } catch {
    return null;
  }
}

async function anyExists(paths: string[]): Promise<boolean> {
  for (const p of paths) {
    if ((await lstatOrNull(p)) !== null) return true;
  }
  return false;
}

function isInsideAnotherNameDir(p: string, name: string): boolean {
  const segments = p.split('/');
  segments.pop();
  return segments.includes(name);
}

async function runPath(
  spec: Extract<MatcherSpec, { kind: 'path' }>,
  ctx: MatcherContext,
): Promise<Candidate[]> {
  const target = expandHome(spec.path, ctx.home);
  const stats = await lstatOrNull(target);
  if (stats === null) return [];
  return [
    {
      kind: stats.isDirectory() ? 'dir' : 'file',
      path: target,
      detail: tilde(target, ctx.home),
    },
  ];
}

async function runGlobChildren(
  spec: Extract<MatcherSpec, { kind: 'glob-children' }>,
  ctx: MatcherContext,
): Promise<Candidate[]> {
  const root = expandHome(spec.root, ctx.home);
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const includes = (spec.include ?? ['*']).map(globToRegExp);
  const excludes = (spec.exclude ?? []).map(globToRegExp);
  const olderThan =
    spec.olderThanDays === undefined ? null : ctx.now.getTime() - spec.olderThanDays * 86_400_000;
  const candidates: Candidate[] = [];

  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    if (!includes.some((re) => re.test(entry.name))) continue;
    if (excludes.some((re) => re.test(entry.name))) continue;
    const path = join(root, entry.name);
    if (olderThan !== null) {
      const stats = await lstatOrNull(path);
      if (stats === null || stats.mtimeMs >= olderThan) continue;
    }
    candidates.push({
      kind: entry.isDirectory() ? 'dir' : 'file',
      path,
      detail: tilde(path, ctx.home),
    });
  }

  return candidates;
}

async function makeProjectCandidate(
  dir: string,
  parent: string,
  ctx: MatcherContext,
): Promise<Candidate> {
  const hasLockfile = await anyExists(LOCKFILES.map((name) => join(parent, name)));
  const candidate: Candidate = {
    kind: 'dir',
    path: dir,
    detail: tilde(dir, ctx.home) + (hasLockfile ? '' : ', no lockfile'),
  };
  if (!hasLockfile) {
    candidate.tierOverride = 2;
    candidate.reportOnly = true;
  }
  return candidate;
}

async function runProjectDirs(
  spec: Extract<MatcherSpec, { kind: 'project-dirs' }>,
  ctx: MatcherContext,
): Promise<Candidate[]> {
  const maxDepth = spec.maxDepth ?? 6;
  const threshold = ctx.now.getTime() - spec.maxAgeDays * 86_400_000;
  const excluded = spec.excludePrefixes.map((prefix) => expandHome(prefix, ctx.home));
  const libraryPath = expandHome('~/Library', ctx.home);

  const queue: { dir: string; depth: number }[] = spec.searchRoots.map((root) => ({
    dir: expandHome(root, ctx.home),
    depth: 0,
  }));
  const visited = new Set<string>();
  const candidates: Candidate[] = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    if (visited.has(current.dir)) continue;
    visited.add(current.dir);

    let entries;
    try {
      entries = await readdir(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      if (!entry.isDirectory()) continue;

      const child = join(current.dir, entry.name);

      if (entry.name === spec.name) {
        const markerPath = join(current.dir, spec.marker);
        const markerStats = await lstatOrNull(markerPath);
        if (markerStats === null) continue;
        if (excluded.some((prefix) => child === prefix || child.startsWith(prefix + '/'))) continue;
        if (isInsideAnotherNameDir(child, spec.name)) continue;

        const childStats = await lstatOrNull(child);
        if (childStats === null) continue;
        const markerFresh = markerStats.mtimeMs > threshold;
        const childFresh = childStats.mtimeMs > threshold;
        if (markerFresh && childFresh) continue;

        candidates.push(await makeProjectCandidate(child, current.dir, ctx));
        continue;
      }

      if (entry.name.startsWith('.')) continue;
      if (current.depth + 1 > maxDepth) continue;
      if (child === libraryPath) continue;
      queue.push({ dir: child, depth: current.depth + 1 });
    }
  }

  return candidates;
}

async function runProbe(
  spec: Extract<MatcherSpec, { kind: 'probe' }>,
  ctx: MatcherContext,
): Promise<Candidate[]> {
  try {
    switch (spec.probe) {
      case 'simctl-runtimes': {
        const result = await ctx.run('xcrun', ['simctl', 'runtime', 'list', '-j'], {
          signal: ctx.signal,
        });
        if (result.exitCode !== 0) return [];
        return parseSimctlRuntimes(result.stdout);
      }
      case 'simctl-devices': {
        const result = await ctx.run('xcrun', ['simctl', 'list', 'devices', '-j'], {
          signal: ctx.signal,
        });
        if (result.exitCode !== 0) return [];
        return aggregateUnavailableDevices(parseUnavailableDevices(result.stdout));
      }
      case 'docker-df': {
        const bin = await resolveBin('docker', { home: ctx.home });
        if (bin === null) return [];
        const info = await ctx.run(bin, ['info', '--format', '{{.ServerVersion}}'], {
          signal: ctx.signal,
        });
        if (info.exitCode !== 0) return [];
        const df = await ctx.run(bin, ['system', 'df', '-v', '--format', '{{json .}}'], {
          signal: ctx.signal,
        });
        if (df.exitCode !== 0) return [];
        return dockerDfCandidates(df.stdout);
      }
      default:
        return [];
    }
  } catch {
    return [];
  }
}

export async function runMatcher(spec: MatcherSpec, ctx: MatcherContext): Promise<Candidate[]> {
  switch (spec.kind) {
    case 'path':
      return runPath(spec, ctx);
    case 'glob-children':
      return runGlobChildren(spec, ctx);
    case 'project-dirs':
      return runProjectDirs(spec, ctx);
    case 'probe':
      return runProbe(spec, ctx);
    case 'versioned-children':
      return runVersionedChildren(spec, ctx);
  }
}

// A probe matcher spec cannot name a docker group, so a docker rule's id picks
// its slice of the one `docker system df` result.
const DOCKER_RULE_GROUPS: Record<string, DockerGroup> = {
  'docker.build-cache': 'build-cache',
  'docker.dangling-images': 'dangling-images',
  'docker.unused-images': 'unused-images',
  'docker.stopped-containers': 'stopped-containers',
  'docker.volumes': 'volumes',
};

// docker system df is one expensive probe shared by every docker rule in a scan.
const dockerProbeCache = new WeakMap<MatcherContext, Promise<Candidate[]>>();

function runDockerProbe(ctx: MatcherContext): Promise<Candidate[]> {
  let probe = dockerProbeCache.get(ctx);
  if (probe === undefined) {
    probe = runMatcher({ kind: 'probe', probe: 'docker-df' }, ctx);
    dockerProbeCache.set(ctx, probe);
  }
  return probe;
}

export async function runRuleMatcher(rule: Rule, ctx: MatcherContext): Promise<Candidate[]> {
  const spec = rule.matcher;
  if (spec.kind === 'probe' && spec.probe === 'docker-df') {
    const candidates = await runDockerProbe(ctx);
    const group = DOCKER_RULE_GROUPS[rule.id];
    return group === undefined ? candidates : filterDockerGroup(candidates, group);
  }
  return runMatcher(spec, ctx);
}
