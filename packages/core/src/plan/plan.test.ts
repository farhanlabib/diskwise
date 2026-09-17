import { describe, expect, it } from 'vitest';
import type { AuditResult, Finding, Match, Rule } from '../types';
import { buildPlan } from './plan';

const match = (path: string, bytesAllocated: number): Match => ({
  kind: 'dir',
  path,
  detail: path,
  bytesAllocated,
  bytesApparent: bytesAllocated * 2,
});

const rules: Rule[] = [
  {
    schemaVersion: 1,
    id: 'dev.alpha',
    title: 'Alpha caches',
    category: 'dev',
    tier: 0,
    roots: ['/tmp/alpha'],
    matcher: { kind: 'path', path: '/tmp/alpha' },
    action: 'remove-path',
    rationale: 'Alpha caches are rebuilt locally on the next build.',
    regeneration: 'Rebuilt on the next build.',
    preflight: { processes: ['Xcode'] },
  },
  {
    schemaVersion: 1,
    id: 'dev.beta',
    title: 'Beta caches',
    category: 'dev',
    tier: 1,
    roots: ['/tmp/beta'],
    matcher: { kind: 'path', path: '/tmp/beta' },
    action: 'trash-path',
    rationale: 'Beta caches are redownloaded on demand when needed.',
    regeneration: 'Redownloaded on demand.',
  },
  {
    schemaVersion: 1,
    id: 'system.gamma',
    title: 'Gamma data',
    category: 'system',
    tier: 2,
    roots: ['/tmp/gamma'],
    matcher: { kind: 'path', path: '/tmp/gamma' },
    action: 'trash-path',
    rationale: 'Gamma holds user data that only a person can recreate.',
    regeneration: 'Recreated by hand.',
  },
  {
    schemaVersion: 1,
    id: 'user.delta',
    title: 'Delta leftovers',
    category: 'user-data',
    tier: 1,
    roots: ['/var/delta'],
    matcher: { kind: 'path', path: '/var/delta' },
    action: null,
    rationale: 'Delta needs root and has no safe automated action here.',
    regeneration: 'Not regenerated.',
    needsRoot: true,
    manualCommand: 'sudo rm -rf /var/delta',
  },
  {
    schemaVersion: 1,
    id: 'never.epsilon',
    title: 'Epsilon never',
    category: 'os-leftovers',
    tier: 3,
    roots: ['/tmp/epsilon'],
    matcher: { kind: 'path', path: '/tmp/epsilon' },
    action: null,
    rationale: 'Epsilon is never touched by the tool under any condition.',
    regeneration: 'Not regenerated.',
  },
];

const findings: Finding[] = [
  {
    ruleId: 'dev.alpha',
    title: 'Alpha caches',
    category: 'dev',
    tier: 0,
    rationale: 'Alpha caches are rebuilt locally on the next build.',
    regeneration: 'Rebuilt on the next build.',
    action: 'remove-path',
    needsRoot: false,
    permanentOnly: false,
    matches: [match('/tmp/alpha/a', 1000), match('/tmp/alpha/b', 2000)],
    totals: { allocated: 3000, apparent: 6000 },
  },
  {
    ruleId: 'dev.beta',
    title: 'Beta caches',
    category: 'dev',
    tier: 1,
    rationale: 'Beta caches are redownloaded on demand when needed.',
    regeneration: 'Redownloaded on demand.',
    action: 'trash-path',
    needsRoot: false,
    permanentOnly: true,
    matches: [match('/tmp/beta/b', 4000)],
    totals: { allocated: 4000, apparent: 8000 },
  },
  {
    ruleId: 'system.gamma',
    title: 'Gamma data',
    category: 'system',
    tier: 2,
    rationale: 'Gamma holds user data that only a person can recreate.',
    regeneration: 'Recreated by hand.',
    action: 'trash-path',
    needsRoot: false,
    permanentOnly: false,
    matches: [match('/tmp/gamma/c', 8000)],
    totals: { allocated: 8000, apparent: 16000 },
  },
  {
    ruleId: 'never.epsilon',
    title: 'Epsilon never',
    category: 'os-leftovers',
    tier: 3,
    rationale: 'Epsilon is never touched by the tool under any condition.',
    regeneration: 'Not regenerated.',
    action: null,
    needsRoot: false,
    permanentOnly: false,
    matches: [match('/tmp/epsilon/e', 16000)],
    totals: { allocated: 16000, apparent: 32000 },
  },
  {
    ruleId: 'user.delta',
    title: 'Delta leftovers',
    category: 'user-data',
    tier: 1,
    rationale: 'Delta needs root and has no safe automated action here.',
    regeneration: 'Not regenerated.',
    action: null,
    needsRoot: true,
    manualCommand: 'sudo rm -rf /var/delta',
    permanentOnly: false,
    matches: [],
    totals: { allocated: 500, apparent: 500 },
  },
  {
    ruleId: 'gone.missing',
    title: 'Missing rule',
    category: 'dev',
    tier: 0,
    rationale: 'This finding has no matching rule and must be skipped.',
    regeneration: 'Not regenerated.',
    action: 'remove-path',
    needsRoot: false,
    permanentOnly: false,
    matches: [match('/tmp/missing/m', 32000)],
    totals: { allocated: 32000, apparent: 64000 },
  },
];

