import { describe, expect, it } from 'vitest';
import { lintRule } from '../lint';
import { parseRule } from '../schema';
import { systemRules } from './system';
import { userDataRules } from './user-data';

const all = [...userDataRules, ...systemRules];

describe('user-data and system catalogs', () => {
  it('is not empty', () => {
    expect(userDataRules.length).toBeGreaterThan(0);
    expect(systemRules.length).toBeGreaterThan(0);
  });

  it('lets every rule pass parseRule and the safety lint', () => {
    for (const rule of all) {
      const parsed = parseRule(rule);
      expect(lintRule(parsed), `lint failed for ${parsed.id}`).toEqual([]);
    }
  });

  it('only lets tier-2 user-data rules use trash-path, except trash.empty', () => {
    for (const rule of userDataRules) {
      if (rule.id === 'trash.empty') continue;
      if (rule.tier === 2) expect(rule.action).toBe('trash-path');
    }
  });

  it('marks trash.empty permanentOnly and permanent', () => {
    const rule = userDataRules.find((r) => r.id === 'trash.empty');
    expect(rule?.tier).toBe(2);
    expect(rule?.action).toBe('empty-trash');
    expect(rule?.permanentOnly).toBe(true);
  });

  it('keeps every system rule at tier 3 with no action', () => {
    for (const rule of systemRules) {
      expect(rule.tier).toBe(3);
      expect(rule.action).toBeNull();
    }
  });

  it('gives every rule a unique id', () => {
    const ids = all.map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
