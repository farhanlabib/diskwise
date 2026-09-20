import { spawn, type ChildProcess } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type APIRequestContext } from '@playwright/test';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const cliEntry = path.join(repoRoot, 'packages', 'cli', 'dist', 'index.js');

const FIXTURE_NAME = 'big-old.dmg';
const FIXTURE_BYTES = 150_000_000;
const RULE_ID = 'downloads.old-large';

// A stand-in for the Swift helper so the run stays inside the temporary home.
// It implements only the commands this flow reaches.
const HELPER_STUB = `#!/usr/bin/env node
const fs = require('node:fs/promises');
const path = require('node:path');

async function walk(target) {
  let allocated = 0;
  let entries = 0;
  const stack = [target];
  while (stack.length > 0) {
    const current = stack.pop();
    let st;
    try {
      st = await fs.lstat(current);
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) continue;
    entries += 1;
    if (st.isDirectory()) {
      let names = [];
      try {
        names = await fs.readdir(current);
      } catch {
        names = [];
      }
      for (const name of names) stack.push(path.join(current, name));
    } else {
      allocated += st.blocks ? st.blocks * 512 : st.size;
    }
  }
  return { allocated, entries };
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'trash') {
    const target = rest[0];
    const trash = path.join(process.env.HOME, '.Trash');
    await fs.mkdir(trash, { recursive: true });
    const dest = path.join(trash, path.basename(target));
    await fs.rename(target, dest);
    process.stdout.write(JSON.stringify({ ok: true, path: target, trashedPath: dest }));
    return;
  }
  if (cmd === 'tree') {
    const target = rest[0];
    const { allocated, entries } = await walk(target);
    process.stdout.write(
      JSON.stringify({
        ok: true,
        path: target,
        allocated,
        privateSize: allocated,
        entries,
        unreadable: [],
        truncated: false,
        privateSizeSupported: true,
      }),
    );
    return;
  }
  if (cmd === 'privatesize') {
    const items = [];
    for (const target of rest) {
      const { allocated } = await walk(target);
      items.push({ path: target, allocated, privateSize: allocated });
    }
    process.stdout.write(JSON.stringify({ ok: true, items, privateSizeSupported: true }));
    return;
  }
  if (cmd === 'running-apps') {
    process.stdout.write(JSON.stringify({ ok: true, apps: [] }));
    return;
  }
  if (cmd === 'capacity') {
    process.stdout.write(
      JSON.stringify({
        ok: true,
        path: rest[0] || '/',
        total: 0,
        available: 0,
        importantUsage: 0,
        opportunisticUsage: 0,
        purgeableEstimate: 0,
      }),
    );
    return;
  }
  process.stdout.write(JSON.stringify({ ok: false, error: 'unsupported: ' + cmd }));
  process.exitCode = 1;
}

main().catch((error) => {
  process.stdout.write(JSON.stringify({ ok: false, error: String(error && error.message) }));
  process.exitCode = 1;
});
`;

let home = '';
let server: ChildProcess | undefined;
let token = '';
let baseUrl = '';

async function startUi(): Promise<{ url: string; token: string }> {
  const helperPath = path.join(home, 'helper-stub.cjs');
  await writeFile(helperPath, HELPER_STUB);
  await chmod(helperPath, 0o755);

  const child = spawn(process.execPath, [cliEntry, 'ui', '--no-open', '--port', '0'], {
    cwd: repoRoot,
    env: { ...process.env, HOME: home, DISKWISE_HELPER: helperPath },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server = child;

  let output = '';
  let stderr = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  const url = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`ui server printed no url in 30s\n${output}${stderr}`)),
      30_000,
    );
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      // eslint-disable-next-line no-control-regex
      const plain = output.replace(/\u001b\[[0-9;]*m/g, '');
      const match = /http:\/\/127\.0\.0\.1:\d+\/#t=[^\s]+/.exec(plain);
      if (match) {
        clearTimeout(timer);
        resolve(match[0]);
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`ui server exited early (code ${code})\n${output}${stderr}`));
    });
  });

  return { url, token: /#t=([^&\s]+)/.exec(url)?.[1] ?? '' };
}

