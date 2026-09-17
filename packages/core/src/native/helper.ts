import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { UnreadableEntry } from '../types';

export interface TrashResult {
  ok: true;
  path: string;
  trashedPath: string;
}

export interface RunningApp {
  bundleId: string;
  name: string;
  pid: number;
  bundlePath: string;
}

export interface RunningAppsResult {
  ok: true;
  apps: RunningApp[];
}

export interface QuitResult {
  ok: boolean;
  quit: boolean;
  stillRunning: number;
}

export interface PrivateSizeItem {
  path: string;
  allocated: number;
  privateSize?: number;
  note?: string;
}

export interface PrivateSizeResult {
  ok: true;
  items: PrivateSizeItem[];
  privateSizeSupported: boolean;
}

export interface VolumeCapacityResult {
  ok: true;
  path: string;
  total: number;
  available: number;
  importantUsage: number;
  opportunisticUsage: number;
  purgeableEstimate: number;
}

export interface TreeSizeResult {
  path: string;
  allocated: number;
  privateSize: number;
  entries: number;
  unreadable: UnreadableEntry[];
  truncated: boolean;
  privateSizeSupported: boolean;
}

export interface TreeSizeOptions {
  skip?: string[];
  maxEntries?: number;
  timeoutMs?: number;
}

const HELPER_MISSING = 'HELPER_MISSING';

export const DEFAULT_TREE_TIMEOUT_MS = 120_000;

// These folders are always skipped: listing a File Provider folder (iCloud, Google
// Drive, Dropbox) can block for minutes or trigger downloads, and they share the boot
// volume's device so the native walk would otherwise descend into them.
function cloudSkips(): string[] {
  return [
    '/Library/CloudStorage',
    path.join(homedir(), 'Library/CloudStorage'),
    path.join(homedir(), 'Library/Mobile Documents'),
  ];
}

const RELATIVE_HELPER = '../../../native-helper/bin/diskwise-helper';

async function isExecutable(candidate: string): Promise<boolean> {
  if (!candidate) return false;
  try {
    await access(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export async function findHelper(): Promise<string | null> {
  const candidates: string[] = [];

  const fromEnv = process.env.DISKWISE_HELPER;
  if (fromEnv) candidates.push(fromEnv);

  const here = path.dirname(fileURLToPath(import.meta.url));
  // Published builds ship the helper next to the bundled entry point.
  candidates.push(path.join(here, 'diskwise-helper'));
  candidates.push(path.resolve(here, RELATIVE_HELPER));

  const entryPoint = process.argv[1];
  if (entryPoint) {
    candidates.push(path.join(path.dirname(entryPoint), 'diskwise-helper'));
    // A global install runs through node_modules/.bin/diskwise, which is a symlink,
    // so resolve it before looking for a sibling helper.
    try {
      const resolved = await realpath(entryPoint);
      candidates.push(path.join(path.dirname(resolved), 'diskwise-helper'));
    } catch {
      // entry point vanished; the other candidates still apply
    }
  }

  for (const candidate of candidates) {
    if (await isExecutable(candidate)) return candidate;
  }
  return null;
}

async function run<T extends { ok: boolean; error?: string }>(
  args: string[],
  opts: { timeoutMs?: number } = {},
): Promise<T> {
  const helper = await findHelper();
  if (!helper) throw new Error(HELPER_MISSING);

  // execFile, never a shell: arguments are passed verbatim, so paths with
  // spaces or shell metacharacters cannot be reinterpreted.
  const stdout = await new Promise<string>((resolve, reject) => {
    const execOpts = {
      encoding: 'utf8' as const,
      maxBuffer: 32 * 1024 * 1024,
      ...(opts.timeoutMs !== undefined ? { timeout: opts.timeoutMs } : {}),
    };
    execFile(helper, args, execOpts, (error, out, stderr) => {
      // The helper reports failures as JSON on stdout with exit code 1, so prefer
      // stdout whenever there is any; stderr is only for spawn-level errors.
      if (out && out.trim().length > 0) {
        resolve(out);
        return;
      }
      reject(new Error(stderr?.trim() || error?.message || 'HELPER_FAILED'));
    });
  });

  let parsed: T;
  try {
    parsed = JSON.parse(stdout) as T;
  } catch {
    throw new Error(`HELPER_BAD_OUTPUT: ${stdout.trim().slice(0, 200)}`);
  }
  if (!parsed.ok) throw new Error(parsed.error ?? 'HELPER_ERROR');
  return parsed;
}

export async function trashItem(targetPath: string): Promise<TrashResult> {
  return run<TrashResult>(['trash', targetPath]);
}

export async function runningApps(): Promise<RunningAppsResult> {
  return run<RunningAppsResult>(['running-apps']);
}

export async function quitApp(bundleId: string, timeoutSec?: number): Promise<QuitResult> {
  const args = ['quit-app', bundleId];
  if (timeoutSec !== undefined) args.push('--timeout', String(timeoutSec));
  return run<QuitResult>(args);
}

export async function privateSize(paths: string[]): Promise<PrivateSizeResult> {
  return run<PrivateSizeResult>(['privatesize', ...paths]);
}

export async function volumeCapacity(targetPath = '/'): Promise<VolumeCapacityResult> {
  return run<VolumeCapacityResult>(['capacity', targetPath]);
}

// One native walk of `path` that reports both allocated bytes and clone-aware
// private bytes. The three cloud File Provider folders are always skipped, in
// addition to any caller-provided skips.
export async function treeSize(
  targetPath: string,
  opts: TreeSizeOptions = {},
): Promise<TreeSizeResult> {
  const args = ['tree', targetPath];
  for (const skip of [...(opts.skip ?? []), ...cloudSkips()]) {
    args.push('--skip', skip);
  }
  if (opts.maxEntries !== undefined) args.push('--max-entries', String(opts.maxEntries));
  const result = await run<TreeSizeResult & { ok: true }>(args, {
    timeoutMs: opts.timeoutMs ?? DEFAULT_TREE_TIMEOUT_MS,
  });
  const { ok: _ok, ...rest } = result;
  return rest;
}
