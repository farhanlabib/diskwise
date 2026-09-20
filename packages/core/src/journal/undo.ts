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

// Restores a run's Trash moves.
//
// Recovery contract: an item is recoverable when the journal holds either a
// result record with a destination, or an intent plus a `trash-destination`
// record. An intent on its own means the run stopped mid-action with no
// destination written, so that item is reported as `unknown-outcome` and is
// never touched on disk - diskwise cannot know whether the action happened.
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
    const destinations = new Map<string, string>();
    const intents = new Map<string, { path?: string }>();
    for (const record of records) {
      if (record.type === 'undo') undone.add(record.itemId);
      else if (record.type === 'trash-destination') destinations.set(record.itemId, record.trashedPath);
      else if (record.type === 'intent') {
        intents.set(record.itemId, record.path !== undefined ? { path: record.path } : {});
      }
    }

    const byPath = join(opts.dir, `${opts.runId}.jsonl`);
    const results: UndoItemResult[] = [];
    const completed = new Set<string>();
    for (const record of records) {
      if (record.type !== 'result') continue;
      completed.add(record.result.itemId);
      if (record.result.status !== 'done' || undone.has(record.result.itemId)) continue;

      // A recovery record outlives a lost result, so prefer it when present.
      const trashedPath = destinations.get(record.result.itemId) ?? record.result.trashedPath;
      const entry = await undoItem({ ...record.result, trashedPath });
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

    // An intent with no result means the run stopped mid-action. Report it
    // rather than skipping it, and restore it when the destination survived.
    for (const [itemId, intent] of intents) {
      if (completed.has(itemId) || undone.has(itemId)) continue;
      const trashedPath = destinations.get(itemId);
      if (trashedPath === undefined) {
        results.push({
          itemId,
          ...(intent.path !== undefined ? { path: intent.path } : {}),
          status: 'unknown-outcome',
          reason:
            'The run stopped before the outcome was written, so diskwise cannot tell whether this item was removed.',
        });
        continue;
      }
      if (intent.path === undefined) {
        results.push({
          itemId,
          status: 'unknown-outcome',
          reason: 'The item reached the Trash, but its original location was not recorded.',
        });
        continue;
      }

      const entry = await undoItem({
        itemId,
        ruleId: '',
        action: 'trash-path',
        status: 'done',
        bytesBefore: 0,
        bytesAfter: 0,
        freed: 0,
        restorable: true,
        path: intent.path,
        trashedPath,
      });
      if (entry.status === 'restored') {
        await appendUndo(byPath, {
          type: 'undo',
          runId: opts.runId,
          at: now().toISOString(),
          itemId,
          restoredPath: intent.path,
        });
      }
      results.push(entry);
    }

    return results;
  } finally {
    await release();
  }
}