async function waitForJob(
  request: APIRequestContext,
  jobId: string,
): Promise<{ state: string; result?: unknown; error?: string }> {
  const deadline = Date.now() + 180_000;
  for (;;) {
    const response = await request.get(`${baseUrl}/api/jobs/${jobId}`, { headers: auth() });
    const job = (await response.json()) as { state: string; result?: unknown; error?: string };
    if (job.state !== 'queued' && job.state !== 'running') return job;
    if (Date.now() > deadline) throw new Error(`job ${jobId} never finished: ${JSON.stringify(job)}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

function auth(): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

test.beforeAll(async () => {
  // Deliberately under the real home rather than tmpdir(): a scratch home in
  // a system temp directory is not a place the scanner treats as a normal home.
  home = await mkdtemp(path.join(homedir(), '.diskwise-e2e-home-'));
  const downloads = path.join(home, 'Downloads');
  await mkdir(downloads, { recursive: true });

  const target = path.join(downloads, FIXTURE_NAME);
  await writeFile(target, Buffer.alloc(FIXTURE_BYTES, 7));
  const old = new Date(Date.now() - 200 * 86_400_000);
  await utimes(target, old, old);

  const fixture = await stat(target);
  if (fixture.size !== FIXTURE_BYTES) {
    throw new Error(`fixture is ${fixture.size} bytes, expected ${FIXTURE_BYTES}`);
  }

  const started = await startUi();
  baseUrl = (started.url.split('#')[0] ?? started.url).replace(/\/+$/, '');
  token = started.token;
});

test.afterAll(async () => {
  server?.kill('SIGTERM');
  if (home) await rm(home, { recursive: true, force: true });
});

test('applies a Trash cleanup against an isolated home, journals it, and undoes it', async ({
  request,
}) => {
  const target = path.join(home, 'Downloads', FIXTURE_NAME);

  const scan = await request.post(`${baseUrl}/api/scans`, { headers: auth(), data: {} });
  const { jobId: scanJobId } = (await scan.json()) as { jobId: string };
  const scanJob = await waitForJob(request, scanJobId);
  expect(scanJob.state).toBe('done');

  const audit = scanJob.result as { findings: { ruleId: string }[] };
  const seen = audit.findings.map((finding) => finding.ruleId);
  const downloads = await readdir(path.join(home, 'Downloads')).catch(() => [] as string[]);
  expect(
    seen,
    `scan of ${home} found ${seen.join(', ') || 'nothing'}; Downloads held ${downloads.join(', ') || 'nothing'}`,
  ).toContain(RULE_ID);

  const planResponse = await request.post(`${baseUrl}/api/plans`, {
    headers: auth(),
    // Tier 2 is opt-in: plans default to tiers 0 and 1 only.
    data: { scanJobId, selection: { tiers: [2], ruleIds: [RULE_ID] } },
  });
  expect(planResponse.status()).toBe(200);
  const plan = (await planResponse.json()) as {
    id: string;
    items: { ruleId: string; match: { path?: string } }[];
  };
  expect(plan.items).toHaveLength(1);
  expect(plan.items[0]?.match.path).toBe(target);

  const execution = await request.post(`${baseUrl}/api/executions`, {
    headers: auth(),
    data: { planId: plan.id, apply: true, confirmedRuleIds: [RULE_ID] },
  });
  expect(execution.status()).toBe(200);
  const { jobId: executionJobId } = (await execution.json()) as { jobId: string };
  const executionJob = await waitForJob(request, executionJobId);
  expect(executionJob.state).toBe('done');

  await expect(stat(target)).rejects.toMatchObject({ code: 'ENOENT' });

  // The recovery record is written before the result, so undo has a destination.
  const journalDir = path.join(home, '.diskwise', 'journal');
  const journalFiles = await readdir(journalDir);
  expect(journalFiles).toHaveLength(1);
  const journal = await readFile(path.join(journalDir, journalFiles[0] ?? ''), 'utf8');
  expect(journal).toContain('"type":"intent"');
  expect(journal).toContain('"type":"trash-destination"');
  expect(journal).toContain('"type":"result"');

  const runs = await request.get(`${baseUrl}/api/runs`, { headers: auth() });
  const [run] = (await runs.json()) as { runId: string; incomplete: boolean }[];
  expect(run?.incomplete).toBe(false);

  const undo = await request.post(`${baseUrl}/api/runs/${run?.runId}/undo`, { headers: auth() });
  expect(undo.status()).toBe(200);
  const { results } = (await undo.json()) as { results: { status: string }[] };
  expect(results.map((entry) => entry.status)).toEqual(['restored']);

  expect((await stat(target)).size).toBe(FIXTURE_BYTES);
});

test('refuses a stale plan whose target vanished after planning', async ({ request }) => {
  const scan = await request.post(`${baseUrl}/api/scans`, { headers: auth(), data: {} });
  const { jobId: scanJobId } = (await scan.json()) as { jobId: string };
  await waitForJob(request, scanJobId);

  const planResponse = await request.post(`${baseUrl}/api/plans`, {
    headers: auth(),
    data: { scanJobId, selection: { tiers: [2], ruleIds: [RULE_ID] } },
  });
  const plan = (await planResponse.json()) as { id: string; items: { match: { path?: string } }[] };
  const target = plan.items[0]?.match.path;
  expect(target).toBeTruthy();

  await rm(target ?? '', { force: true });

  const execution = await request.post(`${baseUrl}/api/executions`, {
    headers: auth(),
    data: { planId: plan.id, apply: true, confirmedRuleIds: [RULE_ID] },
  });
  const { jobId } = (await execution.json()) as { jobId: string };
  const job = await waitForJob(request, jobId);
  expect(job.state).toBe('done');

  const result = job.result as { results: { status: string; reason?: string }[] };
  expect(result.results[0]?.status).toBe('skipped');
  expect(result.results[0]?.reason).toMatch(/^refused:/);
});
