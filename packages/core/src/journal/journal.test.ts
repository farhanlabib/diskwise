import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { JournalRecord } from '../types';
import { lastAppliedRunId, listRuns, openJournal, readRun } from './journal';

const dirs: string[] = [];

async function makeDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'diskwise-journal-'));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function intent(runId: string, itemId: string, at = '2026-01-01T00:00:00.000Z'): JournalRecord {
  return { type: 'intent', runId, at, itemId, ruleId: 'rule', action: 'trash-path' };
}

function start(runId: string, at: string, apply: boolean, itemCount = 1): JournalRecord {
  return { type: 'run-start', runId, planId: `plan-${runId}`, at, apply, itemCount };
}

function result(
  runId: string,
  itemId: string,
  overrides: Partial<Extract<JournalRecord, { type: 'result' }>['result']> = {},
): JournalRecord {
  return {
    type: 'result',
    runId,
    at: '2026-01-01T00:00:01.000Z',
    result: {
      itemId,
      ruleId: 'rule',
      action: 'trash-path',
      status: 'done',
      bytesBefore: 100,
      bytesAfter: 0,
      freed: 100,
      restorable: true,
      ...overrides,
    },
  };
}

function toJsonl(records: JournalRecord[]): string {
  return records.map((record) => `${JSON.stringify(record)}\n`).join('');
}

describe('openJournal', () => {
  it('round-trips records in order under concurrent appends', async () => {
    const dir = await makeDir();
    const journal = await openJournal({ dir, lockPath: join(dir, 'lock'), runId: 'run-1' });

    const records = Array.from({ length: 20 }, (_, i) => intent('run-1', `item-${i}`));
    await Promise.all(records.map((record) => journal.append(record)));
    await journal.close();

    const read = await readRun(dir, 'run-1');
    expect(read).toHaveLength(20);
    expect(read.map((record) => (record.type === 'intent' ? record.itemId : ''))).toEqual(
      records.map((record) => (record.type === 'intent' ? record.itemId : '')),
    );
  });

  it('creates the journal file with mode 0o600', async () => {
    const dir = await makeDir();
    const journal = await openJournal({ dir, lockPath: join(dir, 'lock'), runId: 'mode-1' });
    await journal.append(intent('mode-1', 'a'));
    await journal.close();

    const info = await stat(join(dir, 'mode-1.jsonl'));
    expect(info.mode & 0o777).toBe(0o600);
  });
});

describe('readRun', () => {
  it('skips a malformed trailing line after a crash', async () => {
    const dir = await makeDir();
    await writeFile(join(dir, 'run-2.jsonl'), `${JSON.stringify(intent('run-2', 'a'))}\n{"type":"res`);

    const read = await readRun(dir, 'run-2');
    expect(read).toHaveLength(1);
  });

  it('rejects a runId containing ../', async () => {
    const dir = await makeDir();
    await expect(readRun(dir, '../evil')).rejects.toThrow(/invalid run id/);
  });
});

describe('listRuns', () => {
  it('computes freed, restorableCount and flags a crash as incomplete', async () => {
    const dir = await makeDir();
    await writeFile(
      join(dir, 'run-3.jsonl'),
      toJsonl([
        start('run-3', '2026-01-01T00:00:00.000Z', true, 2),
        intent('run-3', 'item-a'),
        result('run-3', 'item-a'),
        { type: 'run-end', runId: 'run-3', at: '2026-01-01T00:00:02.000Z', freed: 100 },
      ]),
    );
    await writeFile(
      join(dir, 'run-4.jsonl'),
      toJsonl([start('run-4', '2026-01-02T00:00:00.000Z', true, 1), intent('run-4', 'item-b')]),
    );

    const runs = await listRuns(dir);
    const r3 = runs.find((run) => run.runId === 'run-3');
    const r4 = runs.find((run) => run.runId === 'run-4');

    expect(r3?.freed).toBe(100);
    expect(r3?.restorableCount).toBe(1);
    expect(r3?.incomplete).toBe(false);
    expect(r4?.incomplete).toBe(true);
  });

  it('sorts newest first and skips files without a run-start', async () => {
    const dir = await makeDir();
    await writeFile(join(dir, 'a.jsonl'), toJsonl([start('a', '2026-01-01T00:00:00.000Z', false)]));
    await writeFile(join(dir, 'b.jsonl'), toJsonl([start('b', '2026-02-01T00:00:00.000Z', false)]));
    await writeFile(join(dir, 'orphan.jsonl'), toJsonl([intent('orphan', 'x')]));

    const runs = await listRuns(dir);
    expect(runs.map((run) => run.runId)).toEqual(['b', 'a']);
  });

  it('returns [] for a missing directory', async () => {
    const dir = await makeDir();
    expect(await listRuns(join(dir, 'nope'))).toEqual([]);
  });
});

describe('lastAppliedRunId', () => {
  it('finds the newest applied run, skipping dry runs', async () => {
    const dir = await makeDir();
    await writeFile(
      join(dir, 'dry.jsonl'),
      toJsonl([start('dry', '2026-03-01T00:00:00.000Z', false)]),
    );
    await writeFile(
      join(dir, 'applied.jsonl'),
      toJsonl([start('applied', '2026-02-01T00:00:00.000Z', true)]),
    );

    expect(await lastAppliedRunId(dir)).toBe('applied');
  });
});
