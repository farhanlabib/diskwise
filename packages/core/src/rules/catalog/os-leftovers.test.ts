import { describe, expect, it } from 'vitest';
import { osLeftoverRules } from './os-leftovers';

function isInside(path: string, root: string): boolean {
  if (path === root) return true;
  return root === '/' ? path.startsWith('/') : path.startsWith(`${root}/`);
}

function matcherPath(rule: (typeof osLeftoverRules)[number]): string | null {
  if (rule.matcher.kind === 'path') return rule.matcher.path;
  if (rule.matcher.kind === 'glob-children') return rule.matcher.root;
  if (rule.matcher.kind === 'versioned-children') return rule.matcher.root;
  return null;
}

describe('os-leftovers catalog', () => {
  it('has twelve rules', () => {
    expect(osLeftoverRules).toHaveLength(12);
  });

  it('gives every rule a unique id matching os.<slug>', () => {
    const ids = osLeftoverRules.map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^os\.[a-z0-9-]+$/);
    }
  });

  it('declares schemaVersion 1 and the os-leftovers category for all rules', () => {
    for (const rule of osLeftoverRules) {
      expect(rule.schemaVersion).toBe(1);
      expect(rule.category).toBe('os-leftovers');
    }
  });

  it('never acts on a tier-3 rule', () => {
    for (const rule of osLeftoverRules) {
      if (rule.tier === 3) expect(rule.action).toBeNull();
    }
  });

  it('never uses remove-path above tier 1', () => {
    for (const rule of osLeftoverRules) {
      if (rule.action === 'remove-path') expect(rule.tier).toBeLessThanOrEqual(1);
    }
  });

  it('always ships a manualCommand with a needsRoot rule', () => {
    for (const rule of osLeftoverRules) {
      if (rule.needsRoot) expect(rule.manualCommand).toBeTruthy();
    }
  });

  it('only lets tier-2 rules use trash-path', () => {
    for (const rule of osLeftoverRules) {
      if (rule.tier === 2) expect(rule.action).toBe('trash-path');
    }
  });

  it('keeps every matcher path equal to or inside one of the rule roots', () => {
    for (const rule of osLeftoverRules) {
      const path = matcherPath(rule);
      if (path === null) continue;
      const covered = rule.roots.some((root) => isInside(path, root));
      expect(covered, `${rule.id}: ${path} not under ${rule.roots.join(', ')}`).toBe(true);
    }
  });

  it('explains every rule with a real rationale and regeneration cost', () => {
    for (const rule of osLeftoverRules) {
      expect(rule.rationale.length).toBeGreaterThanOrEqual(20);
      expect(rule.regeneration.length).toBeGreaterThanOrEqual(10);
    }
  });
});
