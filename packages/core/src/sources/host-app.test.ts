import { describe, expect, it, vi } from 'vitest';
import type { ProbeResult } from '../types';
import { detectHostApp, hostAppFromTermProgram } from './host-app';

function processResult(line: string): ProbeResult {
  return { stdout: `${line}\n`, stderr: '', exitCode: 0 };
}

// Maps a pid to the line `ps -o ppid=,comm= -p <pid>` would print for it.
function fakePs(table: Record<number, string>) {
  const calls: Array<{ pid: number }> = [];
  const run = vi.fn(async (_bin: string, args: string[]) => {
    const pid = Number(args[args.length - 1]);
    calls.push({ pid });
    const line = table[pid];
    if (line === undefined) return { stdout: '', stderr: 'no such process', exitCode: 1 };
    return processResult(line);
  });
  return { run, calls };
}

describe('hostAppFromTermProgram', () => {
  it('maps known terminals and passes through unknown ones', () => {
    expect(hostAppFromTermProgram('iTerm.app')).toBe('iTerm2');
    expect(hostAppFromTermProgram('Apple_Terminal')).toBe('Terminal');
    expect(hostAppFromTermProgram('SomeNewTerm')).toBe('SomeNewTerm');
    expect(hostAppFromTermProgram(undefined)).toBeUndefined();
    expect(hostAppFromTermProgram('')).toBeUndefined();
  });
});

describe('detectHostApp', () => {
  it('walks zsh -> claude -> Droppy Code and returns the app', async () => {
    const { run, calls } = fakePs({
      100: '50 /bin/zsh',
      50: '10 /usr/local/bin/claude',
      10: '1 /Applications/Droppy Code.app/Contents/MacOS/Droppy Code',
    });

    await expect(detectHostApp({ run, pid: 100 })).resolves.toEqual({
      name: 'Droppy Code',
      path: '/Applications/Droppy Code.app',
    });
    expect(calls.map((c) => c.pid)).toEqual([100, 50, 10]);
    expect(run).toHaveBeenCalledWith('ps', ['-o', 'ppid=,comm=', '-p', '100']);
  });

  it('finds Terminal when its parent is launchd', async () => {
    const { run } = fakePs({
      7: '1 /System/Applications/Utilities/Terminal.app/Contents/MacOS/Terminal',
    });

    await expect(detectHostApp({ run, pid: 7 })).resolves.toEqual({
      name: 'Terminal',
      path: '/System/Applications/Utilities/Terminal.app',
    });
  });

  it('is undefined when no ancestor is an app bundle', async () => {
    const { run } = fakePs({
      100: '50 /bin/zsh',
      50: '1 /usr/bin/login',
    });

    await expect(detectHostApp({ run, pid: 100 })).resolves.toBeUndefined();
  });

  it('stops at ppid 1 without an app', async () => {
    const { run, calls } = fakePs({
      100: '1 /bin/zsh',
    });

    await expect(detectHostApp({ run, pid: 100 })).resolves.toBeUndefined();
    expect(calls).toEqual([{ pid: 100 }]);
  });

  it('stops after maxDepth ps calls', async () => {
    // Every process points at the next pid, so only maxDepth bounds the walk.
    const table: Record<number, string> = {};
    for (let pid = 100; pid > 80; pid -= 1) table[pid] = `${pid - 1} /bin/zsh`;
    const { run, calls } = fakePs(table);

    await expect(detectHostApp({ run, pid: 100, maxDepth: 3 })).resolves.toBeUndefined();
    expect(calls).toHaveLength(3);
  });

  it('gives up when ps fails', async () => {
    const run = vi.fn(async () => ({ stdout: '', stderr: 'gone', exitCode: 1 }));
    await expect(detectHostApp({ run, pid: 999 })).resolves.toBeUndefined();
    expect(run).toHaveBeenCalledTimes(1);
  });
});
