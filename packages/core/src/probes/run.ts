import { execFile } from 'node:child_process';
import type { ProbeRunner } from '../types';

// Env stamped onto every probe so package managers never phone home or
// auto-update mid-audit, and locale-dependent output stays stable.
export const HARDENED_ENV: Record<string, string> = {
  HOMEBREW_NO_AUTO_UPDATE: '1',
  HOMEBREW_NO_ANALYTICS: '1',
  HOMEBREW_NO_ENV_HINTS: '1',
  NPM_CONFIG_UPDATE_NOTIFIER: 'false',
  LC_ALL: 'C',
};

interface ExecFileError extends NodeJS.ErrnoException {
  killed?: boolean;
  signal?: NodeJS.Signals | null;
}

export const runProbe: ProbeRunner = (bin, args, opts) =>
  new Promise((resolve) => {
    execFile(
      bin,
      args,
      {
        timeout: opts?.timeoutMs ?? 30000,
        maxBuffer: 64 * 1024 * 1024,
        env: { ...process.env, ...HARDENED_ENV, ...opts?.env },
      },
      (err, stdout, stderr) => {
        let exitCode = 0;
        if (err) {
          const e = err as ExecFileError;
          if (e.code === 'ENOENT') exitCode = 127;
          else if (e.killed) exitCode = 124;
          else if (typeof e.code === 'number') exitCode = e.code;
          else exitCode = 1;
        }
        resolve({ stdout: String(stdout), stderr: String(stderr), exitCode });
      },
    );
  });
