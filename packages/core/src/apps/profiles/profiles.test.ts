import { describe, expect, it } from 'vitest';
import type { AppProfile } from '../../types';
import { appProfiles, profileForBundleId } from './index';
import { lintProfile, lintProfiles } from './lint';

function profile(overrides: Partial<AppProfile> = {}): AppProfile {
  return {
    schemaVersion: 1,
    id: 'test',
    name: 'Test App',
    bundleIds: ['com.test.app'],
    caches: [],
    rationale: 'A rationale long enough for the profile type to accept it.',
    regeneration: 'A regeneration note long enough for the type.',
    ...overrides,
  };
}

describe('appProfiles', () => {
  it('ships nineteen profiles that all lint clean', () => {
    expect(appProfiles).toHaveLength(19);
    expect(lintProfiles(appProfiles)).toEqual([]);
  });

  it('gives every profile a unique id and unique bundle ids', () => {
    const ids = appProfiles.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    const bundleIds = appProfiles.flatMap((p) => p.bundleIds);
    expect(new Set(bundleIds).size).toBe(bundleIds.length);
  });

  it('finds a profile by bundle id and nothing for unknown ids', () => {
    expect(profileForBundleId('com.spotify.client')?.id).toBe('spotify');
    expect(profileForBundleId('com.google.Chrome')?.id).toBe('chrome');
    expect(profileForBundleId('com.example.unknown')).toBeUndefined();
  });
});

describe('lintProfile', () => {
  it('accepts a known cache directory strictly below a protected path', () => {
    const messages = lintProfile(
      profile({
        caches: [
          {
            path: '~/Library/Application Support/Google/Chrome/Default/Code Cache',
            tier: 0,
          },
        ],
        protect: ['~/Library/Application Support/Google/Chrome/Default'],
      }),
    );
    expect(messages).toEqual([]);
  });

  it('rejects a cache that names user data', () => {
    const messages = lintProfile(
      profile({ caches: [{ path: '~/Library/Caches/com.test.app/Cookies', tier: 0 }] }),
    );
    expect(messages.length).toBeGreaterThan(0);
  });

  it('rejects a path containing a traversal', () => {
    const messages = lintProfile(
      profile({ caches: [{ path: '~/Library/Caches/../com.test.app', tier: 0 }] }),
    );
    expect(messages.length).toBeGreaterThan(0);
  });

  it('rejects a cache equal to a protect entry', () => {
    const messages = lintProfile(
      profile({
        caches: [{ path: '~/Library/Application Support/SomeApp/Profile', tier: 0 }],
        protect: ['~/Library/Application Support/SomeApp/Profile'],
      }),
    );
    expect(messages.length).toBeGreaterThan(0);
  });

  it('rejects a cache outside the Library', () => {
    const messages = lintProfile(
      profile({ caches: [{ path: '~/Documents/com.test.app', tier: 0 }] }),
    );
    expect(messages.length).toBeGreaterThan(0);
  });

  it('rejects duplicate bundle ids across profiles', () => {
    const a = profile({ id: 'a', bundleIds: ['com.test.dup'] });
    const b = profile({ id: 'b', bundleIds: ['com.test.dup'] });
    expect(lintProfiles([a, b]).length).toBeGreaterThan(0);
  });
});
