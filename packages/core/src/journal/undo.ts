import { lstat, mkdir, open, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ItemResult, JournalRecord, UndoItemResult } from '../types';
import { readRun } from './journal';
import { acquireLock } from './lock';

function codeOf(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | undefined)?.code;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function undoItem(result: ItemResult): Promise<UndoItemResult> {
  const { itemId, path, trashedPath } = result;

  if (!result.restorable) {
    return {
      itemId,
      path,
      status: 'not-restorable',
      reason: 'Deleted permanently. It regenerates or re-downloads, so there is nothing to restore.',
    };
  }
  if (!trashedPath || !path) {
    return { itemId, path, status: 'not-restorable' };
  }

  try {
    await lstat(trashedPath);
  } catch (err) {
    if (codeOf(err) === 'ENOENT') {
      return { itemId, path, status: 'missing-from-trash', reason: 'The Trash was emptied' };
    }
    return { itemId, path, status: 'failed', reason: messageOf(err) };
  }

  try {
    await lstat(path);
    return {
      itemId,
      path,
      status: 'destination-exists',
      reason: 'Something new already exists at the original location',
    };
  } catch (err) {
    if (codeOf(err) !== 'ENOENT') {
      return { itemId, path, status: 'failed', reason: messageOf(err) };
    }
  }

  try {
    await mkdir(dirname(path), { recursive: true });
    await rename(trashedPath, path);
  } catch (err) {
    return { itemId, path, status: 'failed', reason: messageOf(err) };
  }

  return { itemId, path, status: 'restored' };
}

async function appendUndo(path: string, record: JournalRecord): Promise<void> {
  const fh = await open(path, 'a', 0o600);
  try {
    await fh.writeFile(`${JSON.stringify(record)}\n`);
    await fh.datasync();
  } finally {
    await fh.close();
  }
}

export async function undoRun(opts: {
  dir: string;
  lockPath: string;
  runId: string;
  now?: () => Date;
}): Promise<UndoItemResult[]> {
  const now = opts.now ?? (() => new Date());
  const release = await acquireLock(opts.lockPath);
  try {
    const records = await readRun(opts.dir, opts.runId);
    const undone = new Set<string>();
    for (const record of records) {
      if (record.type === 'undo') undone.add(record.itemId);
    }

    const byPath = join(opts.dir, `${opts.runId}.jsonl`);
    const results: UndoItemResult[] = [];
    for (const record of records) {
      if (record.type !== 'result') continue;
      if (record.result.status !== 'done' || undone.has(record.result.itemId)) continue;

      const entry = await undoItem(record.result);
      if (entry.status === 'restored' && record.result.path) {
        await appendUndo(byPath, {
          type: 'undo',
          runId: opts.runId,
          at: now().toISOString(),
          itemId: record.result.itemId,
          restoredPath: record.result.path,
        });
      }
      results.push(entry);
    }
    return results;
  } finally {
    await release();
  }
}
