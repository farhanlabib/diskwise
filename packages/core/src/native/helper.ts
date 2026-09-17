import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

const HELPER_MISSING = 'HELPER_MISSING';

const RELATIVE_HELPER = '../../../native-helper/bin/macsweep-helper';

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

  const fromEnv = process.env.MACSWEEP_HELPER;
  if (fromEnv) candidates.push(fromEnv);

  const here = path.dirname(fileURLToPath(import.meta.url));
  candidates.push(path.resolve(here, RELATIVE_HELPER));

  const entryPoint = process.argv[1];
  if (entryPoint) candidates.push(path.join(path.dirname(entryPoint), 'macsweep-helper'));

  for (const candidate of candidates) {
    if (await isExecutable(candidate)) return candidate;
  }
  return null;
}

async function run<T extends { ok: boolean; error?: string }>(args: string[]): Promise<T> {
  const helper = await findHelper();
  if (!helper) throw new Error(HELPER_MISSING);

  // execFile, never a shell: arguments are passed verbatim, so paths with
  // spaces or shell metacharacters cannot be reinterpreted.
  const stdout = await new Promise<string>((resolve, reject) => {
    execFile(helper, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }, (error, out, stderr) => {
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
