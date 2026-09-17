import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProbeResult } from '../types';
import { createReplayRunner, recordProbe, recordingKey } from './replay';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'diskwise-replay-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('recordingKey', () => {
  it('uses the binary basename and args with unsafe characters replaced', () => {
    expect(recordingKey('/opt/homebrew/bin/brew', ['info', '--json=v2'])).toBe('brew_info_--json_v2.json');
    expect(recordingKey('/usr/sbin/diskutil', ['info', '-plist', '/'])).toBe('diskutil_info_-plist__.json');
  });
});

describe('createReplayRunner', () => {
  it('replays a recorded result regardless of the binary path', async () => {
    const result: ProbeResult = { stdout: 'hello world\n', stderr: '', exitCode: 0 };
    await recordProbe(dir, '/opt/homebrew/bin/brew', ['list'], result);

    const run = createReplayRunner(dir);
    await expect(run('/usr/local/bin/brew', ['list'])).resolves.toEqual(result);
    await expect(readdir(dir)).resolves.toEqual(['brew_list.json']);
  });

  it('resolves with a 127 no-recording result when the file is missing', async () => {
    const run = createReplayRunner(dir);
    await expect(run('brew', ['list'])).resolves.toEqual({
      stdout: '',
      stderr: 'no recording',
      exitCode: 127,
    });
  });

  it('creates the recording directory on demand', async () => {
    const nested = join(dir, 'deep', 'probes');
    await recordProbe(nested, 'tmutil', ['listlocalsnapshots', '/'], {
      stdout: 'Snapshots for disk /:\n',
      stderr: '',
      exitCode: 0,
    });
    await expect(createReplayRunner(nested)('tmutil', ['listlocalsnapshots', '/'])).resolves.toEqual({
      stdout: 'Snapshots for disk /:\n',
      stderr: '',
      exitCode: 0,
    });
  });
});
