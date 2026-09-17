import { mkdir, mkdtemp, realpath, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Candidate, MatcherContext } from '../types';
import { resolveBin } from '../probes/bin-resolver';
import { dockerRules } from './catalog/docker';
import { expandHome } from './expand';
import { runMatcher, runRuleMatcher } from './matchers';

// The docker probe resolves its binary through resolveBin; tests control whether
// docker exists (null) or where it lives.
vi.mock('../probes/bin-resolver', () => ({
  resolveBin: vi.fn(async () => null),
}));

const DAY_MS = 86_400_000;
let home: string;

function ctx(now = new Date()): MatcherContext {
  return {
    home,
    now,
    run: async () => ({ stdout: '', stderr: '', exitCode: 0 }),
  };
}

async function writeProject(dir: string, lockfile: string | null, ageDays: number): Promise<void> {
  await mkdir(join(dir, 'node_modules'), { recursive: true });
  await writeFile(join(dir, 'package.json'), '{"name":"fixture"}');
  if (lockfile !== null) await writeFile(join(dir, lockfile), '');
  const when = ageDays === 0 ? new Date() : new Date(Date.now() - ageDays * DAY_MS);
  await utimes(join(dir, 'node_modules'), when, when);
  await utimes(join(dir, 'package.json'), when, when);
}

beforeAll(async () => {
  home = await realpath(await mkdtemp(join(tmpdir(), 'macsweep-matchers-')));

  await writeProject(join(home, 'proj-stale'), 'package-lock.json', 60);
  await writeProject(join(home, 'proj-fresh'), 'package-lock.json', 0);
  await writeProject(join(home, 'proj-nested'), 'pnpm-lock.yaml', 60);
  await mkdir(join(home, 'proj-nested', 'node_modules', 'inner', 'node_modules'), { recursive: true });
  await writeProject(join(home, 'excluded'), 'yarn.lock', 60);
  await writeProject(join(home, 'proj-nolock'), null, 60);
  await writeProject(join(home, 'real'), 'package-lock.json', 60);
  await symlink(join(home, 'real'), join(home, 'linked'), 'dir');

  await mkdir(join(home, 'glob', 'sub'), { recursive: true });
  await writeFile(join(home, 'glob', 'a.txt'), '');
  await writeFile(join(home, 'glob', 'b.txt'), '');
  await writeFile(join(home, 'glob', 'c.log'), '');

  await mkdir(join(home, 'aged'), { recursive: true });
  await writeFile(join(home, 'aged', 'old.txt'), '');
  await writeFile(join(home, 'aged', 'new.txt'), '');
  const old = new Date(Date.now() - 30 * DAY_MS);
  await utimes(join(home, 'aged', 'old.txt'), old, old);
});

afterAll(async () => {
  if (home) await rm(home, { recursive: true, force: true });
});

describe('runMatcher path', () => {
  it('returns a dir candidate when the path exists', async () => {
    const found = await runMatcher({ kind: 'path', path: '~/glob' }, ctx());
    expect(found).toHaveLength(1);
    expect(found[0]?.kind).toBe('dir');
    expect(found[0]?.path).toBe(join(home, 'glob'));
  });

  it('returns a file candidate when the path is a file', async () => {
    const found = await runMatcher({ kind: 'path', path: '~/glob/a.txt' }, ctx());
    expect(found).toHaveLength(1);
    expect(found[0]?.kind).toBe('file');
  });

  it('returns [] when the path is missing', async () => {
    expect(await runMatcher({ kind: 'path', path: '~/does-not-exist' }, ctx())).toEqual([]);
  });
});

describe('runMatcher glob-children', () => {
  it('applies include and exclude globs', async () => {
    const found = await runMatcher(
      { kind: 'glob-children', root: '~/glob', include: ['*.txt'], exclude: ['b*'] },
      ctx(),
    );
    expect(found.map((c) => c.path)).toEqual([join(home, 'glob', 'a.txt')]);
  });

  it('defaults to every non-symlink child', async () => {
    const found = await runMatcher({ kind: 'glob-children', root: '~/glob' }, ctx());
    expect(found.map((c) => c.path?.split('/').pop()).sort()).toEqual([
      'a.txt',
      'b.txt',
      'c.log',
      'sub',
    ]);
  });

  it('returns [] for a missing root', async () => {
    expect(await runMatcher({ kind: 'glob-children', root: '~/nope' }, ctx())).toEqual([]);
  });

  it('keeps only children older than olderThanDays', async () => {
    const found = await runMatcher(
      { kind: 'glob-children', root: '~/aged', olderThanDays: 7 },
      ctx(),
    );
    expect(found.map((c) => c.path)).toEqual([join(home, 'aged', 'old.txt')]);
  });

  it('keeps every child when olderThanDays is not set', async () => {
    const found = await runMatcher({ kind: 'glob-children', root: '~/aged' }, ctx());
    expect(found.map((c) => c.path?.split('/').pop()).sort()).toEqual(['new.txt', 'old.txt']);
  });
});

