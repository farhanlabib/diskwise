import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { dockerDfCandidates, filterDockerGroup, parseDockerDf, parseDockerSize } from './docker';

const samplePath = fileURLToPath(
  new URL('../../../../../fixtures/probes/docker-system-df.sample.json', import.meta.url),
);

async function loadSample(): Promise<string> {
  return readFile(samplePath, 'utf8');
}

describe('parseDockerSize', () => {
  it('parses decimal units', () => {
    expect(parseDockerSize('1.2GB')).toBe(1_200_000_000);
    expect(parseDockerSize('350MB')).toBe(350_000_000);
    expect(parseDockerSize('12.5kB')).toBe(12_500);
    expect(parseDockerSize('2TB')).toBe(2_000_000_000_000);
    expect(parseDockerSize('4B')).toBe(4);
    expect(parseDockerSize('7')).toBe(7);
  });

  it('treats zero and unparseable sizes as 0', () => {
    expect(parseDockerSize('0B')).toBe(0);
    expect(parseDockerSize('')).toBe(0);
    expect(parseDockerSize('unknown')).toBe(0);
  });
});

describe('parseDockerDf', () => {
  it('splits the sample fixture into groups', async () => {
    const df = await loadSample().then(parseDockerDf);

    expect(df.danglingImages.map((c) => c.detail)).toEqual(['image <none> (c3d4e5)']);
    expect(df.danglingImages[0]?.actionArgs).toEqual({ group: 'dangling-images' });
    expect(df.danglingImages[0]?.bytesHint).toEqual({ allocated: 180_000_000, apparent: 180_000_000 });

    expect(df.unusedImages.map((c) => c.detail)).toEqual([
      'image postgres:16 (b2c3d4)',
      'image redis:7 (d4e5f6)',
    ]);
    expect(df.unusedImages.map((c) => c.actionArgs)).toEqual([
      { all: 'true', group: 'unused-images' },
      { all: 'true', group: 'unused-images' },
    ]);

    expect(df.stoppedContainers.map((c) => c.detail)).toEqual([
      'container db (exited)',
      'container worker (created)',
    ]);
    expect(df.volumes.map((c) => c.detail)).toEqual([
      'volume pgdata (2 links)',
      'volume scratch (0 links)',
    ]);
    expect(df.volumes[0]?.bytesHint?.allocated).toBe(220_000_000);
  });

  it('keeps images that a running container uses out of the unused group', async () => {
    const df = await loadSample().then(parseDockerDf);
    expect(df.unusedImages.some((c) => c.detail.startsWith('image node:20'))).toBe(false);
  });

  it('caps the build cache at reclaimable entries but sums all when the field is absent', async () => {
    const df = await loadSample().then(parseDockerDf);
    // 500MB (reclaimable) + 136MB + 72.9kB (field missing); 300MB is not reclaimable.
    expect(df.buildCache).toBe(636_072_900);
  });

  it('marks every candidate virtual', async () => {
    const df = await loadSample().then(parseDockerDf);
    const all = [
      ...df.danglingImages,
      ...df.unusedImages,
      ...df.stoppedContainers,
      ...df.volumes,
    ];
    expect(all.every((c) => c.kind === 'virtual')).toBe(true);
  });
});

describe('dockerDfCandidates and filterDockerGroup', () => {
  it('tags every candidate with its group and filters per group', async () => {
    const candidates = dockerDfCandidates(await loadSample());
    expect(candidates).toHaveLength(8);

    const buildCache = filterDockerGroup(candidates, 'build-cache');
    expect(buildCache.map((c) => c.detail)).toEqual(['Docker build cache']);
    expect(buildCache[0]?.bytesHint?.allocated).toBe(636_072_900);

    expect(filterDockerGroup(candidates, 'dangling-images')).toHaveLength(1);
    expect(filterDockerGroup(candidates, 'unused-images')).toHaveLength(2);
    expect(filterDockerGroup(candidates, 'stopped-containers')).toHaveLength(2);
    expect(filterDockerGroup(candidates, 'volumes')).toHaveLength(2);
  });
});
