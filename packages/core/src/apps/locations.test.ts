import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { AppLocationKind } from '../types';
import { resolveAppLocations } from './locations';

// A test-only profile lets us exercise the protect path: none of the shipped
// profiles protects a folder that the generic heuristics also propose.
vi.mock('./profiles', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./profiles')>();
  const protectedProfile = {
    schemaVersion: 1 as const,
    id: 'protected-test',
    name: 'Protected Test',
    bundleIds: ['com.test.protected'],
    caches: [],
    protect: ['~/Library/Caches/com.test.protected'],
    rationale: 'Test-only profile that protects its own cache directory.',
    regeneration: 'Nothing to restore in a test.',
  };
  return {
    ...actual,
    profileForBundleId: (bundleId: string) =>
      bundleId === 'com.test.protected' ? protectedProfile : actual.profileForBundleId(bundleId),
  };
});

const KB = 1024;
const MB = 1024 * KB;

const roots: string[] = [];

async function makeHome(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'diskwise-apps-locations-'));
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
  await writeSizedFile(
    join(home, 'Library/Containers/com.test.chat/Data/Library/Caches/f.bin'),
    MB,
  );
  await writeSizedFile(join(home, 'Library/Preferences/com.test.chat.plist'), KB);
}

afterAll(async () => {
  await Promise.all(roots.map((dir) => rm(dir, { recursive: true, force: true })));
});

const chat = { bundleId: 'com.test.chat', name: 'Chat' };

describe('resolveAppLocations', () => {
  it('reports kinds, tiers and actionable flags in order', async () => {
    const home = await makeHome();
    await seedChat(home);

    const locations = await resolveAppLocations(chat, { home, fullDiskAccess: false });

    const kinds = locations.map((l) => l.kind);
    expect(kinds).toEqual(['caches', 'caches', 'logs', 'sign-in-data', 'app-data', 'settings']);

    const byKind = new Map<AppLocationKind, { tier: number; actionable: boolean }>();
    for (const location of locations) byKind.set(location.kind, location);

    expect(byKind.get('caches')).toMatchObject({ tier: 0, actionable: true });
    expect(byKind.get('logs')).toMatchObject({ tier: 1, actionable: true });
    expect(byKind.get('sign-in-data')).toMatchObject({ tier: 2, actionable: false });
    expect(byKind.get('app-data')).toMatchObject({ tier: 2, actionable: false });
    expect(byKind.get('settings')).toMatchObject({ tier: 3, actionable: false });

    for (const location of locations) {
      const cleanableKinds: AppLocationKind[] = ['caches', 'logs', 'saved-state'];
      expect(location.actionable).toBe(cleanableKinds.includes(location.kind));
      expect(location.source).toBe('generic');
    }

    const caches = locations.filter((l) => l.kind === 'caches').map((l) => l.path);
    expect(caches).toEqual([
      join(home, 'Library/Caches/com.test.chat'),
      join(home, 'Library/Application Support/Chat/Cache'),
    ]);

    // `Local Storage` is not a Chromium cache dir and must not be a cache location.
    expect(locations.some((l) => l.path.endsWith('Local Storage'))).toBe(false);
  });

  it('excludes Containers without Full Disk Access and includes them with it', async () => {
    const home = await makeHome();
    await seedChat(home);

    const limited = await resolveAppLocations(chat, { home, fullDiskAccess: false });
    expect(limited.some((l) => l.path.includes('/Library/Containers/'))).toBe(false);

    const full = await resolveAppLocations(chat, { home, fullDiskAccess: true });
    const containerCache = join(home, 'Library/Containers/com.test.chat/Data/Library/Caches');
    const containerRoot = join(home, 'Library/Containers/com.test.chat');

    expect(full).toContainEqual(
      expect.objectContaining({ kind: 'caches', tier: 0, actionable: true, path: containerCache }),
    );
    expect(full).toContainEqual(
      expect.objectContaining({ kind: 'app-data', tier: 2, actionable: false, path: containerRoot }),
    );

    // cache path comes before app-data, which is what keeps the shared `seen`
    // set from double-counting the container cache.
    const cacheIndex = full.findIndex((l) => l.path === containerCache);
    const rootIndex = full.findIndex((l) => l.path === containerRoot);
    expect(cacheIndex).toBeGreaterThanOrEqual(0);
    expect(rootIndex).toBeGreaterThan(cacheIndex);
  });

  it('returns [] when the bundleId contains a slash', async () => {
    const home = await makeHome();
    await seedChat(home);

    const locations = await resolveAppLocations(
      { bundleId: 'com/test/chat', name: 'Chat' },
      { home, fullDiskAccess: true },
    );

    expect(locations).toEqual([]);
  });

  it('returns [] when the name is a traversal or the parent directory', async () => {
    const home = await makeHome();
    await seedChat(home);

    for (const name of ['..', '.', '../Chat', '']) {
      const locations = await resolveAppLocations(
        { bundleId: 'com.test.chat', name },
        { home, fullDiskAccess: true },
      );
      expect(locations).toEqual([]);
    }
  });

  it('ignores a symlinked cache directory', async () => {
    const home = await makeHome();
    const real = join(home, 'real-cache');
    await mkdir(real, { recursive: true });
    const linkPath = join(home, 'Library/Caches/com.test.symlink');
    await mkdir(dirname(linkPath), { recursive: true });
    await symlink(real, linkPath);

    const locations = await resolveAppLocations(
      { bundleId: 'com.test.symlink', name: 'Sym' },
      { home, fullDiskAccess: false },
    );

    expect(locations).toEqual([]);
  });
});

describe('resolveAppLocations with app profiles', () => {
  it('adds a profile cache next to the generic one it overlaps', async () => {
    const home = await makeHome();
    const cacheRoot = join(home, 'Library/Caches/com.spotify.client');
    await writeSizedFile(join(cacheRoot, 'Data/offline.bin'), MB);

    const locations = await resolveAppLocations(
      { bundleId: 'com.spotify.client', name: 'Spotify' },
      { home, fullDiskAccess: false },
    );

    const profileCache = locations.find((l) => l.source === 'profile');
    expect(profileCache).toMatchObject({
      kind: 'caches',
      tier: 1,
      actionable: true,
      path: join(cacheRoot, 'Data'),
    });
    expect(profileCache?.note).toContain('Offline');

    expect(locations).toContainEqual(
      expect.objectContaining({ kind: 'caches', source: 'generic', path: cacheRoot }),
    );

    const caches = locations.filter((l) => l.kind === 'caches').map((l) => l.path);
    expect(caches).toEqual([cacheRoot, join(cacheRoot, 'Data')]);
  });

  it('marks a generic cache inside a protected path as non-actionable', async () => {
    const home = await makeHome();
    const cacheRoot = join(home, 'Library/Caches/com.test.protected');
    await writeSizedFile(join(cacheRoot, 'f.bin'), MB);

    const locations = await resolveAppLocations(
      { bundleId: 'com.test.protected', name: 'Protected Test' },
      { home, fullDiskAccess: false },
    );

    expect(locations).toContainEqual(
      expect.objectContaining({
        kind: 'caches',
        path: cacheRoot,
        actionable: false,
        source: 'generic',
      }),
    );
  });
});
