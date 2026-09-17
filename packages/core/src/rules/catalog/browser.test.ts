import { describe, expect, it } from 'vitest';
import type { Rule } from '../../types';
import { lintRule } from '../lint';
import { parseRule } from '../schema';
import { browserRules } from './browser';

type GlobChildren = Extract<Rule['matcher'], { kind: 'glob-children' }>;

function globChildren(rule: Rule): GlobChildren {
  if (rule.matcher.kind !== 'glob-children') {
    throw new Error(`rule ${rule.id} is not a glob-children matcher`);
  }
  return rule.matcher;
}

describe('browser rules catalog', () => {
  it('lets every rule pass parseRule and the safety lint', () => {
    for (const rule of browserRules) {
      const parsed = parseRule(rule);
      expect(lintRule(parsed), `lint failed for ${parsed.id}`).toEqual([]);
    }
  });

  it('gives every rule a unique id', () => {
    const ids = browserRules.map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('targets only extra profiles, never the built-in ones', () => {
    for (const rule of browserRules) {
      const matcher = globChildren(rule);
      // The include list is exact: the "Profile " prefix is what keeps the
      // built-in profiles ("Default", "System Profile") out of the match.
      expect(matcher.include).toEqual(['Profile *']);
      for (const builtin of ['Default', 'System Profile']) {
        expect(matcher.include?.includes(builtin)).toBe(false);
      }
    }
  });

  it('moves profiles to the Trash only after the browser is closed', () => {
    for (const rule of browserRules) {
      expect(rule.tier).toBe(2);
      expect(rule.action).toBe('trash-path');
      expect(rule.preflight?.processes?.length).toBeGreaterThan(0);
    }
  });
});
