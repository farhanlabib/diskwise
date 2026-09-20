import { mkdir, mkdtemp, readdir, realpath, rm, writeFile, rename, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { executePlan } from '../execute/execute';
import { openJournal } from '../journal/journal';
import { undoRun } from '../journal/undo';
import type { AppReport } from '../types';
import { buildAppPlan } from './plan';

describe('buildAppPlan', () => {
  let home: string;
  let report: AppReport;

  beforeAll(async () => {
    home = await realpath(await mkdtemp(join(tmpdir(), 'diskwise-appplan-')));
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
        {
          kind: 'caches',
          tier: 0,
          state: 'cleanable',
          path: caches,
          bytesAllocated: 100_000,
          source: 'generic',
        },
        {
          kind: 'app-data',
          tier: 2,
          state: 'reportOnly',
          path: data,
          bytesAllocated: 4096,
          source: 'generic',
        },
      ],
      totals: { cleanable: 100_000, data: 4096, all: 104_096 },
    };
  });

  afterAll(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it('only plans cleanable locations and never app data', async () => {
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

  // A mixed orphan report: tier 0 caches plus tier 2 Application Support data.
  // The data is deletableWithConfirmation, so it must never sit in the
  // cleanable total or be planned without the explicit opt-in.
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
        state: 'cleanable',
        path: join(home, 'Library/Caches/com.test.chat'),
        bytesAllocated: 100_000,
        source: 'generic',
      },
      {
        kind: 'app-data',
        tier: 2,
        state: 'deletableWithConfirmation',
        path: join(home, 'Library/Application Support/Chat'),
        bytesAllocated: 4096,
        source: 'generic',
      },
    ],
    totals: { cleanable: 100_000, data: 4096, all: 104_096 },
  });

  it('keeps orphaned app data out of the cleanable total', () => {
    const orphan = orphanReport();
    expect(orphan.totals.cleanable).toBe(100_000);
    expect(orphan.totals.cleanable).not.toBe(orphan.totals.all);
    expect(orphan.locations.find((l) => l.state === 'deletableWithConfirmation')?.tier).toBe(2);
  });

  it('plans only cleanable locations for an orphan without includeOrphanData', async () => {
    const plan = await buildAppPlan(orphanReport());
    expect(plan.items.map((i) => i.ruleId)).toEqual(['app.caches']);
    expect(plan.items[0]?.preflight).toBeUndefined();
    expect(plan.totals.total).toBe(100_000);
  });

  it('plans orphan app data as a trashed, confirmed item when asked', async () => {
    const plan = await buildAppPlan(orphanReport(), { includeOrphanData: true });
    const dataItem = plan.items.find((i) => i.ruleId === 'app.orphaned-data');
    expect(dataItem?.action).toBe('trash-path');
    expect(dataItem?.needsConfirmation).toBe(true);
    expect(dataItem?.tier).toBe(2);
    expect(dataItem?.preflight).toBeUndefined();
  });

  it('plans a data-only Trash flow when caches are excluded', async () => {
    const plan = await buildAppPlan(orphanReport(), {
      includeCleanable: false,
      includeOrphanData: true,
    });
    expect(plan.items.map((i) => i.ruleId)).toEqual(['app.orphaned-data']);
    expect(plan.items[0]?.action).toBe('trash-path');
    expect(plan.items[0]?.needsConfirmation).toBe(true);
    expect(plan.totals.total).toBe(4096);
  });

  it('never plans app data for an installed app, even with includeOrphanData', async () => {
    const plan = await buildAppPlan(report, { includeOrphanData: true });
    expect(plan.items.map((i) => i.ruleId)).toEqual(['app.caches']);
  });

  it('cleans orphan caches without selecting orphaned user data', async () => {
    const plan = await buildAppPlan(orphanReport());
    const result = await executePlan(plan, { apply: true, home, runningBundleIds: async () => [] });
    expect(result.results.map((r) => r.ruleId)).toEqual(['app.caches']);
    expect(result.results[0]?.status).toBe('done');
    expect(await readdir(join(home, 'Library/Application Support/Chat'))).toEqual(['messages.db']);
  });

  it('skips orphaned app data without the typed confirmation', async () => {
    const plan = await buildAppPlan(orphanReport(), { includeOrphanData: true });
    const result = await executePlan(plan, { apply: true, home, runningBundleIds: async () => [] });
    const dataResult = result.results.find((r) => r.ruleId === 'app.orphaned-data');
    expect(dataResult?.status).toBe('skipped');
    expect(await readdir(join(home, 'Library/Application Support/Chat'))).toEqual(['messages.db']);
  });

  it('trashes orphaned app data with the typed confirmation and keeps undo', async () => {
    const journalDir = await mkdtemp(join(tmpdir(), 'diskwise-appplan-journal-'));
    const trashDir = join(journalDir, 'trash');
    await mkdir(trashDir, { recursive: true });
    const lockPath = join(journalDir, 'lock');
    const journal = await openJournal({ dir: journalDir, lockPath });
    try {
      const plan = await buildAppPlan(orphanReport(), { includeOrphanData: true });
      const result = await executePlan(plan, {
        apply: true,
        home,
        runningBundleIds: async () => [],
        confirmedRuleIds: ['app.orphaned-data'],
        journal,
        trash: async (path) => {
          const trashedPath = join(trashDir, 'item');
          await rename(path, trashedPath);
          return { trashedPath };
        },
      });
      const dataResult = result.results.find((r) => r.ruleId === 'app.orphaned-data');
      expect(dataResult?.status).toBe('done');
      expect(dataResult?.restorable).toBe(true);
      await expect(
        lstat(join(home, 'Library/Application Support/Chat')),
      ).rejects.toMatchObject({ code: 'ENOENT' });

      // The journal holds the lock until it closes; undo needs that lock.
      await journal.close();
      const undone = await undoRun({ dir: journalDir, lockPath, runId: result.runId! });
      // The plan also cleans orphan caches, which are removed, not trashed.
      expect(undone.map((u) => u.status)).toEqual(['not-restorable', 'restored']);
      expect(await readdir(join(home, 'Library/Application Support/Chat'))).toEqual([
        'messages.db',
      ]);
    } finally {
      await rm(journalDir, { recursive: true, force: true });
    }
  });
});
