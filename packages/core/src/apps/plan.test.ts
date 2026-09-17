import { mkdir, mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { executePlan } from '../execute/execute';
import type { AppReport } from '../types';
import { buildAppPlan } from './plan';

describe('buildAppPlan', () => {
  let home: string;
  let report: AppReport;

  beforeAll(async () => {
    home = await realpath(await mkdtemp(join(tmpdir(), 'macsweep-appplan-')));
    const caches = join(home, 'Library/Caches/com.test.chat');
    const data = join(home, 'Library/Application Support/Chat');
    await mkdir(caches, { recursive: true });
    await mkdir(data, { recursive: true });
    await writeFile(join(caches, 'blob'), Buffer.alloc(100_000, 1));
    await writeFile(join(data, 'messages.db'), 'keep me');
    report = {
      app: {
        bundleId: 'com.test.chat',
        name: 'Chat',
        path: '/Applications/Chat.app',
        running: false,
        bundleBytes: 0,
        system: false,
      },
      locations: [
        { kind: 'caches', tier: 0, actionable: true, path: caches, bytesAllocated: 100_000, source: 'generic' },
        { kind: 'app-data', tier: 2, actionable: false, path: data, bytesAllocated: 4096, source: 'generic' },
      ],
      totals: { cleanable: 100_000, data: 4096, all: 104_096 },
    };
  });

  afterAll(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it('only plans actionable locations and never app data', async () => {
    const plan = await buildAppPlan(report);
    expect(plan.items.map((i) => i.action)).toEqual(['remove-dir-contents']);
    expect(plan.items[0]?.preflight?.apps).toEqual([{ bundleId: 'com.test.chat', name: 'Chat' }]);
  });

  it('refuses to clean while the app is running, and fails closed without the helper', async () => {
    const plan = await buildAppPlan(report);
    const running = await executePlan(plan, {
      apply: true,
      home,
      runningBundleIds: async () => ['com.test.chat'],
    });
    expect(running.results[0]?.reason).toBe('blocked: Chat is running');
    const unknown = await executePlan(plan, {
      apply: true,
      home,
      runningBundleIds: async () => {
        throw new Error('HELPER_MISSING');
      },
    });
    expect(unknown.results[0]?.status).toBe('skipped');
  });

  it('empties caches but keeps the folder and the app data when the app is closed', async () => {
    const plan = await buildAppPlan(report);
    const result = await executePlan(plan, { apply: true, home, runningBundleIds: async () => [] });
    expect(result.results[0]?.status).toBe('done');
    expect(await readdir(join(home, 'Library/Caches/com.test.chat'))).toEqual([]);
    expect(await readdir(join(home, 'Library/Application Support/Chat'))).toEqual(['messages.db']);
  });

  const orphanReport = (): AppReport => ({
    orphaned: true,
    app: {
      bundleId: 'com.test.chat',
      name: 'com.test.chat',
      path: '',
      running: false,
      bundleBytes: 0,
      system: false,
    },
    locations: [
      {
        kind: 'caches',
        tier: 0,
        actionable: true,
        path: join(home, 'Library/Caches/com.test.chat'),
        bytesAllocated: 100_000,
        source: 'generic',
      },
      {
        kind: 'app-data',
        tier: 2,
        actionable: true,
        path: join(home, 'Library/Application Support/Chat'),
        bytesAllocated: 4096,
        source: 'generic',
      },
    ],
    totals: { cleanable: 104_096, data: 0, all: 104_096 },
  });

  it('plans only cleanable locations for an orphan without includeOrphanData', async () => {
    const plan = await buildAppPlan(orphanReport());
    expect(plan.items.map((i) => i.ruleId)).toEqual(['app.caches']);
    expect(plan.items[0]?.preflight).toBeUndefined();
  });

  it('plans orphan app data as a trashed, confirmed item when asked', async () => {
    const plan = await buildAppPlan(orphanReport(), { includeOrphanData: true });
    const dataItem = plan.items.find((i) => i.ruleId === 'app.orphaned-data');
    expect(dataItem?.action).toBe('trash-path');
    expect(dataItem?.needsConfirmation).toBe(true);
    expect(dataItem?.tier).toBe(2);
    expect(dataItem?.preflight).toBeUndefined();
  });

  it('never plans app data for an installed app, even with includeOrphanData', async () => {
    const plan = await buildAppPlan(report, { includeOrphanData: true });
    expect(plan.items.map((i) => i.ruleId)).toEqual(['app.caches']);
  });
});
