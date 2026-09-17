import { describe, expect, it } from 'vitest';
import { lintRule } from '../lint';
import { parseRule } from '../schema';
import { cacheRules } from './caches';

const NETWORK_ACTIONS = new Set([
  'brew-cleanup',
  'npm-cache-clean',
  'pnpm-store-prune',
  'yarn-cache-clean',
  'uv-cache-clean',
  'go-clean-mod',
]);

describe('caches catalog', () => {
  it('has seventeen rules', () => {
    expect(cacheRules).toHaveLength(17);
  });

  it('every rule passes schema validation and the safety lint', () => {
    for (const rule of cacheRules) {
      expect(() => parseRule(rule)).not.toThrow();
      const parsed = parseRule(rule);
      expect(lintRule(parsed), `lint failed for ${parsed.id}`).toEqual([]);
    }
  });

  it('gives every rule a unique id', () => {
    const ids = cacheRules.map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('never points two rules at the same root', () => {
    const roots = cacheRules.flatMap((rule) => rule.roots);
    expect(new Set(roots).size).toBe(roots.length);
  });

  it('never gives a tier-0 rule an action that needs the network', () => {
    for (const rule of cacheRules) {
      if (rule.tier === 0 && rule.action !== null) {
        expect(NETWORK_ACTIONS.has(rule.action), `${rule.id} uses ${rule.action}`).toBe(false);
      }
    }
  });

  it('always ships a manualCommand with an action-less rule', () => {
    for (const rule of cacheRules) {
      if (rule.action === null) expect(rule.manualCommand).toBeTruthy();
    }
  });
});
