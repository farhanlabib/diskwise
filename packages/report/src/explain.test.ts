import { describe, expect, it } from 'vitest';
import type { SystemDataReport } from '@diskwise/core';
import { formatExplain } from './explain';

const GB = 1_000_000_000;

const report: SystemDataReport = {
  total: 10 * GB,
  measured: 6.2 * GB,
  unmeasured: 3.8 * GB,
  snapshots: [{ name: 'com.apple.TimeMachine.2026-09-10-101010.local', date: '2026-09-10T10:10:10' }],
  buckets: [
    {
      id: 'coresimulator',
      title: 'CoreSimulator',
      path: '/Library/Developer/CoreSimulator',
      bytes: 4 * GB,
      tier: 'mixed',
      explanation: 'Xcode simulator data: runtime images, simulated devices and caches.',
      children: [
        {
          id: 'coresimulator-images',
          title: 'Images',
          path: '/Library/Developer/CoreSimulator/Images',
          bytes: 3 * GB,
          tier: 'mixed',
          explanation: 'Downloaded simulator runtime images.',
        },
        {
          id: 'coresimulator-devices',
          title: 'Devices',
          path: '/Library/Developer/CoreSimulator/Devices',
          bytes: 1 * GB,
          tier: 'mixed',
          explanation: 'Simulated device data.',
        },
      ],
    },
    {
      id: 'private-var',
      title: '/private/var',
      path: '/private/var',
      bytes: 2.2 * GB,
      tier: 3,
      explanation: 'Runtime state for macOS and apps: swap, databases and logs.',
    },
    {
      id: 'snapshots',
      title: 'Local Time Machine snapshots',
      bytes: 0,
      tier: 3,
      explanation: "Local Time Machine snapshots. Their size can't be measured without admin rights.",
      manualCommand: 'tmutil thinlocalsnapshots / 10000000000 4',
    },
  ],
};

describe('formatExplain', () => {
  it('matches the snapshot', () => {
    expect(formatExplain(report, { color: false })).toMatchSnapshot();
  });

  it('renders the unmeasured row after every bucket', () => {
    const out = formatExplain(report, { color: false });
    const unmeasuredAt = out.indexOf('Unmeasured');

    expect(unmeasuredAt).toBeGreaterThan(-1);
    for (const bucket of report.buckets) {
      expect(unmeasuredAt).toBeGreaterThan(out.indexOf(bucket.title));
    }
  });

  it('never draws a bar wider than 24 cells', () => {
    const out = formatExplain(report, { color: false });
    for (const line of out.split('\n')) {
      for (const run of line.match(/█+/g) ?? []) {
        expect(run.length).toBeLessThanOrEqual(24);
      }
    }
  });

  it('prints the manual command and measured footer', () => {
    const out = formatExplain(report, { color: false });
    expect(out).toContain('$ tmutil thinlocalsnapshots / 10000000000 4');
    expect(out).toContain('Measured 6.2 GB of 10.0 GB');
  });

  it('adds color only when asked', () => {
    expect(formatExplain(report, { color: false })).not.toContain('\x1b[');
    expect(formatExplain(report, { color: true })).toContain('\x1b[');
  });
});
