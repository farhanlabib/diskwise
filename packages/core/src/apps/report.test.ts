import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { InstalledApp } from '../types';
import { buildAppReports } from './report';

const KB = 1024;
const MB = 1024 * KB;
const TOLERANCE = 128 * KB;

const roots: string[] = [];

async function makeHome(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'macsweep-apps-report-'));
  roots.push(dir);
  return dir;
}

async function writeSizedFile(path: string, bytes: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, Buffer.alloc(bytes, 7));
}

async function seedChat(home: string): Promise<void> {
  await writeSizedFile(join(home, 'Library/Caches/com.test.chat/f.bin'), MB);
  await writeSizedFile(join(home, 'Library/Application Support/Chat/Cache/f.bin'), MB);
  await writeSizedFile(join(home, 'Library/Application Support/Chat/Local Storage/f.bin'), MB);
  await writeSizedFile(join(home, 'Library/HTTPStorages/com.test.chat/f.bin'), KB);
  await writeSizedFile(join(home, 'Library/Logs/Chat/f.log'), KB);
  await writeSizedFile(join(home, 'Library/Preferences/com.test.chat.plist'), KB);
}

function asApp(bundleId: string, name: string): InstalledApp {
  return {
    bundleId,
    name,
    path: `/Applications/${name}.app`,
    running: false,
    bundleBytes: 0,
    system: false,
  };
}

afterAll(async () => {
  await Promise.all(roots.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('buildAppReports', () => {
  it('measures caches before app-data and avoids double counting', async () => {
    const home = await makeHome();
    await seedChat(home);

    const reports = await buildAppReports({
      home,
      fullDiskAccess: false,
      apps: [asApp('com.test.chat', 'Chat')],
    });

    expect(reports).toHaveLength(1);
    const [report] = reports;
    expect(report).toBeDefined();

    const cacheBytes = report!.locations
      .filter((l) => l.kind === 'caches')
      .reduce((sum, l) => sum + l.bytesAllocated, 0);
    expect(Math.abs(cacheBytes - 2 * MB)).toBeLessThan(TOLERANCE);

    const appData = report!.locations.find((l) => l.kind === 'app-data');
    expect(appData).toBeDefined();
    // Only `Local Storage` remains: `Cache` was already counted as a cache.
    expect(Math.abs(appData!.bytesAllocated - MB)).toBeLessThan(TOLERANCE);

    expect(report!.totals.all).toBe(report!.totals.cleanable + report!.totals.data);
    expect(report!.totals.cleanable).toBeGreaterThanOrEqual(cacheBytes);
  });

  it('sorts reports by cleanable bytes descending', async () => {
    const home = await makeHome();
    await seedChat(home);
    await writeSizedFile(join(home, 'Library/Caches/com.test.big/f.bin'), 3 * MB);

    const reports = await buildAppReports({
      home,
      fullDiskAccess: false,
      apps: [asApp('com.test.chat', 'Chat'), asApp('com.test.big', 'Big')],
    });

    expect(reports).toHaveLength(2);
    expect(reports[0]!.app.bundleId).toBe('com.test.big');
    expect(reports[1]!.app.bundleId).toBe('com.test.chat');
    expect(reports[0]!.totals.cleanable).toBeGreaterThan(reports[1]!.totals.cleanable);
  });

  it('sets profileId and does not double count an overlapping profile cache', async () => {
    const home = await makeHome();
    const cacheRoot = join(home, 'Library/Caches/com.spotify.client');
    await writeSizedFile(join(cacheRoot, 'Data/offline.bin'), 2 * MB);

    const reports = await buildAppReports({
      home,
      fullDiskAccess: false,
      apps: [asApp('com.spotify.client', 'Spotify')],
    });

    expect(reports).toHaveLength(1);
    const [report] = reports;
    expect(report!.profileId).toBe('spotify');

    // The generic cache is measured first, so the profile's nested cache adds
    // no bytes and is dropped rather than counted twice.
    const caches = report!.locations.filter((l) => l.kind === 'caches');
    expect(caches.map((l) => l.path)).toEqual([cacheRoot]);
    expect(Math.abs(caches[0]!.bytesAllocated - 2 * MB)).toBeLessThan(TOLERANCE);
    expect(Math.abs(report!.totals.all - 2 * MB)).toBeLessThan(TOLERANCE);
  });

  it('skips apps with no locations and stops on an aborted signal', async () => {
    const home = await makeHome();
    await seedChat(home);

    const empty = await buildAppReports({
      home,
      fullDiskAccess: false,
      apps: [asApp('com.test.nothing', 'Nothing')],
    });
    expect(empty).toEqual([]);

    const controller = new AbortController();
    controller.abort();
    const aborted = await buildAppReports({
      home,
      fullDiskAccess: false,
      apps: [asApp('com.test.chat', 'Chat')],
      signal: controller.signal,
    });
    expect(aborted).toEqual([]);
  });
});
