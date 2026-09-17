import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DiskInfo, ProbeRunner, SystemDataBucket } from '../types';
import { analyzeSystemData } from './system-data';

const IMAGES = 2 * 1024 * 1024;
const VM = 1024 * 1024;
const NPM = 1024 * 1024;
const DOCS = 1024 * 1024;
const LIB_CACHE = 512 * 1024;

const SNAPSHOT_OUTPUT = [
  'Snapshots for disk /:',
  'com.apple.TimeMachine.2026-09-10-101010.local',
  '',
].join('\n');

const run: ProbeRunner = async (bin) => {
  if (bin === 'tmutil') return { stdout: SNAPSHOT_OUTPUT, stderr: '', exitCode: 0 };
  return { stdout: '', stderr: '', exitCode: 127 };
};

const disk: DiskInfo = {
  mountPoint: '/',
  volumeName: 'Test',
  containerTotal: 60_000_000,
  containerUsed: 50_000_000,
  containerFree: 10_000_000,
  volumeUsed: 50_000_000,
  caseSensitive: false,
};

let root: string;
let home: string;
let library: string;
let privateVar: string;
let applications: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'diskwise-system-data-'));
  home = join(root, 'home');
  library = join(root, 'library');
  privateVar = join(root, 'privatevar');
  applications = join(root, 'applications');

  const file = async (dir: string, name: string, bytes: number): Promise<void> => {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, name), Buffer.alloc(bytes));
  };

  // Visible: documents are user files, not System Data.
  await file(join(home, 'Documents'), 'report.pdf', DOCS);
  await mkdir(applications, { recursive: true });

  // Hidden home folder.
  await file(join(home, '.npm'), 'cache.bin', NPM);

  // ~/Library.
  await file(join(home, 'Library', 'Caches'), 'app.bin', LIB_CACHE);

  // /Library/Developer/CoreSimulator.
  await file(join(library, 'Developer', 'CoreSimulator', 'Images'), 'runtime.dmg', IMAGES);
  await mkdir(join(library, 'Developer', 'CoreSimulator', 'Devices'), { recursive: true });

  // Rest of /Library.
  await file(join(library, 'Caches'), 'sys.bin', LIB_CACHE);

  // /private/var.
  await file(join(privateVar, 'vm'), 'swapfile0', VM);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

function analyze(signal?: AbortSignal) {
  return analyzeSystemData({
    home,
    disk,
    run,
    signal,
    roots: {
      library,
      privateVar,
      applications: [applications],
      homebrew: [join(root, 'no-homebrew')],
    },
  });
}

function topLevelBytes(buckets: SystemDataBucket[]): number {
  return buckets.reduce((sum, bucket) => sum + bucket.bytes, 0);
}

describe('analyzeSystemData', () => {
  it('produces the expected buckets', async () => {
    const report = await analyze();
    const ids = report.buckets.map((bucket) => bucket.id);

    expect(ids).toContain('coresimulator');
    expect(ids).toContain('library-other');
    expect(ids).toContain('private-var');
    expect(ids).toContain('user-library');
    expect(ids).toContain('hidden-home');
    expect(ids).toContain('snapshots');
    expect(ids).not.toContain('homebrew');
  });

  it('keeps children at or below their parent', async () => {
    const report = await analyze();
    for (const bucket of report.buckets) {
      if (!bucket.children || bucket.children.length === 0) continue;
      const sum = bucket.children.reduce((total, child) => total + child.bytes, 0);
      expect(sum).toBeLessThanOrEqual(bucket.bytes);
    }
  });

  it('counts no byte twice', async () => {
    const report = await analyze();
    const written = IMAGES + VM + NPM + DOCS + 2 * LIB_CACHE;
    // Directory blocks are not part of `written`; allow a little overhead.
    expect(topLevelBytes(report.buckets)).toBeLessThanOrEqual(written + 100_000);
    expect(topLevelBytes(report.buckets)).toBeGreaterThanOrEqual(IMAGES);
  });

  it('excludes Documents from buckets but subtracts it from the total', async () => {
    const report = await analyze();

    const paths = report.buckets.flatMap((bucket) => [
      bucket.path,
      ...(bucket.children ?? []).map((child) => child.path),
    ]);
    expect(paths.some((path) => path?.startsWith(join(home, 'Documents')))).toBe(false);

    const visible = disk.containerUsed - report.total;
    expect(visible).toBeGreaterThanOrEqual(DOCS);
    expect(visible).toBeLessThan(DOCS + 100_000);
  });

  it('reports measured and unmeasured so they add up to the total', async () => {
    const report = await analyze();
    expect(report.measured).toBe(topLevelBytes(report.buckets));
    expect(report.unmeasured).toBe(Math.max(0, report.total - report.measured));
  });

  it('adds a zero-byte snapshots bucket with a manual command', async () => {
    const report = await analyze();
    const snapshot = report.buckets.find((bucket) => bucket.id === 'snapshots');

    expect(snapshot).toBeDefined();
    expect(snapshot?.bytes).toBe(0);
    expect(snapshot?.tier).toBe(3);
    expect(snapshot?.manualCommand).toBe('tmutil thinlocalsnapshots / 10000000000 4');
    expect(report.snapshots).toHaveLength(1);
  });

  it('returns early on an aborted signal without throwing', async () => {
    const controller = new AbortController();
    controller.abort();

    const report = await analyze(controller.signal);
    expect(report.buckets).toEqual([]);
    expect(report.total).toBe(disk.containerUsed);
  });
});
