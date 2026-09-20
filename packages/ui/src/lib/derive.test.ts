import { describe, expect, it } from 'vitest';
import type { AppLocation, AppReport, AuditResult, Finding, RunSummary } from '@diskwise/core/types';
import {
  appGroupsFromReport,
  appsFromReports,
  historyFromRuns,
  overviewFromAudit,
  unmeasuredFromAudit,
} from './derive';

const GB = 1_000_000_000;

function finding(over: Partial<Finding> = {}): Finding {
  return {
    ruleId: 'xcode.derived-data',
    title: 'Xcode DerivedData',
    category: 'dev',
    tier: 0,
    rationale: '',
    regeneration: 'Rebuilds on the next build.',
    action: 'remove-dir-contents',
    needsRoot: false,
    permanentOnly: false,
    matches: [],
    totals: { allocated: 1 * GB, apparent: 1 * GB },
    ...over,
  };
}

function audit(over: Partial<AuditResult> = {}): AuditResult {
  return {
    schemaVersion: 1,
    generatedAt: '2026-01-01T00:00:00.000Z',
    findings: [],
    traps: [],
    unreadable: [],
    totals: { byTier: { 0: 0, 1: 0, 2: 0, 3: 0 }, reclaimable: 0 },
    ...over,
  };
}

function disk(containerUsed: number, containerFree: number): AuditResult['disk'] {
  return {
    mountPoint: '/System/Volumes/Data',
    volumeName: 'Macintosh HD',
    containerTotal: containerUsed + containerFree,
    containerUsed,
    containerFree,
    volumeUsed: containerUsed,
    caseSensitive: false,
  };
}

function location(over: Partial<AppLocation> = {}): AppLocation {
  return {
    kind: 'caches',
    tier: 0,
    state: 'cleanable',
    path: '~/Library/Caches/com.example',
    bytesAllocated: 100,
    source: 'generic',
    ...over,
  };
}

function report(over: Partial<AppReport> = {}): AppReport {
  return {
    app: {
      bundleId: 'com.example.app',
      name: 'Example',
      version: '1.2.3',
      path: '/Applications/Example.app',
      running: false,
      bundleBytes: 10,
      system: false,
    },
    locations: [],
    totals: { cleanable: 100, data: 0, all: 100 },
    ...over,
  };
}

function run(over: Partial<RunSummary> = {}): RunSummary {
  return {
    runId: 'run-1',
    planId: 'plan-1',
    startedAt: '2026-01-01T00:00:00.000Z',
    apply: true,
    itemCount: 1,
    freed: 0,
    restorableCount: 0,
    incomplete: false,
    ...over,
  };
}

describe('overviewFromAudit', () => {
  it('decomposes the disk and clamps unmeasured at zero', () => {
    const result = overviewFromAudit(
      audit({
        disk: disk(10 * GB, 20 * GB),
        findings: [
          finding({ category: 'dev', tier: 0, totals: { allocated: 2 * GB, apparent: 2 * GB } }),
          finding({ category: 'browser', tier: 1, totals: { allocated: 1 * GB, apparent: 1 * GB } }),
          finding({ category: 'user-data', tier: 2, totals: { allocated: 1 * GB, apparent: 1 * GB } }),
        ],
      }),
    );

    expect(result.segments.map((segment) => segment.id)).toEqual([
      'dev',
      'caches',
      'data',
      'system',
      'leftovers',
      'unmeasured',
      'free',
    ]);
    expect(result.segments.find((segment) => segment.id === 'unmeasured')?.sizeGb).toBe(6);
    expect(result.segments.find((segment) => segment.id === 'free')?.sizeGb).toBe(20);
  });

  it('never reports negative unmeasured bytes when findings exceed the used total', () => {
    const result = overviewFromAudit(
      audit({
        disk: disk(1 * GB, 1 * GB),
        findings: [finding({ totals: { allocated: 5 * GB, apparent: 5 * GB } })],
      }),
    );

    expect(result.segments.find((segment) => segment.id === 'unmeasured')?.sizeGb).toBe(0);
    expect(unmeasuredFromAudit(audit({ disk: disk(0, 0) }))).toBe(0);
  });

  it('omits segments without disk info and lists the five largest actionable findings', () => {
    const result = overviewFromAudit(
      audit({
        findings: [
          finding({ ruleId: 'small', totals: { allocated: 1 * GB, apparent: 1 * GB } }),
          finding({ ruleId: 'never', tier: 3, totals: { allocated: 99 * GB, apparent: 99 * GB } }),
          finding({ ruleId: 'manual', action: null, totals: { allocated: 98 * GB, apparent: 98 * GB } }),
          ...Array.from({ length: 6 }, (_, index) =>
            finding({
              ruleId: `big-${index}`,
              totals: { allocated: (index + 2) * GB, apparent: (index + 2) * GB },
            }),
          ),
        ],
      }),
    );

    expect(result.segments).toEqual([]);
    expect(result.largest).toHaveLength(5);
    expect(result.largest.map((win) => win.ruleId)).toEqual([
      'big-5',
      'big-4',
      'big-3',
      'big-2',
      'big-1',
    ]);
  });
});

