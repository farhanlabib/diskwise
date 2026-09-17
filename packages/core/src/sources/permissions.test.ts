import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProbeResult, ProbeRunner } from '../types';
import { detectHostApp } from './host-app';
import { checkFullDiskAccess } from './permissions';

afterEach(() => {
  vi.unstubAllEnvs();
});

function codedError(code: string): NodeJS.ErrnoException {
  const error = new Error(code) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

const HOME = '/Users/tester';

// Keeps the TERM_PROGRAM mapping deterministic by pretending no .app ancestor
// was found in the process tree.
const noHostApp = { detectHostApp: async () => undefined };

function psChain(table: Record<number, string>): ProbeRunner {
  return async (_bin, args): Promise<ProbeResult> => {
    const line = table[Number(args[args.length - 1])];
    if (line === undefined) return { stdout: '', stderr: 'no such process', exitCode: 1 };
    return { stdout: `${line}\n`, stderr: '', exitCode: 0 };
  };
}

describe('checkFullDiskAccess', () => {
  it('is granted when a protected directory reads', async () => {
    const readdir = vi.fn(async () => ['Bookmarks.plist']);
    await expect(checkFullDiskAccess(HOME, { readdir, ...noHostApp })).resolves.toMatchObject({
      fullDiskAccess: 'granted',
    });
  });

  it('is granted when only the second probe reads', async () => {
    const readdir = vi.fn(async (p: string) => {
      if (p.endsWith('/Mail')) return [];
      throw codedError('EPERM');
    });
    await expect(checkFullDiskAccess(HOME, { readdir, ...noHostApp })).resolves.toMatchObject({
      fullDiskAccess: 'granted',
    });
    expect(readdir).toHaveBeenCalledTimes(2);
  });

  it('is limited with a host-app hint when every existing directory is denied', async () => {
    vi.stubEnv('TERM_PROGRAM', 'iTerm.app');
    const readdir = vi.fn(async () => {
      throw codedError('EPERM');
    });

    const status = await checkFullDiskAccess(HOME, { readdir, ...noHostApp });

    expect(status.fullDiskAccess).toBe('limited');
    expect(status.hostApp).toBe('iTerm2');
    expect(status.hint).toBe(
      'Grant Full Disk Access to iTerm2 in System Settings → Privacy & Security → Full Disk Access, then quit and reopen iTerm2.',
    );
  });

  it('maps Apple_Terminal to Terminal', async () => {
    vi.stubEnv('TERM_PROGRAM', 'Apple_Terminal');
    const readdir = vi.fn(async () => {
      throw codedError('EACCES');
    });
    await expect(checkFullDiskAccess(HOME, { readdir, ...noHostApp })).resolves.toMatchObject({
      fullDiskAccess: 'limited',
      hostApp: 'Terminal',
    });
  });

  it('falls back to the raw TERM_PROGRAM value', async () => {
    vi.stubEnv('TERM_PROGRAM', 'SomeNewTerm');
    const readdir = vi.fn(async () => []);
    await expect(checkFullDiskAccess(HOME, { readdir, ...noHostApp })).resolves.toMatchObject({
      fullDiskAccess: 'granted',
      hostApp: 'SomeNewTerm',
    });
  });

  it('prefers the process-tree app over an empty TERM_PROGRAM', async () => {
    const readdir = vi.fn(async () => {
      throw codedError('EPERM');
    });
    const run = psChain({
      100: '50 /bin/zsh',
      50: '10 /usr/local/bin/claude',
      10: '1 /Applications/Droppy Code.app/Contents/MacOS/Droppy Code',
    });

    const status = await checkFullDiskAccess(HOME, {
      readdir,
      detectHostApp: () => detectHostApp({ run, pid: 100 }),
    });

    expect(status.hostApp).toBe('Droppy Code');
    expect(status.hint).toBe(
      'Grant Full Disk Access to Droppy Code in System Settings → Privacy & Security → Full Disk Access, then quit and reopen Droppy Code.',
    );
  });

  it('prefers the detected app over TERM_PROGRAM', async () => {
    vi.stubEnv('TERM_PROGRAM', 'iTerm.app');
    const readdir = vi.fn(async () => []);

    await expect(
      checkFullDiskAccess(HOME, {
        readdir,
        detectHostApp: async () => ({ name: 'Droppy Code', path: '/Applications/Droppy Code.app' }),
      }),
    ).resolves.toMatchObject({
      fullDiskAccess: 'granted',
      hostApp: 'Droppy Code',
    });
  });

  it('is unknown when no probe directory exists', async () => {
    const readdir = vi.fn(async () => {
      throw codedError('ENOENT');
    });

    const status = await checkFullDiskAccess(HOME, { readdir, ...noHostApp });

    expect(status.fullDiskAccess).toBe('unknown');
    expect(status.hint).toBeUndefined();
  });
});
