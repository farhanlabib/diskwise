import { describe, expect, it } from 'vitest';
import type { CleanupPlan } from '../types';
import { parsePlan, serializePlan } from './schema';

const plan: CleanupPlan = {
  schemaVersion: 1,
  id: 'plan-1',
  createdAt: '2026-02-03T04:05:06.000Z',
  auditGeneratedAt: '2026-01-02T03:04:05.000Z',
  items: [
    {
      id: 'dev.alpha#0',
      ruleId: 'dev.alpha',
      title: 'Alpha caches - /tmp/alpha/a',
      category: 'dev',
      tier: 0,
      action: 'remove-path',
      permanentOnly: false,
      needsConfirmation: false,
      preflight: { processes: ['Xcode'], daemons: ['docker'], bootedSimulators: false },
      roots: ['/tmp/alpha'],
      match: {
        kind: 'dir',
        path: '/tmp/alpha/a',
        dev: 16777220,
        ino: 12345,
        bytesAllocated: 1000,
        bytesApparent: 2000,
        detail: '/tmp/alpha/a',
        actionArgs: { path: '/tmp/alpha/a' },
        bytesReclaimable: 900,
        unreadable: [],
      },
    },
    {
      id: 'system.gamma#0',
      ruleId: 'system.gamma',
      title: 'Gamma data - /tmp/gamma/c',
      category: 'system',
      tier: 2,
      action: 'trash-path',
      permanentOnly: false,
      needsConfirmation: true,
      roots: ['/tmp/gamma'],
      match: {
        kind: 'file',
        path: '/tmp/gamma/c',
        bytesAllocated: 8000,
        bytesApparent: 16000,
        detail: '/tmp/gamma/c',
      },
    },
  ],
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

interface RawPlan {
  items: Array<{ id: string; action: string; tier: number; match: { path?: string } }>;
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
});
