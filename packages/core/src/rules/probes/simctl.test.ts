import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseSimctlRuntimes } from './simctl';

const samplePath = fileURLToPath(
  new URL('../../../../../fixtures/probes/simctl-runtime-list.sample.json', import.meta.url),
);

async function loadSample(): Promise<string> {
  return readFile(samplePath, 'utf8');
}

describe('parseSimctlRuntimes', () => {
  it('parses the recorded sample fixture', async () => {
    const candidates = parseSimctlRuntimes(await loadSample());

    expect(candidates).toHaveLength(2);

    const ios26 = candidates.find((c) => c.actionArgs?.uuid === '0A1B2C3D-4E5F-6789-ABCD-EF0123456789');
    expect(ios26).toBeDefined();
    expect(ios26?.kind).toBe('virtual');
    expect(ios26?.detail).toBe('iOS 26.1 (23B86), last used 2026-06-01');
    expect(ios26?.bytesHint).toEqual({ allocated: 17179869184, apparent: 17179869184 });

    const ios18 = candidates.find((c) => c.actionArgs?.uuid === '1F2E3D4C-5B6A-7980-9182-A3B4C5D6E7F8');
    expect(ios18).toBeDefined();
    expect(ios18?.detail).toBe('iOS 18.4 (22E238), never used');
    expect(ios18?.bytesHint).toEqual({ allocated: 8589934592, apparent: 8589934592 });
  });

  it('skips entries marked deletable: false', () => {
    const json = JSON.stringify({
      AAAA: {
        identifier: 'ios',
        version: '26.1',
        build: '23B86',
        platformIdentifier: 'com.apple.platform.iphonesimulator',
        sizeBytes: 100,
        deletable: false,
        lastUsedAt: null,
      },
      BBBB: {
        version: '18.4',
        build: '22E238',
        platformIdentifier: 'com.apple.platform.iphonesimulator',
        sizeBytes: 200,
      },
    });
    const candidates = parseSimctlRuntimes(json);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.actionArgs).toEqual({ uuid: 'BBBB' });
  });

  it('maps every simulator platform identifier', () => {
    const json = JSON.stringify({
      A: { version: '1', build: 'b', platformIdentifier: 'com.apple.platform.watchsimulator' },
      B: { version: '2', build: 'b', platformIdentifier: 'com.apple.platform.appletvsimulator' },
      C: { version: '3', build: 'b', platformIdentifier: 'com.apple.platform.xrsimulator' },
      D: { version: '4', build: 'b', platformIdentifier: 'com.apple.platform.iphonesimulator' },
    });
    const details = parseSimctlRuntimes(json).map((c) => c.detail);
    expect(details).toEqual([
      'watchOS 1 (b), never used',
      'tvOS 2 (b), never used',
      'visionOS 3 (b), never used',
      'iOS 4 (b), never used',
    ]);
  });
});
