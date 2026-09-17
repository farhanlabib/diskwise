import { describe, expect, it } from 'vitest';
import { formatJson } from './json';
import { sampleAudit } from './fixtures';

describe('formatJson', () => {
  it('round-trips through JSON.parse', () => {
    const parsed: unknown = JSON.parse(formatJson(sampleAudit));
    expect(parsed).toEqual(sampleAudit);
  });

  it('ends with a newline and is pretty-printed', () => {
    const out = formatJson(sampleAudit);
    expect(out.endsWith('\n')).toBe(true);
    expect(out).toContain('\n  "schemaVersion": 1,');
  });
});
