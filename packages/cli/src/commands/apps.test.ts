import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { executePlan } from '@macsweep/core';
import type { AppReport, CleanupPlan } from '@macsweep/core/types';
import { formatBytes } from '@macsweep/report';
import type { ServerHandle, StartServerOptions } from '@macsweep/server';
import { promptImpl } from '../prompt';
import type { IO } from '../program';
import { registerAppsCommand } from './apps';
import { registerUiCommand } from './ui';

const UI_DIST = resolve(dirname(fileURLToPath(import.meta.url)), '../../ui/dist');
const tempDirs: string[] = [];

function makeReport(opts: {
  name: string;
  bundleId: string;
  cleanable: number;
  running?: boolean;
  path?: string;
}): AppReport {
  const path = opts.path ?? `/tmp/${opts.bundleId}/caches`;
  return {
    app: {
      bundleId: opts.bundleId,
      name: opts.name,
      version: '1.0',
      path: `/Applications/${opts.name}.app`,
      running: opts.running ?? false,
      bundleBytes: 0,
      system: false,
    },
    locations: [
      {
        kind: 'caches',
        tier: 0,
        actionable: true,
        path,
        bytesAllocated: opts.cleanable,
        source: 'generic',
      },
    ],
    totals: { cleanable: opts.cleanable, data: 0, all: opts.cleanable },
  };
}

function makeOrphanReport(opts: {
  bundleId: string;
  cachePath: string;
  dataPath: string;
  cleanable: number;
  data: number;
}): AppReport {
  return {
    orphaned: true,
    app: {
      bundleId: opts.bundleId,
      name: opts.bundleId,
      path: '',
      running: false,
      bundleBytes: 0,
      system: false,
    },
    locations: [
      {
        kind: 'caches',
        tier: 0,
        actionable: true,
        path: opts.cachePath,
        bytesAllocated: opts.cleanable,
        source: 'generic',
      },
      {
        kind: 'app-data',
        tier: 2,
        actionable: true,
        path: opts.dataPath,
        bytesAllocated: opts.data,
        source: 'generic',
      },
    ],
    totals: { cleanable: opts.cleanable, data: opts.data, all: opts.cleanable + opts.data },
  };
}

function harness(deps: Parameters<typeof registerAppsCommand>[2] = {}, isTTY = false) {
  const out: string[] = [];
  const err: string[] = [];
  const io: IO = { stdout: (s) => out.push(s), stderr: (s) => err.push(s), isTTY };
  const program = new Command();
  program.exitOverride();
  program.configureOutput({ writeOut: (s) => out.push(s), writeErr: (s) => err.push(s) });
  registerAppsCommand(program, io, deps);
  return { out, err, run: (argv: string[]) => program.parseAsync(['node', 'macsweep', ...argv]) };
}

function uiHarness(deps: {
  start: typeof import('@macsweep/server').startServer;
  open: (url: string) => Promise<void>;
}) {
  const out: string[] = [];
  const err: string[] = [];
  const io: IO = { stdout: (s) => out.push(s), stderr: (s) => err.push(s), isTTY: false };
  const program = new Command();
  program.exitOverride();
  program.configureOutput({ writeOut: (s) => out.push(s), writeErr: (s) => err.push(s) });
  registerUiCommand(program, io, deps);
  return { out, err, run: (argv: string[]) => program.parseAsync(['node', 'macsweep', ...argv]) };
}

// An applied clean opens a journal under the home dir, so point HOME at a temp dir
// for those tests instead of writing into the real one.
async function withTempHome<T>(fn: () => Promise<T>): Promise<T> {
  const previous = process.env.HOME;
  const home = await mkdtemp(join(tmpdir(), 'macsweep-cli-home-'));
  tempDirs.push(home);
  process.env.HOME = home;
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env.HOME;
    else process.env.HOME = previous;
  }
}

async function orphanDirs(): Promise<{ cachePath: string; dataPath: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'macsweep-orphans-clean-'));
  tempDirs.push(dir);
  const cachePath = join(dir, 'caches');
  const dataPath = join(dir, 'data');
  await mkdir(cachePath, { recursive: true });
  await mkdir(dataPath, { recursive: true });
  await writeFile(join(cachePath, 'cache.bin'), 'x');
  await writeFile(join(dataPath, 'messages.db'), 'x');
  return { cachePath, dataPath };
}

async function waitFor(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (check()) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 5));
  }
  throw new Error('timed out');
}

