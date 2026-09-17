import { describe, expect, it } from 'vitest';
import type { ProbeRunner } from '../types';
import { listLocalSnapshots } from './snapshots';

const SNAPSHOT_OUTPUT = [
  'Snapshots for disk /:',
  'com.apple.TimeMachine.2026-09-10-101010.local',
  'com.apple.TimeMachine.2025-01-02-030405.local',
  'com.apple.TimeMachine.not-a-date.local',
  '',
].join('\n');

describe('listLocalSnapshots', () => {
  it('parses names and derives ISO dates, ignoring other lines', async () => {
    const run: ProbeRunner = async () => ({ stdout: SNAPSHOT_OUTPUT, stderr: '', exitCode: 0 });

    await expect(listLocalSnapshots(run)).resolves.toEqual([
      { name: 'com.apple.TimeMachine.2026-09-10-101010.local', date: '2026-09-10T10:10:10' },
      { name: 'com.apple.TimeMachine.2025-01-02-030405.local', date: '2025-01-02T03:04:05' },
    ]);
  });

  it('queries tmutil for local snapshots on /', async () => {
    let seen: string[] = [];
    const run: ProbeRunner = async (_bin, args) => {
      seen = args;
      return { stdout: '', stderr: '', exitCode: 0 };
    };

    await listLocalSnapshots(run);
    expect(seen).toEqual(['listlocalsnapshots', '/']);
  });

  it('returns [] on a non-zero exit', async () => {
    const run: ProbeRunner = async () => ({ stdout: SNAPSHOT_OUTPUT, stderr: 'failed', exitCode: 1 });
    await expect(listLocalSnapshots(run)).resolves.toEqual([]);
  });
});
