import { lstat, readdir } from 'node:fs/promises';
import type { Dirent, Stats } from 'node:fs';
import { join } from 'node:path';
import type { UnreadableEntry, WalkOptions, WalkResult } from '../types';
import { isCloudPlaceholder, sizeOfStats } from './allocated-size';

const PROGRESS_INTERVAL_MS = 250;

interface DirTask {
  dir: string;
  depth: number;
}

function errorCode(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException | null | undefined)?.code;
}

export async function measure(root: string, opts: WalkOptions = {}): Promise<WalkResult> {
  const concurrency = Math.max(1, opts.concurrency ?? 32);
  const seen = opts.seen ?? new Set<string>();
  const skip = opts.skip ?? [];
  const signal = opts.signal;

  let allocated = 0;
  let apparent = 0;
  let entries = 0;
  let cloudPlaceholders = 0;
  const unreadable: UnreadableEntry[] = [];
  let truncated = false;
  let aborted = false;
  let stopped = false;
  let lastProgress = Date.now();

  const result = (): WalkResult => ({
    allocated,
    apparent,
    entries,
    unreadable,
    cloudPlaceholders,
    truncated,
    aborted,
  });

  const isSkipped = (p: string): boolean => skip.some((s) => p === s || p.startsWith(s + '/'));

  const recordError = (p: string, err: unknown): void => {
    const code = errorCode(err);
    if (code === 'EPERM' || code === 'EACCES') unreadable.push({ path: p, code });
  };

  const reportProgress = (p: string): void => {
    const cb = opts.onProgress;
    if (!cb) return;
    const now = Date.now();
    if (now - lastProgress < PROGRESS_INTERVAL_MS) return;
    lastProgress = now;
    cb({ entries, path: p });
  };

  const countEntry = (st: Stats, p: string): boolean => {
    const key = `${st.dev}:${st.ino}`;
    if (seen.has(key)) return false;
    seen.add(key);
    const size = sizeOfStats(st);
    allocated += size.allocated;
    apparent += size.apparent;
    entries += 1;
    if (isCloudPlaceholder(st, p)) cloudPlaceholders += 1;
    reportProgress(p);
    return true;
  };

  let rootStats: Stats;
  try {
    rootStats = await lstat(root);
  } catch (err) {
    if (errorCode(err) !== 'ENOENT') recordError(root, err);
    return result();
  }

  if (isSkipped(root)) return result();

  const rootDev = rootStats.dev;

  if (!rootStats.isDirectory()) {
    countEntry(rootStats, root);
    return result();
  }

  countEntry(rootStats, root);

  const queue: DirTask[] = [];
  const inFlight = new Set<Promise<void>>();

  const processDir = async (task: DirTask): Promise<void> => {
    if (stopped) return;
    if (signal?.aborted) {
      aborted = true;
      stopped = true;
      return;
    }
    const { dir, depth } = task;

    let dirents: Dirent[];
    try {
      dirents = await readdir(dir, { withFileTypes: true });
    } catch (err) {
      if (errorCode(err) === 'ENOENT') return;
      recordError(dir, err);
      return;
    }

    if (stopped) return;

    if (opts.maxDepth !== undefined && depth >= opts.maxDepth) {
      if (dirents.length > 0) truncated = true;
      return;
    }

    for (const dirent of dirents) {
      if (stopped) return;
      if (opts.maxEntries !== undefined && entries >= opts.maxEntries) {
        truncated = true;
        stopped = true;
        return;
      }

      const childPath = join(dir, dirent.name);
      if (isSkipped(childPath)) continue;

      let st: Stats;
      try {
        st = await lstat(childPath);
      } catch (err) {
        if (errorCode(err) === 'ENOENT') continue;
        recordError(childPath, err);
        continue;
      }

      if (st.isDirectory() && st.dev !== rootDev) continue;

      countEntry(st, childPath);

      if (st.isDirectory()) {
        queue.push({ dir: childPath, depth: depth + 1 });
      }
    }
  };

  queue.push({ dir: root, depth: 0 });

  const pump = (): void => {
    while (!stopped && !signal?.aborted && queue.length > 0 && inFlight.size < concurrency) {
      const task = queue.shift();
      if (task === undefined) break;
      const p = processDir(task).then(
        () => {
          inFlight.delete(p);
          pump();
        },
        () => {
          inFlight.delete(p);
          pump();
        },
      );
      inFlight.add(p);
    }
  };

  pump();
  while (inFlight.size > 0) {
    await Promise.race(inFlight);
  }

  if (signal?.aborted) aborted = true;

  return result();
}
