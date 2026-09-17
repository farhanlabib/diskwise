import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { ProbeResult, ProbeRunner } from '../types';

// One recording per `basename(bin) + args`, so `diskutil info -plist /` maps to
// a single stable file regardless of where the binary actually lives.
export function recordingKey(bin: string, args: string[]): string {
  const raw = `${basename(bin)} ${args.join(' ')}`;
  return `${raw.replace(/[^A-Za-z0-9._-]/g, '_')}.json`;
}

export function createReplayRunner(dir: string): ProbeRunner {
  return async (bin, args) => {
    const file = join(dir, recordingKey(bin, args));
    try {
      const text = await readFile(file, 'utf8');
      return JSON.parse(text) as ProbeResult;
    } catch {
      return { stdout: '', stderr: 'no recording', exitCode: 127 };
    }
  };
}

export async function recordProbe(
  dir: string,
  bin: string,
  args: string[],
  result: ProbeResult,
): Promise<void> {
  await mkdir(dir, { recursive: true });
  const file = join(dir, recordingKey(bin, args));
  await writeFile(file, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
}
