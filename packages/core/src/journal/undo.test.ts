import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { ItemResult, JournalRecord } from '../types';
import { listRuns } from './journal';
import { undoRun } from './undo';

const dirs: string[] = [];

async function makeDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'diskwise-undo-'));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function resultRecord(itemId: string, result: Partial<ItemResult>): JournalRecord {
  return {
    type: 'result',
    runId: 'run-u',
    at: '2026-01-01T00:00:01.000Z',
    result: {
      itemId,
      ruleId: 'rule',
      action: 'trash-path',
      status: 'done',
      bytesBefore: 10,
      bytesAfter: 0,
      freed: 10,
      restorable: true,
      ...result,
    },
  };
}

describe('undoRun', () => {
  it('restores, reports each failure mode, skips non-done items, and is repeat-safe', async () => {
    const dir = await makeDir();
    const trash = join(dir, 'trash');
    await mkdir(trash);

    const orig1 = join(dir, 'orig1.txt');
    const trash1 = join(trash, 'orig1.txt');
    await writeFile(orig1, 'hello');
    await rename(orig1, trash1);

    const orig4 = join(dir, 'orig4.txt');
    const trash4 = join(trash, 'orig4.txt');
    await writeFile(orig4, 'something new');
    await writeFile(trash4, 'old');

    const runId = 'run-u';
    const records: JournalRecord[] = [
      {
        type: 'run-start',
        runId,
        planId: 'plan-u',
        at: '2026-01-01T00:00:00.000Z',
        apply: true,
        itemCount: 5,
      },
      resultRecord('item-1', { path: orig1, trashedPath: trash1 }),
      resultRecord('item-2', {
        path: join(dir, 'orig2.txt'),
        trashedPath: join(trash, 'orig2.txt'),
        restorable: false,
      }),
      resultRecord('item-3', {
        path: join(dir, 'orig3.txt'),
        trashedPath: join(trash, 'missing.txt'),
      }),
      resultRecord('item-4', { path: orig4, trashedPath: trash4 }),
      resultRecord('item-5', { status: 'skipped' }),
    ];
    await writeFile(
      join(dir, `${runId}.jsonl`),
      records.map((record) => `${JSON.stringify(record)}\n`).join(''),
    );

    const before = await listRuns(dir);
    expect(before.find((run) => run.runId === runId)?.restorableCount).toBe(3);

    const released = await undoRun({ dir, lockPath: join(dir, 'lock'), runId });

    expect(released.map((entry) => entry.itemId)).toEqual(['item-1', 'item-2', 'item-3', 'item-4']);
    const byId = new Map(released.map((entry) => [entry.itemId, entry]));
    expect(byId.get('item-1')?.status).toBe('restored');
    expect(byId.get('item-2')?.status).toBe('not-restorable');
    expect(byId.get('item-3')?.status).toBe('missing-from-trash');
    expect(byId.get('item-4')?.status).toBe('destination-exists');

    expect(await readFile(orig1, 'utf8')).toBe('hello');

    const after = await listRuns(dir);
    expect(after.find((run) => run.runId === runId)?.restorableCount).toBe(2);

    const second = await undoRun({ dir, lockPath: join(dir, 'lock'), runId });
    expect(second.some((entry) => entry.itemId === 'item-1')).toBe(false);
    expect(await readFile(orig1, 'utf8')).toBe('hello');
  });

  it('recovers an interrupted Trash move from its destination record', async () => {
    const dir = await makeDir();
    const trash = join(dir, 'trash');
    await mkdir(trash);

    const orig = join(dir, 'orig.txt');
    const trashed = join(trash, 'orig.txt');
    await writeFile(orig, 'hello');
    await rename(orig, trashed);

    const runId = 'run-recover';
    const records: JournalRecord[] = [
      {
        type: 'run-start',
        runId,
        planId: 'plan-r',
        at: '2026-01-01T00:00:00.000Z',
        apply: true,
        itemCount: 1,
      },
      {
        type: 'intent',
        runId,
        at: '2026-01-01T00:00:01.000Z',
        itemId: 'item-1',
        ruleId: 'ios.backups',
        action: 'trash-path',
        path: orig,
      },
      {
        type: 'trash-destination',
        runId,
        at: '2026-01-01T00:00:02.000Z',
        itemId: 'item-1',
        trashedPath: trashed,
      },
    ];
    await writeFile(
      join(dir, `${runId}.jsonl`),
      records.map((record) => `${JSON.stringify(record)}\n`).join(''),
    );

    expect((await listRuns(dir)).find((run) => run.runId === runId)?.incomplete).toBe(true);

    const undone = await undoRun({ dir, lockPath: join(dir, 'lock'), runId });

    expect(undone).toEqual([expect.objectContaining({ itemId: 'item-1', status: 'restored' })]);
    expect(await readFile(orig, 'utf8')).toBe('hello');
  });

  it('reports interrupted items with no recoverable destination as unknown-outcome', async () => {
    const dir = await makeDir();
    const orig = join(dir, 'orig.txt');
    await writeFile(orig, 'hello');

    const runId = 'run-unknown';
    const records: JournalRecord[] = [
      {
        type: 'run-start',
        runId,
        planId: 'plan-u2',
        at: '2026-01-01T00:00:00.000Z',
        apply: true,
        itemCount: 2,
      },
      {
        type: 'intent',
        runId,
        at: '2026-01-01T00:00:01.000Z',
        itemId: 'item-1',
        ruleId: 'xcode.derived-data',
        action: 'remove-path',
        path: orig,
      },
      {
        type: 'intent',
        runId,
        at: '2026-01-01T00:00:02.000Z',
        itemId: 'item-2',
        ruleId: 'ios.backups',
        action: 'trash-path',
      },
      {
        type: 'trash-destination',
        runId,
        at: '2026-01-01T00:00:03.000Z',
        itemId: 'item-2',
        trashedPath: join(dir, 'trash', 'x'),
      },
    ];
    await writeFile(
      join(dir, `${runId}.jsonl`),
      records.map((record) => `${JSON.stringify(record)}\n`).join(''),
    );

    const undone = await undoRun({ dir, lockPath: join(dir, 'lock'), runId });
    const byId = new Map(undone.map((entry) => [entry.itemId, entry]));

    expect(byId.get('item-1')?.status).toBe('unknown-outcome');
    expect(byId.get('item-2')?.status).toBe('unknown-outcome');
    expect(await readFile(orig, 'utf8')).toBe('hello');
  });
});
