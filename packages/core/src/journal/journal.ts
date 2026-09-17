import { randomBytes } from 'node:crypto';
import { mkdir, open, readFile, readdir } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import type { JournalRecord, JournalWriter, RunSummary } from '../types';
import { acquireLock } from './lock';

const RUN_ID_RE = /^[0-9A-Za-z-]+$/;
const SUFFIX = '.jsonl';

function compactTimestamp(now: Date): string {
  return now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

function makeRunId(now: Date): string {
  return `${compactTimestamp(now)}-${randomBytes(3).toString('hex')}`;
}

function parseRecords(raw: string): JournalRecord[] {
  const records: JournalRecord[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      records.push(JSON.parse(trimmed) as JournalRecord);
    } catch {
      // A crash can truncate the final line; drop anything that will not parse.
    }
  }
  return records;
}

export async function openJournal(opts: {
  dir: string;
  lockPath: string;
  runId?: string;
  now?: () => Date;
}): Promise<JournalWriter> {
  const now = opts.now ?? (() => new Date());
  const runId = opts.runId ?? makeRunId(now());
  const release = await acquireLock(opts.lockPath);

  let fh: FileHandle;
  try {
    await mkdir(opts.dir, { recursive: true, mode: 0o700 });
    fh = await open(join(opts.dir, `${runId}${SUFFIX}`), 'a', 0o600);
  } catch (err) {
    await release();
    throw err;
  }

  let chain: Promise<void> = Promise.resolve();
  let closing: Promise<void> | undefined;

  return {
    runId,
    append(record: JournalRecord): Promise<void> {
      const next = chain.then(async () => {
        await fh.writeFile(`${JSON.stringify(record)}\n`);
        await fh.datasync();
      });
      chain = next.catch(() => undefined);
      return next;
    },
    close(): Promise<void> {
      closing ??= (async () => {
        await chain.catch(() => undefined);
        await fh.close();
        await release();
      })();
      return closing;
    },
  };
}

export async function readRun(dir: string, runId: string): Promise<JournalRecord[]> {
  if (!RUN_ID_RE.test(runId)) {
    throw new Error(`invalid run id: ${runId}`);
  }
  const raw = await readFile(join(dir, `${runId}${SUFFIX}`), 'utf8');
  return parseRecords(raw);
}

function summarize(runId: string, records: JournalRecord[]): RunSummary | undefined {
  const start = records.find((r) => r.type === 'run-start');
  if (!start) return undefined;
  const end = records.find((r) => r.type === 'run-end');

  const undone = new Set<string>();
  const intents = new Set<string>();
  const results = new Set<string>();
  for (const record of records) {
    if (record.type === 'undo') undone.add(record.itemId);
    else if (record.type === 'intent') intents.add(record.itemId);
    else if (record.type === 'result') results.add(record.result.itemId);
  }

  let restorableCount = 0;
  for (const record of records) {
    if (
      record.type === 'result' &&
      record.result.status === 'done' &&
      record.result.restorable &&
      !undone.has(record.result.itemId)
    ) {
      restorableCount += 1;
    }
  }

  return {
    runId,
    planId: start.planId,
    startedAt: start.at,
    endedAt: end?.at,
    apply: start.apply,
    itemCount: start.itemCount,
    freed: end?.freed ?? 0,
    restorableCount,
    incomplete: [...intents].some((itemId) => !results.has(itemId)),
  };
}

export async function listRuns(dir: string): Promise<RunSummary[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }

  const summaries: RunSummary[] = [];
  for (const name of names) {
    if (!name.endsWith(SUFFIX)) continue;
    const runId = name.slice(0, -SUFFIX.length);
    if (!RUN_ID_RE.test(runId)) continue;
    const records = parseRecords(await readFile(join(dir, name), 'utf8'));
    const summary = summarize(runId, records);
    if (summary) summaries.push(summary);
  }

  summaries.sort((a, b) => (a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0));
  return summaries;
}

export async function lastAppliedRunId(dir: string): Promise<string | undefined> {
  const runs = await listRuns(dir);
  return runs.find((run) => run.apply)?.runId;
}
