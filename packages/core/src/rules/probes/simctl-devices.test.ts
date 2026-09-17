import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { aggregateUnavailableDevices, parseUnavailableDevices } from './simctl-devices';

const samplePath = fileURLToPath(
  new URL('../../../../../fixtures/probes/simctl-devices.sample.json', import.meta.url),
);

async function loadSample(): Promise<string> {
  return readFile(samplePath, 'utf8');
}

describe('parseUnavailableDevices', () => {
  it('keeps only devices marked unavailable, with their runtime name and size', async () => {
    const candidates = parseUnavailableDevices(await loadSample());

    expect(candidates.map((c) => c.detail)).toEqual([
      'iPhone 14 (iOS 17.4)',
      'Apple Watch Series 9 (45mm) (watchOS 10.4)',
    ]);
    expect(candidates[0]?.kind).toBe('virtual');
    expect(candidates[0]?.bytesHint).toEqual({ allocated: 98_765_432, apparent: 98_765_432 });
    expect(candidates[0]?.actionArgs?.udid).toBe('9B2C3D4E-5F60-7182-93A4-B5C6D7E8F901');
  });

  it('defaults a missing dataPathSize to 0', () => {
    const json = JSON.stringify({
      devices: {
        'com.apple.CoreSimulator.SimRuntime.iOS-17-4': [
          { udid: 'X', name: 'iPhone 13', state: 'Shutdown', isAvailable: false },
        ],
      },
    });
    const candidates = parseUnavailableDevices(json);
    expect(candidates[0]?.bytesHint).toEqual({ allocated: 0, apparent: 0 });
  });

  it('returns [] when every device is available', () => {
    const json = JSON.stringify({
      devices: {
        runtime: [{ udid: 'X', name: 'iPhone 15', isAvailable: true }],
      },
    });
    expect(parseUnavailableDevices(json)).toEqual([]);
  });
});

describe('aggregateUnavailableDevices', () => {
  it('collapses the devices into one candidate with a summed size', async () => {
    const aggregated = aggregateUnavailableDevices(parseUnavailableDevices(await loadSample()));
    expect(aggregated).toEqual([
      {
        kind: 'virtual',
        detail: '2 unavailable simulator devices',
        bytesHint: { allocated: 98_769_753, apparent: 98_769_753 },
      },
    ]);
  });

  it('returns [] for no devices', () => {
    expect(aggregateUnavailableDevices([])).toEqual([]);
  });
});
