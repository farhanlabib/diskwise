import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runningApps, trashItem, volumeCapacity } from './helper';

const helperPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../native-helper/bin/macsweep-helper',
);
const helperBuilt = existsSync(helperPath);

function runHelper(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(helperPath, args, { encoding: 'utf8' }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr?.trim() || error.message));
        return;
      }
      resolve(stdout);
    });
  });
}

describe.skipIf(!helperBuilt)('native helper', () => {
  it('reports its version', async () => {
    const stdout = await runHelper(['version']);
    expect(JSON.parse(stdout)).toEqual({ ok: true, version: '0.1.0' });
  });

  it('reports volume capacity for the boot volume', async () => {
    const result = await volumeCapacity('/');
    expect(result.ok).toBe(true);
    expect(result.total).toBeGreaterThan(0);
    expect(result.available).toBeGreaterThan(0);
    expect(result.purgeableEstimate).toBeGreaterThanOrEqual(0);
  });

  it('lists running apps with bundle identifiers', async () => {
    const result = await runningApps();
    expect(result.apps.length).toBeGreaterThan(0);
    for (const app of result.apps) {
      expect(app.bundleId.length).toBeGreaterThan(0);
      expect(typeof app.pid).toBe('number');
    }
  });

  it('trashes a file out of its original path', async () => {
    const file = path.join(tmpdir(), `macsweep-helper-test-${process.pid}-${Date.now()}.txt`);
    await writeFile(file, 'macsweep');

    const result = await trashItem(file);
    expect(result.trashedPath).toContain('.Trash');
    expect(existsSync(file)).toBe(false);

    await rm(result.trashedPath, { force: true });
    expect(existsSync(result.trashedPath)).toBe(false);
  });
});
