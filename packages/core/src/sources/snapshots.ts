import type { ProbeRunner } from '../types';
import { runProbe } from '../probes/run';

const SNAPSHOT_LINE = /^com\.apple\.TimeMachine\.(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})\.local$/;

export async function listLocalSnapshots(
  run: ProbeRunner = runProbe,
): Promise<{ name: string; date?: string }[]> {
  const result = await run('tmutil', ['listlocalsnapshots', '/']);
  if (result.exitCode !== 0) return [];

  const snapshots: { name: string; date?: string }[] = [];
  for (const rawLine of result.stdout.split('\n')) {
    const line = rawLine.trim();
    const match = SNAPSHOT_LINE.exec(line);
    if (!match) continue;
    const [, year, month, day, hour, minute, second] = match;
    snapshots.push({
      name: line,
      date: `${year}-${month}-${day}T${hour}:${minute}:${second}`,
    });
  }
  return snapshots;
}
