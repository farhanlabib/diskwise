import { describe, expect, it } from 'vitest';
import { lintRule } from '../lint';
import { parseRule } from '../schema';
import { devRules } from './dev';

describe('devRules catalog', () => {
  it('is not empty', () => {
    expect(devRules.length).toBeGreaterThan(0);
  });

  it('every rule passes schema validation', () => {
    for (const rule of devRules) {
      expect(() => parseRule(rule)).not.toThrow();
    }
  });

  it('every rule passes the safety lint', () => {
    for (const rule of devRules) {
      const parsed = parseRule(rule);
      expect(lintRule(parsed), `lint failed for ${parsed.id}`).toEqual([]);
    }
  });
});
