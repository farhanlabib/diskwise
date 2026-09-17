import { describe, expect, it } from 'vitest';
import type { Rule } from '../../types';
import { lintRule } from '../lint';
import { parseRule } from '../schema';
import { dockerRules } from './docker';
import { simulatorRules } from './simulator';

const rules: Rule[] = [...dockerRules, ...simulatorRules];

describe('docker and simulator catalogs', () => {
  it('is not empty', () => {
    expect(rules.length).toBeGreaterThan(0);
  });

  it('every rule passes schema validation', () => {
    for (const rule of rules) {
      expect(() => parseRule(rule), rule.id).not.toThrow();
    }
  });

  it('every rule passes the safety lint', () => {
    for (const rule of rules) {
      const parsed = parseRule(rule);
      expect(lintRule(parsed), `lint failed for ${parsed.id}`).toEqual([]);
    }
  });

  it('never makes Docker volumes actionable', () => {
    const volumes = dockerRules.find((rule) => rule.id === 'docker.volumes');
    expect(volumes).toBeDefined();
    expect(volumes?.action).toBeNull();
    expect(volumes?.tier).toBe(3);
    expect(volumes?.manualCommand).toBe('docker volume ls');
  });
});
