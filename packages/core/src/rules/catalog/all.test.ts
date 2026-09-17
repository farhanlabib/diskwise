import { describe, expect, it } from 'vitest';
import { lintRule, validateRules } from '../lint';
import { allRules } from './index';

describe('rule catalog', () => {
  it('every shipped rule passes schema validation and the safety lint', () => {
    const { errors } = validateRules(allRules);
    expect(errors).toEqual([]);
    for (const rule of allRules) expect(lintRule(rule), rule.id).toEqual([]);
  });
});
