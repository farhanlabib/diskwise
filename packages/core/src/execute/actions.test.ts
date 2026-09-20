import { describe, expect, it } from 'vitest';

import { allRules } from '../rules/catalog';
import type { CleanupPlan, Match, PlanItem, ProbeResult, ProbeRunner } from '../types';
import { executePlan } from './execute';

const UUID = '1A2B3C4D-5E6F-7A8B-9C0D-1E2F3A4B5C6D';

const RULES = new Map(allRules.map((rule) => [rule.id, rule] as const));

function ok(stdout = ''): ProbeResult {
  return { stdout, stderr: '', exitCode: 0 };
}

function fail(stderr = '', exitCode = 1): ProbeResult {
  return { stdout: '', stderr, exitCode };
}

type RunHandler = (bin: string, args: string[]) => ProbeResult | undefined;

function makeRun(handler?: RunHandler): { run: ProbeRunner; calls: Array<{ bin: string; args: string[] }> } {
  const calls: Array<{ bin: string; args: string[] }> = [];
  const run: ProbeRunner = async (bin, args) => {
    calls.push({ bin, args });
    return handler?.(bin, args) ?? fail();
  };
  return { run, calls };
}

// Built the way buildPlan would, so executePlan's catalog-authority check passes.
function itemFor(ruleId: string, actionArgs?: Record<string, string>): PlanItem {
  const rule = RULES.get(ruleId);
  if (rule === undefined || rule.action === null) throw new Error(`test references unknown rule ${ruleId}`);
  const match: Match = {
    kind: 'virtual',
    detail: '',
    bytesAllocated: 4_000_000_000,
    bytesApparent: 4_000_000_000,
    ...(actionArgs !== undefined ? { actionArgs } : {}),
  };
  return {
    id: `${ruleId}#0`,
    ruleId,
    title: rule.title,
    category: rule.category,
    tier: rule.tier,
    action: rule.action,
    permanentOnly: rule.permanentOnly ?? false,
    needsConfirmation: rule.tier === 2 || rule.permanentOnly === true,
    ...(rule.preflight !== undefined ? { preflight: rule.preflight } : {}),
    roots: rule.roots,
    match,
  };
}

function planOf(items: PlanItem[]): CleanupPlan {
  return {
    schemaVersion: 1,
    id: 'plan-1',
    createdAt: new Date().toISOString(),
    auditGeneratedAt: new Date().toISOString(),
    items,
    manual: [],
    totals: { byTier: { 0: 0, 1: 0, 2: 0, 3: 0 }, total: 0 },
  };
}

describe('simulator actions', () => {
  it('fails a runtime deletion when simctl exits non-zero and frees nothing', async () => {
    const { run, calls } = makeRun(() => fail('Runtime is in use by a device.\n', 73));
    const item = itemFor('simulator.runtimes', { uuid: UUID });

    const result = await executePlan(planOf([item]), { apply: true, home: '/home', run });

    expect(result.results[0]?.status).toBe('failed');
    expect(result.results[0]?.reason).toBe('Runtime is in use by a device.');
    expect(result.results[0]?.freed).toBe(0);
    expect(result.freed).toBe(0);
    expect(calls).toEqual([
      { bin: 'xcrun', args: ['simctl', 'list', 'devices', 'booted', '-j'] },
      { bin: 'xcrun', args: ['simctl', 'runtime', 'delete', UUID] },
    ]);

    const timedOut = makeRun(() => fail('', 124));
    const timeoutResult = await executePlan(planOf([item]), { apply: true, home: '/home', run: timedOut.run });
    expect(timeoutResult.results[0]?.status).toBe('failed');
    expect(timeoutResult.results[0]?.reason).toBe('exit 124');
    expect(timeoutResult.results[0]?.freed).toBe(0);
  });

  it('fails unavailable-device cleanup when simctl exits non-zero and frees nothing', async () => {
    const { run, calls } = makeRun(() => fail('Unable to run simctl.\n', 1));
    const item = itemFor('simulator.devices-unavailable');

    const result = await executePlan(planOf([item]), { apply: true, home: '/home', run });

    expect(result.results[0]?.status).toBe('failed');
    expect(result.results[0]?.reason).toBe('Unable to run simctl.');
    expect(result.results[0]?.freed).toBe(0);
    expect(result.freed).toBe(0);
    expect(calls).toEqual([{ bin: 'xcrun', args: ['simctl', 'delete', 'unavailable'] }]);
  });

  it('fails when unavailable devices remain after a successful delete', async () => {
    const listing = JSON.stringify({
      devices: {
        'com.apple.CoreSimulator.SimRuntime.iOS-17-4': [
          { udid: 'D1', name: 'Stale', state: 'Shutdown', isAvailable: false, dataPathSize: 10 },
        ],
      },
    });
    const { run } = makeRun((_bin, args) => (args.includes('delete') ? ok() : ok(listing)));
    const item = itemFor('simulator.devices-unavailable');

    const result = await executePlan(planOf([item]), { apply: true, home: '/home', run });

    expect(result.results[0]?.status).toBe('failed');
    expect(result.results[0]?.reason).toBe('unavailable simulator devices remain after delete');
    expect(result.results[0]?.freed).toBe(0);
  });
});
