import { describe, expect, it } from 'vitest';
import { HARDENED_ENV, runProbe } from './run';

describe('runProbe', () => {
  it('exports the hardened environment', () => {
    expect(HARDENED_ENV).toEqual({
      HOMEBREW_NO_AUTO_UPDATE: '1',
      HOMEBREW_NO_ANALYTICS: '1',
      HOMEBREW_NO_ENV_HINTS: '1',
      NPM_CONFIG_UPDATE_NOTIFIER: 'false',
      LC_ALL: 'C',
    });
  });

  it('captures stdout with a zero exit code', async () => {
    const result = await runProbe('/bin/echo', ['hello']);
    expect(result).toEqual({ stdout: 'hello\n', stderr: '', exitCode: 0 });
  });

  it('resolves with 127 when the binary is missing', async () => {
    const result = await runProbe('/definitely/not/on/this/machine-xyz', []);
    expect(result.exitCode).toBe(127);
  });

  it('resolves with the real non-zero exit code', async () => {
    const result = await runProbe('/usr/bin/false', []);
    expect(result.exitCode).toBe(1);
  });

  it('resolves with 124 on timeout', async () => {
    const result = await runProbe('/bin/sleep', ['5'], { timeoutMs: 50 });
    expect(result.exitCode).toBe(124);
  });

  it('terminates the child and reports cancellation when the signal aborts mid-run', async () => {
    const controller = new AbortController();
    const pending = runProbe('/bin/sleep', ['5'], { signal: controller.signal });
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    controller.abort();

    const result = await pending;

    expect(result.cancelled).toBe(true);
    expect(result.exitCode).toBe(143);
  });

  it('resolves as cancelled without spawning when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await runProbe('/bin/echo', ['too-late'], { signal: controller.signal });

    expect(result).toEqual({ stdout: '', stderr: '', exitCode: 143, cancelled: true });
  });

  it('overrides inherited updater and analytics settings in the child env', async () => {
    const saved: Array<[string, string | undefined]> = [
      ['HOMEBREW_NO_AUTO_UPDATE', process.env.HOMEBREW_NO_AUTO_UPDATE],
      ['HOMEBREW_NO_ANALYTICS', process.env.HOMEBREW_NO_ANALYTICS],
      ['HOMEBREW_NO_ENV_HINTS', process.env.HOMEBREW_NO_ENV_HINTS],
      ['NPM_CONFIG_UPDATE_NOTIFIER', process.env.NPM_CONFIG_UPDATE_NOTIFIER],
    ];
    process.env.HOMEBREW_NO_AUTO_UPDATE = '0';
    process.env.HOMEBREW_NO_ANALYTICS = '0';
    process.env.HOMEBREW_NO_ENV_HINTS = '0';
    process.env.NPM_CONFIG_UPDATE_NOTIFIER = '1';

    try {
      const result = await runProbe('/usr/bin/env', []);
      const child = new Set(result.stdout.trim().split('\n'));
      expect(child).toContain('HOMEBREW_NO_AUTO_UPDATE=1');
      expect(child).toContain('HOMEBREW_NO_ANALYTICS=1');
      expect(child).toContain('HOMEBREW_NO_ENV_HINTS=1');
      expect(child).toContain('NPM_CONFIG_UPDATE_NOTIFIER=false');
    } finally {
      for (const [key, value] of saved) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it('still applies caller env additions on top of the hardened env', async () => {
    const result = await runProbe('/usr/bin/env', [], {
      env: { DISKWISE_PROBE_MARKER: 'present' },
    });
    expect(result.stdout.split('\n')).toContain('DISKWISE_PROBE_MARKER=present');
  });
});