describe('runMatcher project-dirs', () => {
  const spec = {
    kind: 'project-dirs' as const,
    searchRoots: ['~'],
    name: 'node_modules',
    marker: 'package.json',
    maxAgeDays: 14,
    excludePrefixes: ['~/excluded'],
  };

  let candidates: Candidate[] = [];

  beforeAll(async () => {
    candidates = await runMatcher(spec, ctx());
  });

  it('(1) reports a stale project that has a lockfile', () => {
    const stale = candidates.find((c) => c.path === join(home, 'proj-stale', 'node_modules'));
    expect(stale).toBeDefined();
    expect(stale?.detail).toBe('~/proj-stale/node_modules');
    expect(stale?.tierOverride).toBeUndefined();
    expect(stale?.reportOnly).toBeUndefined();
  });

  it('(2) skips a freshly modified project', () => {
    expect(candidates.some((c) => c.path === join(home, 'proj-fresh', 'node_modules'))).toBe(false);
  });

  it('(3) does not double-report nested node_modules', () => {
    const nested = candidates.filter((c) => c.path?.includes('proj-nested'));
    expect(nested.map((c) => c.path)).toEqual([join(home, 'proj-nested', 'node_modules')]);
  });

  it('(4) skips excluded prefixes', () => {
    expect(candidates.some((c) => c.path?.startsWith(join(home, 'excluded')))).toBe(false);
  });

  it('(5) downgrades a project without a lockfile', () => {
    const noLock = candidates.find((c) => c.path === join(home, 'proj-nolock', 'node_modules'));
    expect(noLock).toBeDefined();
    expect(noLock?.tierOverride).toBe(2);
    expect(noLock?.reportOnly).toBe(true);
    expect(noLock?.detail).toContain('no lockfile');
  });

  it('(6) never follows a symlinked directory', () => {
    expect(candidates.some((c) => c.path?.startsWith(join(home, 'linked')))).toBe(false);
    expect(candidates.map((c) => c.path).sort()).toEqual([
      join(home, 'proj-nested', 'node_modules'),
      join(home, 'proj-nolock', 'node_modules'),
      join(home, 'proj-stale', 'node_modules'),
      join(home, 'real', 'node_modules'),
    ]);
  });

  it('expands ~ against the provided home', () => {
    expect(expandHome('~', home)).toBe(home);
    expect(expandHome('~/x', home)).toBe(join(home, 'x'));
    expect(expandHome('/absolute', home)).toBe('/absolute');
  });
});

describe('runMatcher probe', () => {
  it('returns [] for probes that are not implemented yet', async () => {
    expect(await runMatcher({ kind: 'probe', probe: 'macos-installers' }, ctx())).toEqual([]);
  });

  it('returns [] when the probe command fails', async () => {
    const failing: MatcherContext = {
      home,
      now: new Date(),
      run: async () => ({ stdout: '', stderr: 'boom', exitCode: 1 }),
    };
    expect(await runMatcher({ kind: 'probe', probe: 'simctl-runtimes' }, failing)).toEqual([]);
  });

  it('parses simctl runtime output from the probe runner', async () => {
    const json = JSON.stringify({
      UUID: {
        version: '26.1',
        build: '23B86',
        platformIdentifier: 'com.apple.platform.iphonesimulator',
        sizeBytes: 42,
        deletable: true,
        lastUsedAt: null,
      },
    });
    const stub: MatcherContext = {
      home,
      now: new Date(),
      run: async () => ({ stdout: json, stderr: '', exitCode: 0 }),
    };
    const found = await runMatcher({ kind: 'probe', probe: 'simctl-runtimes' }, stub);
    expect(found).toHaveLength(1);
    expect(found[0]?.detail).toBe('iOS 26.1 (23B86), never used');
  });

  it('aggregates unavailable simulator devices into one candidate', async () => {
    const json = JSON.stringify({
      devices: {
        'com.apple.CoreSimulator.SimRuntime.iOS-17-4': [
          { udid: 'A', name: 'iPhone 14', state: 'Shutdown', isAvailable: false, dataPathSize: 1000 },
          { udid: 'B', name: 'iPhone 15', state: 'Shutdown', isAvailable: true, dataPathSize: 2000 },
        ],
      },
    });
    const stub: MatcherContext = {
      home,
      now: new Date(),
      run: async () => ({ stdout: json, stderr: '', exitCode: 0 }),
    };
    const found = await runMatcher({ kind: 'probe', probe: 'simctl-devices' }, stub);
    expect(found).toEqual([
      {
        kind: 'virtual',
        detail: '1 unavailable simulator devices',
        bytesHint: { allocated: 1000, apparent: 1000 },
      },
    ]);
  });

  it('returns [] from simctl-devices when no device is unavailable', async () => {
    const json = JSON.stringify({
      devices: {
        'com.apple.CoreSimulator.SimRuntime.iOS-17-4': [
          { udid: 'A', name: 'iPhone 15', state: 'Booted', isAvailable: true },
        ],
      },
    });
    const stub: MatcherContext = {
      home,
      now: new Date(),
      run: async () => ({ stdout: json, stderr: '', exitCode: 0 }),
    };
    expect(await runMatcher({ kind: 'probe', probe: 'simctl-devices' }, stub)).toEqual([]);
  });
});

