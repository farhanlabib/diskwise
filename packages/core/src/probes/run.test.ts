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
});
