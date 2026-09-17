import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { InstalledApp } from '../types';
import { findOrphanedAppData } from './orphans';

const homes: string[] = [];

async function makeHome(): Promise<string> {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'diskwise-orphans-')));
  homes.push(home);
  return home;
}

afterEach(async () => {
  while (homes.length > 0) {
    await rm(homes.pop()!, { recursive: true, force: true });
  }
});

async function dirWithFile(home: string, ...parts: string[]): Promise<string> {
  const dir = join(home, ...parts);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'blob'), Buffer.alloc(4096, 1));
  return dir;
}

function installed(...bundleIds: string[]): InstalledApp[] {
  return bundleIds.map((bundleId) => ({
    bundleId,
    name: bundleId,
    path: `/Applications/${bundleId}.app`,
    running: false,
    bundleBytes: 0,
    system: false,
  }));
}

describe('findOrphanedAppData', () => {
  it('reports an uninstalled bundle id with its caches, app data and settings', async () => {
    const home = await makeHome();
    await dirWithFile(home, 'Library/Caches/com.old.chatapp');
    await dirWithFile(home, 'Library/Application Support/com.old.chatapp');
    await mkdir(join(home, 'Library/Preferences'), { recursive: true });
    await writeFile(join(home, 'Library/Preferences/com.old.chatapp.plist'), 'x');

    const reports = await findOrphanedAppData({
      home,
      installed: [],
      fullDiskAccess: false,
      minBytes: 0,
    });

    expect(reports).toHaveLength(1);
    const report = reports[0]!;
    expect(report.orphaned).toBe(true);
    expect(report.app.bundleId).toBe('com.old.chatapp');
    expect(report.app.name).toBe('com.old.chatapp');
    expect(report.app.path).toBe('');
    expect(report.locations.map((l) => l.kind).sort()).toEqual(['app-data', 'caches', 'settings']);
    expect(report.locations.find((l) => l.kind === 'caches')?.actionable).toBe(true);
    expect(report.locations.find((l) => l.kind === 'app-data')?.actionable).toBe(true);
    expect(report.locations.find((l) => l.kind === 'settings')?.actionable).toBe(false);
  });

  it('does not report a helper bundle id when the parent app is installed', async () => {
    const home = await makeHome();
    await dirWithFile(home, 'Library/Caches/com.foo.app');
    await dirWithFile(home, 'Library/Caches/com.foo.app.helper');

    const reports = await findOrphanedAppData({
      home,
      installed: installed('com.foo.app'),
      fullDiskAccess: false,
      minBytes: 0,
    });

    expect(reports).toEqual([]);
  });

  it('ignores com.apple.* bundle ids', async () => {
    const home = await makeHome();
    await dirWithFile(home, 'Library/Caches/com.apple.something');

    const reports = await findOrphanedAppData({
      home,
      installed: [],
      fullDiskAccess: false,
      minBytes: 0,
    });

    expect(reports).toEqual([]);
  });

  it('ignores children that are not bundle-id shaped', async () => {
    const home = await makeHome();
    await dirWithFile(home, 'Library/Caches/Adobe');
    await dirWithFile(home, 'Library/Application Support/Adobe');

    const reports = await findOrphanedAppData({
      home,
      installed: [],
      fullDiskAccess: false,
      minBytes: 0,
    });

    expect(reports).toEqual([]);
  });

  it('only includes Containers when Full Disk Access is granted', async () => {
    const home = await makeHome();
    await dirWithFile(home, 'Library/Containers/com.old.chatapp');

    const without = await findOrphanedAppData({
      home,
      installed: [],
      fullDiskAccess: false,
      minBytes: 0,
    });
    expect(without).toEqual([]);

    const withAccess = await findOrphanedAppData({
      home,
      installed: [],
      fullDiskAccess: true,
      minBytes: 0,
    });
    expect(withAccess.map((r) => r.app.bundleId)).toEqual(['com.old.chatapp']);
    expect(withAccess[0]?.locations.map((l) => l.kind)).toEqual(['app-data']);
  });

  it('drops reports below minBytes', async () => {
    const home = await makeHome();
    await dirWithFile(home, 'Library/Caches/com.small.app');

    const filtered = await findOrphanedAppData({
      home,
      installed: [],
      fullDiskAccess: false,
      minBytes: 10e6,
    });
    expect(filtered).toEqual([]);

    const kept = await findOrphanedAppData({
      home,
      installed: [],
      fullDiskAccess: false,
      minBytes: 1,
    });
    expect(kept.map((r) => r.app.bundleId)).toEqual(['com.small.app']);
  });

  it('ignores symlinked children', async () => {
    const home = await makeHome();
    const target = await dirWithFile(home, 'real/com.old.chatapp');
    await mkdir(join(home, 'Library/Caches'), { recursive: true });
    await symlink(target, join(home, 'Library/Caches/com.old.chatapp'));

    const reports = await findOrphanedAppData({
      home,
      installed: [],
      fullDiskAccess: false,
      minBytes: 0,
    });

    expect(reports).toEqual([]);
  });
});

describe('orphan name filtering', () => {
  it('ignores rotated log files that look like bundle ids', async () => {
    const { mkdtemp, mkdir, writeFile, realpath } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const home = await realpath(await mkdtemp(join(tmpdir(), 'diskwise-orphan-names-')));
    for (const name of ['warp.log.old.1', 'com.old.editor']) {
      await mkdir(join(home, 'Library/Caches', name), { recursive: true });
      await writeFile(join(home, 'Library/Caches', name, 'blob'), Buffer.alloc(200_000, 1));
    }
    const reports = await findOrphanedAppData({ home, installed: [], fullDiskAccess: false, minBytes: 1 });
    expect(reports.map((r) => r.app.bundleId)).toEqual(['com.old.editor']);
  });
});
