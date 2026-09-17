import { describe, expect, it } from 'vitest';
import { formatBytes } from './format-bytes';
import { formatTable } from './table';
import { sampleAudit } from './fixtures';

describe('formatBytes', () => {
  it('renders zero and sub-KB values as bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(999)).toBe('999 B');
  });

  it('uses decimal units with one decimal from KB up', () => {
    expect(formatBytes(1000)).toBe('1.0 KB');
    expect(formatBytes(1200)).toBe('1.2 KB');
    expect(formatBytes(16_200_000_000)).toBe('16.2 GB');
    expect(formatBytes(494_400_000_000)).toBe('494.4 GB');
    expect(formatBytes(1_200_000_000_000)).toBe('1.2 TB');
  });

  it('treats non-finite and negative values as zero', () => {
    expect(formatBytes(Number.NaN)).toBe('0 B');
    expect(formatBytes(-5)).toBe('0 B');
  });
});

describe('formatTable', () => {
  it('matches the snapshot', () => {
    expect(formatTable(sampleAudit, { color: false })).toMatchSnapshot();
  });

  it('lists present tiers in ascending order 0, 1, 2, 3 and skips empty ones', () => {
    const out = formatTable(sampleAudit, { color: false });
    const titles = [
      'Tier 0 · Regenerates',
      'Tier 1 · Re-download',
      'Tier 2 · Your data',
      'Tier 3 · Protected (report only)',
    ];
    const present = titles
      .map((title) => ({ title, index: out.indexOf(title) }))
      .filter((entry) => entry.index >= 0);
    // Tier 2 has no findings in the sample, so it is skipped.
    expect(present.map((entry) => entry.title)).toEqual([titles[0], titles[1], titles[3]]);
    const indices = present.map((entry) => entry.index);
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
  });

  it('collapses matches beyond five into a count', () => {
    const out = formatTable(sampleAudit, { color: false });
    expect(out).toContain('… and 2 more');
  });

  it('skips empty tiers and adds color only when asked', () => {
    const plain = formatTable(sampleAudit, { color: false });
    expect(plain).not.toContain('\x1b[');
    expect(formatTable(sampleAudit, { color: true })).toContain('\x1b[');
  });
});
