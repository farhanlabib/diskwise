import { describe, expect, it } from 'vitest';
import type { Rule } from '../types';
import { lintRule, validateRules } from './lint';
import { parseRule } from './schema';

interface Overrides {
  tier: Rule['tier'];
  action: Rule['action'];
  roots: string[];
  matcher: Rule['matcher'];
  needsRoot?: boolean;
  manualCommand?: string;
  permanentOnly?: boolean;
}

const base: Overrides = {
  tier: 1,
  action: null,
  roots: ['/tmp/diskwise-lint'],
  matcher: { kind: 'glob-children', root: '/tmp/diskwise-lint' },
};

function dangerous(id: string, overrides: Partial<Overrides>): Rule {
  return parseRule({
    schemaVersion: 1,
    id,
    title: `Dangerous test rule ${id}`,
    category: 'dev',
    rationale: 'This rule exists only to prove the safety lint rejects it.',
    regeneration: 'Nothing: this rule must never ship.',
    ...base,
    ...overrides,
  });
}

describe('lintRule', () => {
  it('returns no messages for a safe rule', () => {
    expect(lintRule(dangerous('safe.example', {}))).toEqual([]);
  });

  it('(a) rejects remove-path above tier 1', () => {
    const messages = lintRule(dangerous('a.destructive', { tier: 2, action: 'remove-path' }));
    expect(messages.some((m) => m.includes('not allowed above tier 1'))).toBe(true);
  });

  it('(b) rejects an action on a tier 3 rule', () => {
    const messages = lintRule(dangerous('b.never', { tier: 3, action: 'trash-path' }));
    expect(messages.some((m) => m.includes('tier 3 rules must not have an action'))).toBe(true);
  });

  it('(c) rejects a non-Trash action at tier 2', () => {
    const messages = lintRule(dangerous('c.tier2', { tier: 2, action: 'brew-cleanup' }));
    expect(messages.some((m) => m.includes('tier 2 rules may only use'))).toBe(true);
  });

  it('(d) rejects empty-trash without permanentOnly', () => {
    const messages = lintRule(dangerous('d.trash', { tier: 2, action: 'empty-trash' }));
    expect(messages.some((m) => m.includes('requires permanentOnly: true'))).toBe(true);
  });

  it('(d) accepts empty-trash with permanentOnly', () => {
    const messages = lintRule(
      dangerous('d.trash-ok', { tier: 2, action: 'empty-trash', permanentOnly: true }),
    );
    expect(messages).toEqual([]);
  });

  it('(e) rejects a denylisted root', () => {
    const messages = lintRule(
      dangerous('e.denied', {
        tier: 1,
        action: 'remove-path',
        roots: ['/System'],
        matcher: { kind: 'path', path: '/System/Library' },
      }),
    );
    expect(messages.some((m) => m.includes('denied root'))).toBe(true);
  });

  it('(e) rejects a root that contains a denied root', () => {
    const messages = lintRule(
      dangerous('e.ancestor', {
        tier: 1,
        action: 'remove-path',
        roots: ['/private/var'],
        matcher: { kind: 'path', path: '/private/var/vm' },
      }),
    );
    expect(messages.some((m) => m.includes('denied root'))).toBe(true);
  });

  it('(e) rejects a home root for non project-dirs matchers', () => {
    const messages = lintRule(
      dangerous('e.home', {
        tier: 1,
        action: 'remove-path',
        roots: ['~'],
        matcher: { kind: 'path', path: '~/foo' },
      }),
    );
    expect(messages.some((m) => m.includes('denied root'))).toBe(true);
  });

  it('(e) exempts project-dirs matchers from the root denylist', () => {
    const messages = lintRule(
      dangerous('e.project-dirs', {
        tier: 1,
        action: 'remove-path',
        roots: ['~'],
        matcher: {
          kind: 'project-dirs',
          searchRoots: ['~'],
          name: 'node_modules',
          marker: 'package.json',
          maxAgeDays: 14,
          excludePrefixes: ['~/Library'],
        },
      }),
    );
    expect(messages).toEqual([]);
  });

  it('(f) rejects needsRoot without manualCommand', () => {
    const messages = lintRule(dangerous('f.root', { needsRoot: true }));
    expect(messages.some((m) => m.includes('requires a manualCommand'))).toBe(true);
  });

  it('(g) rejects a path outside the rule roots', () => {
    const messages = lintRule(
      dangerous('g.outside', { matcher: { kind: 'path', path: '/tmp/diskwise-elsewhere/x' } }),
    );
    expect(messages.some((m) => m.includes("not inside any of the rule's roots"))).toBe(true);
  });

  it('(g) accepts a target inside a declared root', () => {
    const messages = lintRule(
      dangerous('g.inside', { matcher: { kind: 'path', path: '/tmp/diskwise-lint/sub' } }),
    );
    expect(messages).toEqual([]);
  });

  it('(g) rejects a versioned-children root outside the rule roots', () => {
    const messages = lintRule(
      dangerous('g.versioned-outside', {
        matcher: { kind: 'versioned-children', root: '/tmp/diskwise-elsewhere', keepNewest: 2 },
      }),
    );
    expect(messages.some((m) => m.includes("not inside any of the rule's roots"))).toBe(true);
  });

  it('(g) accepts a versioned-children root inside a declared root', () => {
    const messages = lintRule(
      dangerous('g.versioned-inside', {
        matcher: { kind: 'versioned-children', root: '/tmp/diskwise-lint/sub', keepNewest: 2 },
      }),
    );
    expect(messages).toEqual([]);
  });
});

describe('validateRules', () => {
  it('collects schema and lint errors and keeps the valid rules', () => {
    const safe = dangerous('safe.example', {});
    const bad = dangerous('a.destructive', { tier: 2, action: 'remove-path' });
    const { rules, errors } = validateRules([safe, bad, { id: 'broken.rule', tier: 9 }]);

    expect(rules.map((r) => r.id)).toEqual(['safe.example', 'a.destructive']);
    expect(errors.map((e) => e.id).sort()).toEqual(['a.destructive', 'broken.rule']);
  });

  it('reports duplicate ids', () => {
    const first = dangerous('dup.example', {});
    const second = dangerous('dup.example', {});
    const { errors } = validateRules([first, second]);
    expect(errors).toEqual([{ id: 'dup.example', messages: ['duplicate rule id'] }]);
  });
});

describe('report-only tier 3 rules', () => {
  it('may declare broad roots because they have no action', async () => {
    const { lintRule: lint } = await import('./lint');
    const messages = lint({
      schemaVersion: 1,
      id: 'test.report-only',
      title: 'Report only',
      category: 'os-leftovers',
      tier: 3,
      roots: ['/'],
      matcher: { kind: 'glob-children', root: '/', include: ['Previous System*'] },
      action: null,
      rationale: 'Explained to the user and never touched.',
      regeneration: 'Nothing is removed.',
    });
    expect(messages).toEqual([]);
  });
});
