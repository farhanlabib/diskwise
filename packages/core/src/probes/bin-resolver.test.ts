import { afterEach, describe, expect, it } from 'vitest';
import { clearBinCache, resolveBin } from './bin-resolver';

afterEach(() => {
  clearBinCache();
});

const HOME = '/Users/tester';

function existsMock(shouldFind?: string): { calls: string[]; exists(p: string): Promise<boolean> } {
  const calls: string[] = [];
  return {
    calls,
    exists: async (p: string): Promise<boolean> => {
      calls.push(p);
      return p === shouldFind;
    },
  };
}

describe('resolveBin', () => {
  it('checks the known prefixes in order and stops at the first hit', async () => {
    const mock = existsMock('/usr/local/bin/tool');

    await expect(
      resolveBin('tool', { home: HOME, pathEnv: '', exists: mock.exists }),
    ).resolves.toBe('/usr/local/bin/tool');
    expect(mock.calls[0]).toBe('/opt/homebrew/bin/tool');
    expect(mock.calls[1]).toBe('/usr/local/bin/tool');
  });

  it('considers the home-relative install dirs', async () => {
    const mock = existsMock(`${HOME}/.cargo/bin/cargo`);
    await expect(
      resolveBin('cargo', { home: HOME, pathEnv: '', exists: mock.exists }),
    ).resolves.toBe(`${HOME}/.cargo/bin/cargo`);
  });

  it('searches the inherited PATH after the known prefixes', async () => {
    const mock = existsMock('/custom/bin/tool');
    await expect(
      resolveBin('tool', { home: HOME, pathEnv: '/custom/bin:/other', exists: mock.exists }),
    ).resolves.toBe('/custom/bin/tool');
  });

  it('does not check a PATH dir twice', async () => {
    const mock = existsMock();
    await resolveBin('tool', { home: HOME, pathEnv: '/usr/bin:/usr/local/bin', exists: mock.exists });

    expect(mock.calls.filter((p) => p === '/usr/bin/tool')).toHaveLength(1);
  });

  it('resolves shell metacharacters through a filesystem check only, no shell', async () => {
    const mock = existsMock();
    await expect(
      resolveBin('evil; rm -rf /', { home: HOME, pathEnv: '', exists: mock.exists }),
    ).resolves.toBeNull();
    expect(mock.calls.every((p) => p.endsWith('/evil; rm -rf /'))).toBe(true);
  });

  it('returns null when nothing resolves', async () => {
    const mock = existsMock();
    await expect(
      resolveBin('missing-tool', { home: HOME, pathEnv: '', exists: mock.exists }),
    ).resolves.toBeNull();
  });

  it('caches resolutions by name', async () => {
    const mock = existsMock('/opt/homebrew/bin/brew');

    await expect(resolveBin('brew', { home: HOME, pathEnv: '', exists: mock.exists })).resolves.toBe(
      '/opt/homebrew/bin/brew',
    );
    // The second lookup is a cache hit, so it probes nothing.
    await resolveBin('brew', { home: HOME, pathEnv: '', exists: mock.exists });

    expect(mock.calls).toHaveLength(1);
  });

  it('caches negative results too', async () => {
    const mock = existsMock();

    await expect(
      resolveBin('absent', { home: HOME, pathEnv: '', exists: mock.exists }),
    ).resolves.toBeNull();
    await expect(
      resolveBin('absent', { home: HOME, pathEnv: '', exists: mock.exists }),
    ).resolves.toBeNull();

    expect(mock.calls).toHaveLength(9);
  });
});
