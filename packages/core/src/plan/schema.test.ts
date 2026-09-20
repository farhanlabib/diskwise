import { describe, expect, it } from 'vitest';
import { allRules } from '../rules/catalog';
import type { CleanupPlan, PlanItem } from '../types';
import { parsePlan, serializePlan } from './schema';

type CatalogRule = (typeof allRules)[number] & {
  action: NonNullable<(typeof allRules)[number]['action']>;
};

const rule = (id: string): CatalogRule => {
  const found = allRules.find((candidate) => candidate.id === id);
  if (found === undefined || found.action === null) throw new Error(`test references unknown rule ${id}`);
  return found as CatalogRule;
};

const derivedData = rule('xcode.derived-data');
const iosBackups = rule('ios.backups');

function itemFrom(def: CatalogRule, index: number, matchPath: string): PlanItem {
  return {
    id: `${def.id}#${index}`,
    ruleId: def.id,
    title: `${def.title} - ${matchPath}`,
    category: def.category,
    tier: def.tier,
    action: def.action,
    permanentOnly: def.permanentOnly ?? false,
    needsConfirmation: def.tier === 2 || def.permanentOnly === true,
    ...(def.preflight !== undefined ? { preflight: def.preflight } : {}),
    roots: def.roots,
    match: {
      kind: 'dir',
      path: matchPath,
      dev: 16777220,
      ino: 12345 + index,
      bytesAllocated: 1000,
      bytesApparent: 2000,
      detail: matchPath,
      bytesReclaimable: 900,
      unreadable: [],
    },
  };
}

const plan: CleanupPlan = {
  schemaVersion: 1,
  id: 'plan-1',
  createdAt: '2026-02-03T04:05:06.000Z',
  auditGeneratedAt: '2026-01-02T03:04:05.000Z',
  items: [itemFrom(derivedData, 0, '/tmp/alpha/a'), itemFrom(iosBackups, 1, '/tmp/gamma/c')],
  manual: [
    {
      ruleId: 'user.delta',
      title: 'Delta leftovers',
      command: 'sudo rm -rf /var/delta',
      bytes: 500,
    },
  ],
  totals: { byTier: { 0: 1000, 1: 0, 2: 8000, 3: 0 }, total: 9000 },
};

interface RawItem {
  id: string;
  ruleId: string;
  action: string;
  tier: number;
  permanentOnly: boolean;
  needsConfirmation: boolean;
  roots: string[];
  preflight?: unknown;
  match: { path?: string };
}

interface RawPlan {
  items: RawItem[];
}

const roundTrip = (mutate: (raw: RawPlan) => void): string => {
  const raw = JSON.parse(serializePlan(plan)) as RawPlan;
  mutate(raw);
  return JSON.stringify(raw);
};

describe('CleanupPlanSchema', () => {
  it('round-trips a plan through serialize and parse', () => {
    expect(parsePlan(serializePlan(plan))).toEqual(plan);
  });

  it('serializes pretty JSON with a trailing newline', () => {
    const json = serializePlan(plan);
    expect(json.endsWith('\n')).toBe(true);
    expect(json).toBe(`${JSON.stringify(plan, null, 2)}\n`);
  });

  it('keeps passthrough match keys', () => {
    const parsed = parsePlan(serializePlan(plan));
    expect(parsed.items[0]!.match.bytesReclaimable).toBe(900);
    expect(parsed.items[0]!.match.unreadable).toEqual([]);
  });

  it('rejects invalid JSON', () => {
    expect(() => parsePlan('{ not json')).toThrow(/^Invalid plan:/);
  });

  it('rejects an unknown action', () => {
    expect(() =>
      parsePlan(
        roundTrip((raw) => {
          raw.items[0]!.action = 'nuke-everything';
        }),
      ),
    ).toThrow(/^Invalid plan:/);
  });

  it('rejects a relative match path', () => {
    expect(() =>
      parsePlan(
        roundTrip((raw) => {
          raw.items[0]!.match.path = 'relative/alpha';
        }),
      ),
    ).toThrow(/^Invalid plan:/);
  });

  it('rejects duplicate item ids', () => {
    expect(() =>
      parsePlan(
        roundTrip((raw) => {
          raw.items[1]!.id = raw.items[0]!.id;
        }),
      ),
    ).toThrow(/^Invalid plan:/);
  });

  it('rejects a tier outside 0..3', () => {
    expect(() =>
      parsePlan(
        roundTrip((raw) => {
          raw.items[0]!.tier = 4;
        }),
      ),
    ).toThrow(/^Invalid plan:/);
  });

  it('rejects an unknown rule id', () => {
    expect(() =>
      parsePlan(
        roundTrip((raw) => {
          raw.items[0]!.ruleId = 'gone.rule';
        }),
      ),
    ).toThrow(/^Invalid plan:.*unknown rule id "gone\.rule"/);
  });

  it('rejects a substituted action', () => {
    expect(() =>
      parsePlan(
        roundTrip((raw) => {
          raw.items[0]!.action = 'trash-path';
        }),
      ),
    ).toThrow(/^Invalid plan:.*records action "trash-path" but rule "xcode\.derived-data" now uses "remove-path"/);
  });

  it('rejects a widened roots list', () => {
    expect(() =>
      parsePlan(
        roundTrip((raw) => {
          raw.items[0]!.roots = ['/'];
        }),
      ),
    ).toThrow(/^Invalid plan:.*records roots/);
  });

  it('rejects a removed confirmation requirement', () => {
    expect(() =>
      parsePlan(
        roundTrip((raw) => {
          raw.items[1]!.needsConfirmation = false;
        }),
      ),
    ).toThrow(/^Invalid plan:.*records needsConfirmation false/);
  });

  it('rejects a substituted tier', () => {
    expect(() =>
      parsePlan(
        roundTrip((raw) => {
          raw.items[1]!.tier = 0;
        }),
      ),
    ).toThrow(/^Invalid plan:.*records tier 0 but rule "ios\.backups" now uses 2/);
  });
});
