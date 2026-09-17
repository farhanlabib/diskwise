import type { AuditResult } from '@diskwise/core';
import { describe, expect, it } from 'vitest';
import { sampleAudit } from './fixtures';
import { formatMarkdown } from './markdown';

describe('formatMarkdown', () => {
  it('matches the snapshot', () => {
    expect(formatMarkdown(sampleAudit, { version: '0.1.0' })).toMatchSnapshot();
  });

  it('escapes pipes and flattens newlines in table cells', () => {
    const result: AuditResult = structuredClone(sampleAudit);
    result.findings[0]!.rationale = 'line one\nline two | piped';
    const out = formatMarkdown(result);
    expect(out).toContain('line one line two \\| piped');
    expect(out).not.toContain('line two | piped');
  });

  it('lists present tiers in ascending order 0, 1, 2, 3 and skips empty ones', () => {
    const out = formatMarkdown(sampleAudit);
    const titles = [
      '## Tier 0 · Regenerates',
      '## Tier 1 · Re-download',
      '## Tier 2 · Your data',
      '## Tier 3 · Protected (report only)',
    ];
    const present = titles
      .map((title) => ({ title, index: out.indexOf(title) }))
      .filter((entry) => entry.index >= 0);
    expect(present.map((entry) => entry.title)).toEqual([titles[0], titles[1], titles[3]]);
    const indices = present.map((entry) => entry.index);
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
  });

  it('includes a details block for match listings', () => {
    expect(formatMarkdown(sampleAudit)).toContain('<details><summary>Items</summary>');
  });
});