const audit: AuditResult = {
  schemaVersion: 1,
  generatedAt: '2026-01-02T03:04:05.000Z',
  findings,
  traps: [],
  unreadable: [],
  totals: { byTier: { 0: 3000, 1: 4000, 2: 8000, 3: 16000 }, reclaimable: 31000 },
};

describe('buildPlan', () => {
  it('keeps tiers 0 and 1 by default', () => {
    const plan = buildPlan(audit, rules, {}, { id: 'plan-1', now: new Date('2026-02-03T04:05:06.000Z') });
    expect(plan.items.map((item) => item.id)).toEqual(['dev.alpha#0', 'dev.alpha#1', 'dev.beta#0']);
    expect(plan.manual).toEqual([
      {
        ruleId: 'user.delta',
        title: 'Delta leftovers',
        command: 'sudo rm -rf /var/delta',
        bytes: 500,
      },
    ]);
    expect(plan.id).toBe('plan-1');
    expect(plan.createdAt).toBe('2026-02-03T04:05:06.000Z');
    expect(plan.auditGeneratedAt).toBe(audit.generatedAt);
    expect(plan.schemaVersion).toBe(1);
  });

  it('includes tier 2 only when asked, flagged for confirmation', () => {
    const plan = buildPlan(audit, rules, { tiers: [2] });
    expect(plan.items).toHaveLength(1);
    const item = plan.items[0]!;
    expect(item.ruleId).toBe('system.gamma');
    expect(item.needsConfirmation).toBe(true);
    expect(plan.manual).toEqual([]);
  });

  it('marks permanentOnly items as needing confirmation', () => {
    const plan = buildPlan(audit, rules, { tiers: [1] });
    const item = plan.items.find((candidate) => candidate.ruleId === 'dev.beta')!;
    expect(item.permanentOnly).toBe(true);
    expect(item.needsConfirmation).toBe(true);
  });

  it('never includes tier 3', () => {
    expect(buildPlan(audit, rules, { tiers: [3] }).items).toEqual([]);
    expect(buildPlan(audit, rules, { tiers: [0, 1, 2, 3] }).items.some((item) => item.tier === 3)).toBe(false);
  });

  it('copies the rule preflight, roots and match onto each item', () => {
    const plan = buildPlan(audit, rules);
    const item = plan.items[0]!;
    expect(item.preflight).toEqual({ processes: ['Xcode'] });
    expect(item.roots).toEqual(['/tmp/alpha']);
    expect(item.match).toEqual(match('/tmp/alpha/a', 1000));
    expect(item.title).toBe('Alpha caches - /tmp/alpha/a');
    expect(item.category).toBe('dev');
    expect(item.tier).toBe(0);
    expect(item.action).toBe('remove-path');
    expect(item.needsConfirmation).toBe(false);
  });

  it('filters by category and rule id', () => {
    const dev = buildPlan(audit, rules, { categories: ['dev'] });
    expect(dev.items).toHaveLength(3);
    expect(dev.manual).toEqual([]);

    const userData = buildPlan(audit, rules, { categories: ['user-data'] });
    expect(userData.items).toEqual([]);
    expect(userData.manual).toHaveLength(1);

    const beta = buildPlan(audit, rules, { ruleIds: ['dev.beta'] });
    expect(beta.items.map((item) => item.id)).toEqual(['dev.beta#0']);
    expect(beta.manual).toEqual([]);
  });

  it('filters by item id and leaves manual steps alone', () => {
    const plan = buildPlan(audit, rules, { itemIds: ['dev.alpha#1'] });
    expect(plan.items.map((item) => item.id)).toEqual(['dev.alpha#1']);
    expect(plan.manual).toHaveLength(1);
  });

  it('totals bytes per tier with every tier key present', () => {
    const plan = buildPlan(audit, rules);
    expect(plan.totals.byTier).toEqual({ 0: 3000, 1: 4000, 2: 0, 3: 0 });
    expect(Object.keys(plan.totals.byTier).sort()).toEqual(['0', '1', '2', '3']);
    expect(plan.totals.total).toBe(7000);
  });

  it('skips findings whose rule is missing', () => {
    const plan = buildPlan(audit, rules);
    expect(plan.items.some((item) => item.ruleId === 'gone.missing')).toBe(false);
    expect(plan.items).toHaveLength(3);
  });
});
