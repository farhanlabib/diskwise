import { execFile } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
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

// 128 + SIGTERM(15): the conventional exit status of a signal-terminated child,
// so a cancellation stays distinguishable from a timeout (124) or a failure.
const CANCELLED_EXIT_CODE = 143;
// A child that ignores SIGTERM is escalated to SIGKILL after this grace period.
const KILL_GRACE_MS = 2000;

export const runProbe: ProbeRunner = (bin, args, opts) =>
  new Promise((resolve) => {
    const signal = opts?.signal;
    if (signal?.aborted) {
      resolve({ stdout: '', stderr: '', exitCode: CANCELLED_EXIT_CODE, cancelled: true });
      return;
    }

    let settled = false;
    let abortedKill = false;
    let killTimer: NodeJS.Timeout | undefined;

    const terminate = (child: ChildProcess): void => {
      abortedKill = true;
      child.kill('SIGTERM');
      // The promise settles when the child exits; the SIGKILL backstop bounds
      // the wait for a child that ignores SIGTERM.
      killTimer = setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS);
      killTimer.unref();
    };

    const child = execFile(
      bin,
      args,
      {
        timeout: opts?.timeoutMs ?? 30000,
        maxBuffer: 64 * 1024 * 1024,
        env: { ...process.env, ...HARDENED_ENV, ...opts?.env },
      },
      (err, stdout, stderr) => {
        signal?.removeEventListener('abort', abortListener);
        if (killTimer !== undefined) clearTimeout(killTimer);
        if (settled) return;
        settled = true;
        // `signal.aborted` is the backstop: execFile's own abort handling can
        // invoke this callback before abortListener runs.
        if (abortedKill || signal?.aborted) {
          resolve({
            stdout: String(stdout),
            stderr: String(stderr),
            exitCode: CANCELLED_EXIT_CODE,
            cancelled: true,
          });
          return;
        }
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

    function abortListener(): void {
      terminate(child);
    }

    signal?.addEventListener('abort', abortListener, { once: true });
  });