const DOCKER_DF = JSON.stringify({
  Images: [
    { Repository: 'postgres', Tag: '16', ID: 'b2c3d4e5f6a1', Size: '350MB', Containers: '0' },
    { Repository: '<none>', Tag: '<none>', ID: 'sha256:c3d4e5f6a1b2', Size: '180MB', Containers: '0' },
    { Repository: 'node', Tag: '20', ID: 'a1b2c3d4e5f6', Size: '1.2GB', Containers: 2 },
  ],
  Containers: [
    { Names: 'web', State: 'running', Size: '10kB' },
    { Names: 'db', State: 'exited', Size: '1.5MB' },
  ],
  Volumes: [{ Name: 'pgdata', Size: '220MB', Links: 2 }],
  BuildCache: [{ Size: '500MB' }, { Size: '136MB' }],
});

function dockerRule(id: string) {
  const rule = dockerRules.find((r) => r.id === id);
  if (!rule) throw new Error(`missing rule ${id}`);
  return rule;
}

describe('runRuleMatcher docker groups', () => {
  beforeEach(() => {
    vi.mocked(resolveBin).mockReset();
    vi.mocked(resolveBin).mockResolvedValue(null);
  });

  it('returns [] without running anything when docker is missing', async () => {
    const run: MatcherContext['run'] = async () => ({ stdout: '', stderr: '', exitCode: 0 });
    const ctx: MatcherContext = { home, now: new Date(), run };
    expect(await runRuleMatcher(dockerRule('docker.build-cache'), ctx)).toEqual([]);
  });

  it('returns [] when the docker daemon is stopped', async () => {
    vi.mocked(resolveBin).mockResolvedValue('/usr/local/bin/docker');
    const run: MatcherContext['run'] = async () => ({
      stdout: '',
      stderr: 'Cannot connect to the Docker daemon',
      exitCode: 1,
    });
    const ctx: MatcherContext = { home, now: new Date(), run };
    expect(await runRuleMatcher(dockerRule('docker.build-cache'), ctx)).toEqual([]);
  });

  it('filters each rule to its own docker group', async () => {
    vi.mocked(resolveBin).mockResolvedValue('/usr/local/bin/docker');
    const run: MatcherContext['run'] = async (_bin, args) =>
      args[0] === 'info'
        ? { stdout: '28.3.2\n', stderr: '', exitCode: 0 }
        : { stdout: DOCKER_DF, stderr: '', exitCode: 0 };
    const ctx: MatcherContext = { home, now: new Date(), run };

    const buildCache = await runRuleMatcher(dockerRule('docker.build-cache'), ctx);
    expect(buildCache.map((c) => c.detail)).toEqual(['Docker build cache']);

    const dangling = await runRuleMatcher(dockerRule('docker.dangling-images'), ctx);
    expect(dangling.map((c) => c.detail)).toEqual(['image <none> (c3d4e5)']);

    const unused = await runRuleMatcher(dockerRule('docker.unused-images'), ctx);
    expect(unused.map((c) => c.actionArgs)).toEqual([{ all: 'true', group: 'unused-images' }]);

    const stopped = await runRuleMatcher(dockerRule('docker.stopped-containers'), ctx);
    expect(stopped.map((c) => c.detail)).toEqual(['container db (exited)']);

    const volumes = await runRuleMatcher(dockerRule('docker.volumes'), ctx);
    expect(volumes.map((c) => c.detail)).toEqual(['volume pgdata (2 links)']);
  });

  it('runs the docker probe once for two rules sharing a ctx', async () => {
    vi.mocked(resolveBin).mockResolvedValue('/usr/local/bin/docker');
    let dfCalls = 0;
    const run: MatcherContext['run'] = async (_bin, args) => {
      if (args[0] === 'info') return { stdout: '28.3.2\n', stderr: '', exitCode: 0 };
      dfCalls += 1;
      return { stdout: DOCKER_DF, stderr: '', exitCode: 0 };
    };
    const ctx: MatcherContext = { home, now: new Date(), run };
    await runRuleMatcher(dockerRule('docker.build-cache'), ctx);
    await runRuleMatcher(dockerRule('docker.volumes'), ctx);
    expect(dfCalls).toBe(1);
  });
});