const reports = [
  makeReport({ name: 'Alpha', bundleId: 'com.example.alpha', cleanable: 500, running: true }),
  makeReport({ name: 'Beta', bundleId: 'com.example.beta', cleanable: 0 }),
];

afterAll(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    await rm(dir, { recursive: true, force: true });
  }
});

describe('apps command', () => {
  it('hides apps with nothing cleanable unless --all is given', async () => {
    const { out, run } = harness({ reports: async () => reports });
    await run(['apps']);
    const text = out.join('');
    expect(text).toContain('Alpha');
    expect(text).toContain('running');
    expect(text).not.toContain('Beta');
  });

  it('lists every app with --all', async () => {
    const { out, run } = harness({ reports: async () => reports });
    await run(['apps', '--all']);
    expect(out.join('')).toContain('Beta');
  });

  it('shows an app by name case-insensitively', async () => {
    const { out, run } = harness({ reports: async () => reports });
    await run(['apps', 'show', 'alpha']);
    const text = out.join('');
    expect(text).toContain('Alpha 1.0');
    expect(text).toContain('bundle id: com.example.alpha');
    expect(text).toContain('Caches');
    expect(text).toContain('cleanable');
  });

  it('exits 2 when a query matches several apps', async () => {
    const dupes = [
      makeReport({ name: 'Gamma', bundleId: 'com.example.gamma-one', cleanable: 10 }),
      makeReport({ name: 'Gamma', bundleId: 'com.example.gamma-two', cleanable: 20 }),
    ];
    const { out, run } = harness({ reports: async () => dupes });
    await expect(run(['apps', 'show', 'gamma'])).rejects.toMatchObject({ exitCode: 2 });
    expect(out.join('')).toContain('com.example.gamma-one');
  });

  it('exits 1 when no app matches', async () => {
    const { run } = harness({ reports: async () => reports });
    await expect(run(['apps', 'show', 'nope'])).rejects.toMatchObject({ exitCode: 1 });
  });

  it('runs a dry run without --apply', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'macsweep-apps-'));
    tempDirs.push(dir);
    await writeFile(join(dir, 'cache.bin'), 'x');

    const calls: Array<{ apply: boolean }> = [];
    const execute: typeof executePlan = async (plan, opts) => {
      calls.push({ apply: opts.apply });
      return { planId: plan.id, apply: opts.apply, results: [], freed: 0 };
    };
    const report = makeReport({
      name: 'Delta',
      bundleId: 'com.example.delta',
      cleanable: 1,
      path: dir,
    });

    const { out, run } = harness({ reports: async () => [report], execute });
    await run(['apps', 'clean', 'delta']);
    expect(calls).toEqual([{ apply: false }]);
    expect(out.join('')).toContain('Dry run: nothing was deleted.');
  });

  it('lists orphaned app data with --orphans', async () => {
    const orphan = makeOrphanReport({
      bundleId: 'com.old.chatapp',
      cachePath: '/tmp/nope/caches',
      dataPath: '/tmp/nope/data',
      cleanable: 12_000_000,
      data: 8_000_000,
    });
    const { out, run } = harness({ orphans: async () => [orphan] });
    await run(['apps', '--orphans']);
    const text = out.join('');
    expect(text).toContain('BUNDLE ID');
    expect(text).toContain('com.old.chatapp');
    expect(text).toContain(formatBytes(12_000_000));
    expect(text).toContain(formatBytes(8_000_000));
    expect(text).toContain(formatBytes(20_000_000));
  });

  it('skips orphan app data in a non-tty without a typed confirmation', async () => {
    const { cachePath, dataPath } = await orphanDirs();
    const plans: CleanupPlan[] = [];
    const confirmed: Array<string[] | undefined> = [];
    const execute: typeof executePlan = async (plan, opts) => {
      plans.push(plan);
      confirmed.push(opts.confirmedRuleIds);
      return { planId: plan.id, apply: opts.apply, results: [], freed: 0 };
    };
    const orphan = makeOrphanReport({
      bundleId: 'com.old.chatapp',
      cachePath,
      dataPath,
      cleanable: 4096,
      data: 4096,
    });

    await withTempHome(async () => {
      const { err, run } = harness({ orphans: async () => [orphan], execute });
      await run(['apps', 'clean', 'com.old.chatapp', '--orphaned', '--include-data', '--apply']);
      expect(err.join('')).toContain(
        'Skipping app data for com.old.chatapp: needs typed confirmation in an interactive terminal',
      );
    });

    expect(plans[0]?.items.map((i) => i.action)).toEqual(['remove-dir-contents', 'trash-path']);
    expect(confirmed[0]).toEqual([]);
  });

  it('confirms orphan app data when the bundle id is typed', async () => {
    const { cachePath, dataPath } = await orphanDirs();
    const confirmed: Array<string[] | undefined> = [];
    const execute: typeof executePlan = async (plan, opts) => {
      confirmed.push(opts.confirmedRuleIds);
      return { planId: plan.id, apply: opts.apply, results: [], freed: 0 };
    };
    const orphan = makeOrphanReport({
      bundleId: 'com.old.chatapp',
      cachePath,
      dataPath,
      cleanable: 4096,
      data: 4096,
    });

    await withTempHome(async () => {
      const original = promptImpl.ask;
      promptImpl.ask = async () => 'com.old.chatapp';
      try {
        const { run } = harness({ orphans: async () => [orphan], execute }, true);
        await run(['apps', 'clean', 'com.old.chatapp', '--orphaned', '--include-data', '--apply']);
      } finally {
        promptImpl.ask = original;
      }
    });

    expect(confirmed[0]).toEqual(['app.orphaned-data']);
  });

  it('does not confirm orphan app data when a different bundle id is typed', async () => {
    const { cachePath, dataPath } = await orphanDirs();
    const confirmed: Array<string[] | undefined> = [];
    const execute: typeof executePlan = async (plan, opts) => {
      confirmed.push(opts.confirmedRuleIds);
      return { planId: plan.id, apply: opts.apply, results: [], freed: 0 };
    };
    const orphan = makeOrphanReport({
      bundleId: 'com.old.chatapp',
      cachePath,
      dataPath,
      cleanable: 4096,
      data: 4096,
    });

    await withTempHome(async () => {
      const original = promptImpl.ask;
      promptImpl.ask = async () => 'com.other.app';
      try {
        const { run } = harness({ orphans: async () => [orphan], execute }, true);
        await run(['apps', 'clean', 'com.old.chatapp', '--orphaned', '--include-data', '--apply']);
      } finally {
        promptImpl.ask = original;
      }
    });

    expect(confirmed[0]).toEqual([]);
  });
});

