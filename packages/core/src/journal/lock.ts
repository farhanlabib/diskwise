import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';

interface LockInfo {
  pid?: number;
  startedAt?: string;
}

async function writeLock(lockPath: string): Promise<void> {
  const fh = await open(lockPath, 'wx', 0o600);
  try {
    await fh.writeFile(
      JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() } satisfies LockInfo),
    );
    await fh.datasync();
  } catch (err) {
    await fh.close().catch(() => undefined);
    await unlink(lockPath).catch(() => undefined);
    throw err;
  }
  await fh.close();
}

async function inspectLock(lockPath: string): Promise<{ stale: boolean; pid?: number }> {
  let raw: string;
  try {
    raw = await readFile(lockPath, 'utf8');
  } catch {
    return { stale: true };
  }
  let info: LockInfo;
  try {
    info = JSON.parse(raw) as LockInfo;
  } catch {
    return { stale: true };
  }
  const pid = info?.pid;
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) {
    return { stale: true };
  }
  try {
    process.kill(pid, 0);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ESRCH') {
      return { stale: true };
    }
  }
  return { stale: false, pid };
}

export async function acquireLock(lockPath: string): Promise<() => Promise<void>> {
  await mkdir(dirname(lockPath), { recursive: true, mode: 0o700 });

  let tookOver = false;
  for (;;) {
    try {
      await writeLock(lockPath);
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      const { stale, pid } = await inspectLock(lockPath);
      if (stale && !tookOver) {
        tookOver = true;
        await unlink(lockPath).catch(() => undefined);
        continue;
      }
      throw new Error(`LOCKED: another macsweep run (pid ${pid ?? 'unknown'}) is in progress`);
    }
  }

  let released = false;
  return async () => {
    if (released) return;
    released = true;
    try {
      await unlink(lockPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  };
}