describe('appsFromReports', () => {
  const now = Date.parse('2026-06-10T12:00:00.000Z');

  it('labels last-used dates and reads the classified totals', () => {
    const apps = appsFromReports(
      [
        report({
          app: {
            ...report().app,
            name: '',
            version: undefined,
            lastUsed: '2026-06-10T08:00:00.000Z',
            running: true,
          },
          orphaned: true,
          totals: { cleanable: 300, data: 1_200, all: 1_500 },
        }),
      ],
      now,
    );

    expect(apps[0]).toMatchObject({
      id: 'com.example.app',
      initial: '?',
      version: '—',
      lastUsed: 'today',
      running: true,
      orphan: true,
      knownProfile: false,
      cachesBytes: 300,
      appDataBytes: 1_200,
      totalBytes: 1_500,
    });
  });

  it('maps older and unparseable timestamps', () => {
    const apps = appsFromReports(
      [
        report({ app: { ...report().app, lastUsed: '2026-06-09T12:00:00.000Z' } }),
        report({ app: { ...report().app, lastUsed: '2026-05-01T12:00:00.000Z' } }),
        report({ app: { ...report().app, lastUsed: 'not-a-date' } }),
        report({ app: { ...report().app, lastUsed: undefined }, profileId: 'slack' }),
      ],
      now,
    );

    expect(apps.map((entry) => entry.lastUsed)).toEqual(['yesterday', '40 days ago', 'unknown', 'unknown']);
    expect(apps[3]?.knownProfile).toBe(true);
  });
});

describe('appGroupsFromReport', () => {
  it('maps the three location states onto the five UI actions', () => {
    const groups = appGroupsFromReport(
      report({
        locations: [
          location({ state: 'cleanable' }),
          location({ kind: 'app-data', tier: 2, state: 'deletableWithConfirmation' }),
          location({ kind: 'sign-in-data', tier: 2, state: 'reportOnly' }),
          location({ kind: 'app-data', tier: 2, state: 'reportOnly' }),
          location({ kind: 'settings', tier: 3, state: 'reportOnly' }),
        ],
      }),
    );

    expect(groups.map((group) => group.action)).toEqual([
      'clean',
      'trash',
      'report',
      'finder',
      'protected',
    ]);
    expect(groups[0]?.name).toBe('Caches');
    expect(groups[1]?.note).toContain('move it to the Trash');
  });
});

describe('historyFromRuns', () => {
  it('marks runs undoable only when there is something to restore', () => {
    const rows = historyFromRuns([
      run({ runId: 'a', restorableCount: 2 }),
      run({ runId: 'b', restorableCount: 0 }),
      run({ runId: 'c', restorableCount: 3, incomplete: true }),
    ]);

    expect(rows.map((row) => row.undoable)).toEqual([true, false, false]);
    expect(rows[1]?.reason).toBe('Nothing to restore');
    expect(rows[2]?.reason).toBe('Run incomplete');
  });
});