describe('ui command', () => {
  beforeAll(async () => {
    await mkdir(UI_DIST, { recursive: true });
    await writeFile(join(UI_DIST, 'index.html'), '<html></html>');
  });

  afterAll(async () => {
    await rm(UI_DIST, { recursive: true, force: true });
  });

  it('starts the server, prints the url and opens the tokenized url', async () => {
    const opened: string[] = [];
    let serverOpts: StartServerOptions | undefined;
    const handle: ServerHandle = {
      url: 'http://127.0.0.1:4321/#t=secret',
      port: 4321,
      token: 'secret',
      close: async () => {},
      checkIdle: () => false,
    };
    const { out, run } = uiHarness({
      start: async (opts) => {
        serverOpts = opts;
        return handle;
      },
      open: async (url) => {
        opened.push(url);
      },
    });

    const running = run(['ui']);
    await waitFor(() => serverOpts !== undefined && opened.length === 1);
    expect(opened[0]).toContain('#t=');
    const text = out.join('');
    expect(text).toContain('http://127.0.0.1:4321/');
    expect(text).toContain('Press Ctrl-C to stop.');

    serverOpts!.onClose?.();
    await running;
  });

  it('prints the tokenized url instead of opening it with --no-open', async () => {
    const opened: string[] = [];
    let serverOpts: StartServerOptions | undefined;
    const handle: ServerHandle = {
      url: 'http://127.0.0.1:4321/#t=secret',
      port: 4321,
      token: 'secret',
      close: async () => {},
      checkIdle: () => false,
    };
    const { out, run } = uiHarness({
      start: async (opts) => {
        serverOpts = opts;
        return handle;
      },
      open: async (url) => {
        opened.push(url);
      },
    });

    const running = run(['ui', '--no-open']);
    await waitFor(() => serverOpts !== undefined);
    expect(opened).toEqual([]);
    expect(out.join('')).toContain('#t=secret');

    serverOpts!.onClose?.();
    await running;
  });

  it('rejects a port outside the allowed range', async () => {
    const { run } = uiHarness({
      start: async () => {
        throw new Error('server must not start');
      },
      open: async () => {},
    });
    await expect(run(['ui', '--port', '80'])).rejects.toMatchObject({ exitCode: 2 });
  });
});
