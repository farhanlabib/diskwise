import { chmod, link, mkdir, mkdtemp, open, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { measure } from './walker';

const KB = 1024;
const MB = 1024 * KB;

const roots: string[] = [];
const lockedDirs: string[] = [];

async function makeRoot(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `diskwise-${prefix}-`));
  roots.push(dir);
  return dir;
}

afterAll(async () => {
  await Promise.all(lockedDirs.map((dir) => chmod(dir, 0o755).catch(() => undefined)));
  await Promise.all(roots.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('measure', () => {
  it('counts a 1 MB file as allocated >= 1 MB', async () => {
    const root = await makeRoot('real');
    await writeFile(join(root, 'one.bin'), Buffer.alloc(MB, 7));

    const r = await measure(root);

    expect(r.allocated).toBeGreaterThanOrEqual(MB);
    expect(r.entries).toBe(2);
    expect(r.aborted).toBe(false);
    expect(r.truncated).toBe(false);
  });

  it('reports a sparse file with large apparent and small allocated', async () => {
    const root = await makeRoot('sparse');
    const fh = await open(join(root, 'sparse.bin'), 'w');
    try {
      await fh.write(Buffer.from('x'), 0, 1, 512 * MB);
    } finally {
      await fh.close();
    }

    const r = await measure(root);

    expect(r.apparent).toBeGreaterThan(500 * MB);
    expect(r.allocated).toBeLessThan(MB);
  });

  it('counts a hardlinked file once', async () => {
    const single = await makeRoot('single');
    await writeFile(join(single, 'one.bin'), Buffer.alloc(MB, 3));
    const rSingle = await measure(single);

    const root = await makeRoot('hardlink');
    await writeFile(join(root, 'one.bin'), Buffer.alloc(MB, 3));
    await link(join(root, 'one.bin'), join(root, 'two.bin'));
    const rHard = await measure(root);

    const tolerance = 64 * KB;
    expect(Math.abs(rHard.allocated - rSingle.allocated)).toBeLessThanOrEqual(tolerance);
    expect(rHard.entries).toBe(rSingle.entries);
  });

  it('does not follow a symlink cycle', async () => {
    const root = await makeRoot('cycle');
    const a = join(root, 'a');
    await mkdir(a);
    await symlink('..', join(a, 'loop'));

    const r = await measure(root);

    expect(r.aborted).toBe(false);
    expect(r.truncated).toBe(false);
  });

  it('does not count a file outside the root reached via symlink', async () => {
    const outside = await makeRoot('outside');
    await writeFile(join(outside, 'big.bin'), Buffer.alloc(4 * MB, 1));

    const root = await makeRoot('symlink');
    await symlink(join(outside, 'big.bin'), join(root, 'link.bin'));

    const r = await measure(root);

    expect(r.allocated).toBeLessThan(MB);
  });

  it.skipIf(process.getuid?.() === 0)('records an unreadable directory', async () => {
    const root = await makeRoot('locked');
    const locked = join(root, 'locked');
    await mkdir(locked);
    await writeFile(join(locked, 'secret.txt'), 'x');
    await chmod(locked, 0o000);
    lockedDirs.push(locked);

    const r = await measure(root);

    const entry = r.unreadable.find((u) => u.path === locked);
    expect(entry).toBeDefined();
    expect(['EPERM', 'EACCES']).toContain(entry?.code);
  });

  it('sets truncated when maxEntries stops the walk', async () => {
    const root = await makeRoot('maxentries');
    for (let i = 0; i < 5; i += 1) {
      await writeFile(join(root, `f${i}.txt`), 'x');
    }

    const r = await measure(root, { maxEntries: 3 });

    expect(r.truncated).toBe(true);
    expect(r.entries).toBeLessThanOrEqual(3);
  });

  it('reports aborted for an already-aborted signal', async () => {
    const root = await makeRoot('aborted');
    await writeFile(join(root, 'a.txt'), 'x');
    const controller = new AbortController();
    controller.abort();

    const r = await measure(root, { signal: controller.signal });

    expect(r.aborted).toBe(true);
  });

  it('dedupes across walks that share a seen set', async () => {
    const root = await makeRoot('seen');
    await writeFile(join(root, 'a.bin'), Buffer.alloc(MB, 5));
    const seen = new Set<string>();

    const first = await measure(root, { seen });
    const second = await measure(root, { seen });

    expect(first.allocated).toBeGreaterThan(0);
    expect(second.allocated).toBe(0);
    expect(second.entries).toBe(0);
  });
});
