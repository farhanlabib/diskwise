import { describe, expect, it } from 'vitest';
import { createReplayRunner } from '../probes/replay';
import type { ProbeRunner } from '../types';
import { getDiskInfo } from './disk';

const run = createReplayRunner('fixtures/probes');

describe('getDiskInfo', () => {
  it('parses the recorded diskutil plist for /', async () => {
    const info = await getDiskInfo(run, '/');

    expect(info.mountPoint).toBe('/');
    expect(info.volumeName).toBe('Macintosh HD');
    expect(info.containerTotal).toBeGreaterThan(0);
    expect(info.containerFree).toBeGreaterThan(0);
    expect(info.containerUsed + info.containerFree).toBe(info.containerTotal);
    expect(info.volumeUsed).toBeGreaterThan(0);
    expect(info.caseSensitive).toBe(false);
  });

  it('throws a clear error when diskutil fails', async () => {
    const failing: ProbeRunner = async () => ({ stdout: '', stderr: 'No such volume\n', exitCode: 1 });
    await expect(getDiskInfo(failing, '/Volumes/Nope')).rejects.toThrow(
      /diskutil info -plist \/Volumes\/Nope failed with exit code 1: No such volume/,
    );
  });

  it('throws when the probe returns no recording', async () => {
    await expect(getDiskInfo(run, '/Volumes/Missing')).rejects.toThrow(/exit code 127/);
  });
});
