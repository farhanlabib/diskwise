import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProbeResult } from '../types';
import { clearBinCache, resolveBin } from './bin-resolver';

afterEach(() => {
  clearBinCache();
});

const HOME = '/Users/tester';

function ok(stdout: string): ProbeResult {
  return { stdout, stderr: '', exitCode: 0 };
}

describe('resolveBin', () => {
  it('checks the known prefixes in order and stops at the first hit', async () => {
    const seen: string[] = [];
    const exists = async (p: string): Promise<boolean> => {
      seen.push(p);
      return p === '/usr/local/bin/tool';
    };

    await expect(resolveBin('tool', { home: HOME, exists })).resolves.toBe('/usr/local/bin/tool');
    expect(seen[0]).toBe('/opt/homebrew/bin/tool');
    expect(seen[1]).toBe('/usr/local/bin/tool');
  });

  it('considers the home-relative install dirs', async () => {
    const exists = async (p: string): Promise<boolean> => p === `${HOME}/.cargo/bin/cargo`;
    await expect(resolveBin('cargo', { home: HOME, exists })).resolves.toBe(`${HOME}/.cargo/bin/cargo`);
  });

  it('falls back to a login shell and takes the first absolute stdout line', async () => {
    const exists = async (): Promise<boolean> => false;
    const run = vi.fn(async () => ok('brew: not found\n/opt/homebrew/bin/brew\n'));

    await expect(resolveBin('brew', { home: HOME, exists, run })).resolves.toBe('/opt/homebrew/bin/brew');
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(expect.any(String), ['-ilc', 'command -v brew']);
  });

  it('refuses to shell out for a name with unsafe characters', async () => {
    const exists = async (): Promise<boolean> => false;
    const run = vi.fn(async () => ok('/bin/evil\n'));

    await expect(resolveBin('evil; rm -rf /', { home: HOME, exists, run })).resolves.toBeNull();
    expect(run).not.toHaveBeenCalled();
  });

  it('returns null when nothing resolves', async () => {
    const exists = async (): Promise<boolean> => false;
    const run = vi.fn(async () => ({ stdout: '', stderr: 'not found', exitCode: 1 }));

    await expect(resolveBin('missing-tool', { home: HOME, exists, run })).resolves.toBeNull();
  });

  it('ignores a shell result that is not an absolute path', async () => {
    const exists = async (): Promise<boolean> => false;
    const run = vi.fn(async () => ok('aliased to nothing useful\nrelative/tool\n'));

    await expect(resolveBin('tool', { home: HOME, exists, run })).resolves.toBeNull();
  });

  it('caches resolutions by name', async () => {
    const exists = vi.fn(async (): Promise<boolean> => false);
    const run = vi.fn(async () => ok('/opt/homebrew/bin/brew\n'));

    await resolveBin('brew', { home: HOME, exists, run });
    await resolveBin('brew', { home: HOME, exists, run });

    expect(run).toHaveBeenCalledTimes(1);
    expect(exists).toHaveBeenCalledTimes(9);
  });

  it('caches negative results too', async () => {
    const exists = vi.fn(async (): Promise<boolean> => false);
    const run = vi.fn(async () => ok(''));

    await expect(resolveBin('absent', { home: HOME, exists, run })).resolves.toBeNull();
    await expect(resolveBin('absent', { home: HOME, exists, run })).resolves.toBeNull();

    expect(run).toHaveBeenCalledTimes(1);
  });
});
