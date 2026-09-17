import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import type { IncomingHttpHeaders } from 'node:http';
import type {
  AppReport,
  AuditResult,
  CleanupPlan,
  Finding,
  ItemResult,
  Rule,
} from '@macsweep/core/types';
import type { ServerEngine } from './engine';
import { startServer } from './server';
import type { ServerHandle, StartServerOptions } from './server';

interface HttpResponse {
  status: number;
  headers: IncomingHttpHeaders;
  text: string;
}

function request(
  port: number,
  opts: {
    method?: string;
    path: string;
    headers?: Record<string, string>;
    body?: string;
  },
): Promise<HttpResponse> {
  return new Promise((resolveRequest, rejectRequest) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        method: opts.method ?? 'GET',
        path: opts.path,
        headers: opts.headers ?? {},
      },
      (res) => {
        const chunks: string[] = [];
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => chunks.push(chunk));
        res.on('end', () =>
          resolveRequest({
            status: res.statusCode ?? 0,
            headers: res.headers,
            text: chunks.join(''),
          }),
        );
      },
    );
    req.on('error', rejectRequest);
    if (opts.body !== undefined) req.write(opts.body);
    req.end();
  });
}

function requestBinary(
  port: number,
  opts: { path: string; headers?: Record<string, string> },
): Promise<{ status: number; headers: IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolveRequest, rejectRequest) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        method: 'GET',
        path: opts.path,
        headers: opts.headers ?? {},
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () =>
          resolveRequest({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    req.on('error', rejectRequest);
    req.end();
  });
}

function authHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function jsonHeaders(token: string): Record<string, string> {
  return { ...authHeaders(token), 'content-type': 'application/json' };
}

function ndjson(text: string): Array<{ event: string; data: unknown }> {
  return text
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as { event: string; data: unknown });
}

function makeAudit(): AuditResult {
  const finding: Finding = {
    ruleId: 'demo.rule',
    title: 'Demo finding',
    category: 'dev',
    tier: 0,
    rationale: 'demo',
    regeneration: 'rebuild',
    action: 'remove-path',
    needsRoot: false,
    permanentOnly: false,
    matches: [
      {
        kind: 'file',
        path: '/tmp/demo',
        detail: 'demo',
        bytesAllocated: 100,
        bytesApparent: 100,
      },
    ],
    totals: { allocated: 100, apparent: 100 },
  };
  return {
    schemaVersion: 1,
    generatedAt: new Date(0).toISOString(),
    findings: [finding],
    traps: [],
    unreadable: [],
    totals: { byTier: { 0: 100, 1: 0, 2: 0, 3: 0 }, reclaimable: 100 },
  };
}

function makePlan(audit: AuditResult): CleanupPlan {
  const finding = audit.findings[0]!;
  const match = finding.matches[0]!;
  return {
    schemaVersion: 1,
    id: 'plan-1',
    createdAt: new Date(0).toISOString(),
    auditGeneratedAt: audit.generatedAt,
    items: [
      {
        id: `${finding.ruleId}#0`,
        ruleId: finding.ruleId,
        title: finding.title,
        category: finding.category,
        tier: finding.tier,
        action: 'remove-path',
        permanentOnly: false,
        needsConfirmation: false,
        roots: [],
        match,
      },
    ],
    manual: [],
    totals: { byTier: { 0: 1, 1: 0, 2: 0, 3: 0 }, total: 1 },
  };
}

const APP_REPORT: AppReport = {
  app: {
    bundleId: 'com.example.app',
    name: 'Example',
    version: '1.0',
    path: '/Applications/Example.app',
    running: false,
    bundleBytes: 0,
    system: false,
  },
  locations: [
    {
      kind: 'caches',
      tier: 0,
      actionable: true,
      path: '/tmp/example/caches',
      bytesAllocated: 100,
      source: 'generic',
    },
  ],
  totals: { cleanable: 100, data: 0, all: 100 },
};

const APP_PLAN: CleanupPlan = {
  schemaVersion: 1,
  id: 'app-plan-1',
  createdAt: new Date(0).toISOString(),
  auditGeneratedAt: new Date(0).toISOString(),
  items: [
    {
      id: 'app.com.example.app.caches#0',
      ruleId: 'app.caches',
      title: 'Example — Caches',
      category: 'app',
      tier: 0,
      action: 'remove-dir-contents',
      permanentOnly: false,
      needsConfirmation: false,
      preflight: { apps: [{ bundleId: 'com.example.app', name: 'Example' }] },
      roots: ['/tmp/example/caches'],
      match: {
        kind: 'dir',
        path: '/tmp/example/caches',
        detail: '/tmp/example/caches',
        appBundleId: 'com.example.app',
        bytesAllocated: 100,
        bytesApparent: 100,
      },
    },
  ],
  manual: [],
  totals: { byTier: { 0: 100, 1: 0, 2: 0, 3: 0 }, total: 100 },
};

const RULE: Rule = {
  schemaVersion: 1,
  id: 'demo.rule',
  title: 'Demo finding',
  category: 'dev',
  tier: 0,
  roots: [],
  matcher: { kind: 'path', path: '/tmp/demo' },
  action: 'remove-path',
  rationale: 'demo',
  regeneration: 'rebuild',
};

const ITEM_RESULT: ItemResult = {
  itemId: 'demo.rule#0',
  ruleId: 'demo.rule',
  action: 'remove-path',
  status: 'done',
  bytesBefore: 100,
  bytesAfter: 0,
  freed: 100,
  restorable: true,
};

interface FakeEngine extends ServerEngine {
  releaseExecution(): void;
  holdScan(): void;
  releaseScan(): void;
}

function makeEngine(): FakeEngine {
  const auditResult = makeAudit();
  const plan = makePlan(auditResult);
  let scanGate: Promise<void> | null = null;
  let releaseScanGate: () => void = () => {};
  let releaseExecutionGate: () => void = () => {};
  const executionGate = new Promise<void>((resolveGate) => {
    releaseExecutionGate = resolveGate;
  });

  return {
    version: '1.2.3',
    async audit({ onProgress }) {
      onProgress({ entries: 1, path: '/one' });
      onProgress({ entries: 2, path: '/two' });
      onProgress({ entries: 3, path: '/three' });
      if (scanGate) await scanGate;
      return auditResult;
    },
    listRules() {
      return [RULE];
    },
    buildPlan() {
      return plan;
    },
    async executePlan(_plan, opts) {
      opts.onItem(ITEM_RESULT);
      await executionGate;
      return {
        planId: plan.id,
        runId: 'run-1',
        apply: opts.apply,
        results: [ITEM_RESULT],
        freed: ITEM_RESULT.freed,
      };
    },
    async listRuns() {
      return [];
    },
    async undoRun() {
      return [];
    },
    async appReports() {
      return [APP_REPORT];
    },
    async appIcon() {
      return Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    },
    async buildAppPlan() {
      return APP_PLAN;
    },
    async permissions() {
      return { fullDiskAccess: 'granted' };
    },
    async quitApp() {
      return { quit: true };
    },
    releaseExecution() {
      releaseExecutionGate();
    },
    holdScan() {
      scanGate = new Promise<void>((resolveGate) => {
        releaseScanGate = resolveGate;
      });
    },
    releaseScan() {
      releaseScanGate();
    },
  };
}

const servers: ServerHandle[] = [];
const tempDirs: string[] = [];

async function start(
  engine: ServerEngine,
  extra: Omit<Partial<StartServerOptions>, 'engine'> = {},
): Promise<ServerHandle> {
  const handle = await startServer({ engine, ...extra });
  servers.push(handle);
  return handle;
}

async function makeAssetsDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'macsweep-assets-'));
  tempDirs.push(dir);
  await writeFile(join(dir, 'index.html'), '<html>INDEX</html>');
  await writeFile(join(dir, 'app.js'), 'console.log(1)');
  return dir;
}

async function waitForClosed(
  port: number,
  headers: Record<string, string>,
): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      await request(port, { path: '/api/health', headers });
    } catch {
      return;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
  throw new Error('server did not close');
}

afterEach(async () => {
  while (servers.length > 0) {
    const handle = servers.pop()!;
    try {
      await handle.close();
    } catch {
      /* already closed */
    }
  }
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    try {
      await rm(dir, { recursive: true, force: true });
    } catch {
      /* nothing to clean */
    }
  }
});

describe('server security', () => {
  it('listens on 127.0.0.1 and answers with a token', async () => {
    const handle = await start(makeEngine());
    expect(handle.url.startsWith('http://127.0.0.1:')).toBe(true);
    expect(handle.port).toBeGreaterThan(0);
    const res = await request(handle.port, {
      path: '/api/health',
      headers: authHeaders(handle.token),
    });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.text)).toEqual({ ok: true, version: '1.2.3' });
  });

  it('rejects a missing token with 401', async () => {
    const handle = await start(makeEngine());
    const res = await request(handle.port, { path: '/api/health' });
    expect(res.status).toBe(401);
  });

  it('rejects a wrong token with 401', async () => {
    const handle = await start(makeEngine());
    const res = await request(handle.port, {
      path: '/api/health',
      headers: authHeaders('not-the-token'),
    });
    expect(res.status).toBe(401);
  });

  it('rejects a foreign Host with 403', async () => {
    const handle = await start(makeEngine());
    const res = await request(handle.port, {
      path: '/api/health',
      headers: { ...authHeaders(handle.token), host: `evil.com:${handle.port}` },
    });
    expect(res.status).toBe(403);
  });

  it('rejects a foreign Origin with 403', async () => {
    const handle = await start(makeEngine());
    const res = await request(handle.port, {
      path: '/api/health',
      headers: { ...authHeaders(handle.token), origin: 'http://evil.com' },
    });
    expect(res.status).toBe(403);
  });

  it('allows the loopback Origin', async () => {
    const handle = await start(makeEngine());
    const res = await request(handle.port, {
      path: '/api/health',
      headers: {
        ...authHeaders(handle.token),
        origin: `http://127.0.0.1:${handle.port}`,
      },
    });
    expect(res.status).toBe(200);
  });

  it('rejects a non-JSON POST body with 415', async () => {
    const handle = await start(makeEngine());
    const res = await request(handle.port, {
      method: 'POST',
      path: '/api/scans',
      headers: { ...authHeaders(handle.token), 'content-type': 'text/plain' },
      body: '{}',
    });
    expect(res.status).toBe(415);
  });

  it('rejects malformed and invalid JSON bodies with 400', async () => {
    const handle = await start(makeEngine());
    const malformed = await request(handle.port, {
      method: 'POST',
      path: '/api/scans',
      headers: jsonHeaders(handle.token),
      body: 'not json',
    });
    expect(malformed.status).toBe(400);
    const invalid = await request(handle.port, {
      method: 'POST',
      path: '/api/scans',
      headers: jsonHeaders(handle.token),
      body: '[]',
    });
    expect(invalid.status).toBe(400);
  });

  it('rejects bodies over 1 MB with 413', async () => {
    const handle = await start(makeEngine());
    const res = await request(handle.port, {
      method: 'POST',
      path: '/api/scans',
      headers: jsonHeaders(handle.token),
      body: JSON.stringify({ pad: 'x'.repeat(1024 * 1024 + 10) }),
    });
    expect(res.status).toBe(413);
  });

  it('answers OPTIONS with 405', async () => {
    const handle = await start(makeEngine());
    const res = await request(handle.port, {
      method: 'OPTIONS',
      path: '/api/health',
      headers: authHeaders(handle.token),
    });
    expect(res.status).toBe(405);
  });

  it('never sets an access-control-allow-origin header', async () => {
    const handle = await start(makeEngine());
    const responses = await Promise.all([
      request(handle.port, { path: '/api/health', headers: authHeaders(handle.token) }),
      request(handle.port, { path: '/api/health' }),
      request(handle.port, {
        path: '/api/health',
        headers: { ...authHeaders(handle.token), host: `evil.com:${handle.port}` },
      }),
      request(handle.port, {
        method: 'POST',
        path: '/api/scans',
        headers: { ...authHeaders(handle.token), 'content-type': 'text/plain' },
        body: '{}',
      }),
    ]);
    for (const res of responses) {
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    }
  });

  it('sets the security headers on every response', async () => {
    const handle = await start(makeEngine());
    const res = await request(handle.port, {
      path: '/api/health',
      headers: authHeaders(handle.token),
    });
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['cross-origin-opener-policy']).toBe('same-origin');
    expect(res.headers['cross-origin-resource-policy']).toBe('same-origin');
  });
});

describe('scan and plan flow', () => {
  it('streams progress and a done event for a scan', async () => {
    const engine = makeEngine();
    const handle = await start(engine);
    const scan = await request(handle.port, {
      method: 'POST',
      path: '/api/scans',
      headers: jsonHeaders(handle.token),
      body: '{}',
    });
    expect(scan.status).toBe(200);
    const { jobId } = JSON.parse(scan.text) as { jobId: string };

    const events = await request(handle.port, {
      path: `/api/jobs/${jobId}/events`,
      headers: authHeaders(handle.token),
    });
    expect(events.status).toBe(200);
    expect(events.headers['content-type']).toContain('application/x-ndjson');
    const names = ndjson(events.text).map((line) => line.event);
    expect(names).toContain('progress');
    expect(names).toContain('done');

    const detail = await request(handle.port, {
      path: `/api/jobs/${jobId}`,
      headers: authHeaders(handle.token),
    });
    const job = JSON.parse(detail.text) as { state: string; result?: { findings: unknown[] } };
    expect(job.state).toBe('done');
    expect(job.result?.findings).toHaveLength(1);
  });

  it('returns 404 for an unknown job', async () => {
    const handle = await start(makeEngine());
    const res = await request(handle.port, {
      path: '/api/jobs/does-not-exist',
      headers: authHeaders(handle.token),
    });
    expect(res.status).toBe(404);
  });

  it('refuses to plan an unknown or unfinished scan', async () => {
    const engine = makeEngine();
    const handle = await start(engine);

    const unknown = await request(handle.port, {
      method: 'POST',
      path: '/api/plans',
      headers: jsonHeaders(handle.token),
      body: JSON.stringify({ scanJobId: 'nope', selection: {} }),
    });
    expect(unknown.status).toBe(404);

    engine.holdScan();
    const scan = await request(handle.port, {
      method: 'POST',
      path: '/api/scans',
      headers: jsonHeaders(handle.token),
      body: '{}',
    });
    const { jobId } = JSON.parse(scan.text) as { jobId: string };
    const unfinished = await request(handle.port, {
      method: 'POST',
      path: '/api/plans',
      headers: jsonHeaders(handle.token),
      body: JSON.stringify({ scanJobId: jobId, selection: {} }),
    });
    expect(unfinished.status).toBe(409);
    engine.releaseScan();
  });

  it('builds a plan from a finished scan', async () => {
    const handle = await start(makeEngine());
    const scan = await request(handle.port, {
      method: 'POST',
      path: '/api/scans',
      headers: jsonHeaders(handle.token),
      body: '{}',
    });
    const { jobId } = JSON.parse(scan.text) as { jobId: string };
    await request(handle.port, {
      path: `/api/jobs/${jobId}/events`,
      headers: authHeaders(handle.token),
    });

    const planRes = await request(handle.port, {
      method: 'POST',
      path: '/api/plans',
      headers: jsonHeaders(handle.token),
      body: JSON.stringify({ scanJobId: jobId, selection: { tiers: [0] } }),
    });
    expect(planRes.status).toBe(200);
    const plan = JSON.parse(planRes.text) as CleanupPlan;
    expect(plan.id).toBe('plan-1');
    expect(plan.items).toHaveLength(1);
  });
});

describe('execution flow', () => {
  async function setupPlan(handle: ServerHandle): Promise<string> {
    const scan = await request(handle.port, {
      method: 'POST',
      path: '/api/scans',
      headers: jsonHeaders(handle.token),
      body: '{}',
    });
    const { jobId } = JSON.parse(scan.text) as { jobId: string };
    await request(handle.port, {
      path: `/api/jobs/${jobId}/events`,
      headers: authHeaders(handle.token),
    });
    const planRes = await request(handle.port, {
      method: 'POST',
      path: '/api/plans',
      headers: jsonHeaders(handle.token),
      body: JSON.stringify({ scanJobId: jobId, selection: {} }),
    });
    const plan = JSON.parse(planRes.text) as CleanupPlan;
    return plan.id;
  }

  it('returns 404 for an unknown plan', async () => {
    const handle = await start(makeEngine());
    const res = await request(handle.port, {
      method: 'POST',
      path: '/api/executions',
      headers: jsonHeaders(handle.token),
      body: JSON.stringify({ planId: 'nope', apply: false, confirmedRuleIds: [] }),
    });
    expect(res.status).toBe(404);
  });

  it('returns 400 for item ids not in the plan', async () => {
    const handle = await start(makeEngine());
    const planId = await setupPlan(handle);
    const res = await request(handle.port, {
      method: 'POST',
      path: '/api/executions',
      headers: jsonHeaders(handle.token),
      body: JSON.stringify({
        planId,
        itemIds: ['missing#0'],
        apply: false,
        confirmedRuleIds: [],
      }),
    });
    expect(res.status).toBe(400);
  });

  it('streams an item event for a valid execution', async () => {
    const engine = makeEngine();
    const handle = await start(engine);
    const planId = await setupPlan(handle);

    const execution = await request(handle.port, {
      method: 'POST',
      path: '/api/executions',
      headers: jsonHeaders(handle.token),
      body: JSON.stringify({ planId, apply: false, confirmedRuleIds: [] }),
    });
    expect(execution.status).toBe(200);
    const { jobId } = JSON.parse(execution.text) as { jobId: string };

    const eventsPromise = request(handle.port, {
      path: `/api/jobs/${jobId}/events`,
      headers: authHeaders(handle.token),
    });
    engine.releaseExecution();
    const events = await eventsPromise;
    const names = ndjson(events.text).map((line) => line.event);
    expect(names).toContain('item');
    expect(names).toContain('done');
  });

  it('refuses a second concurrent execution with 409', async () => {
    const engine = makeEngine();
    const handle = await start(engine);
    const planId = await setupPlan(handle);

    const first = await request(handle.port, {
      method: 'POST',
      path: '/api/executions',
      headers: jsonHeaders(handle.token),
      body: JSON.stringify({ planId, apply: false, confirmedRuleIds: [] }),
    });
    expect(first.status).toBe(200);

    const second = await request(handle.port, {
      method: 'POST',
      path: '/api/executions',
      headers: jsonHeaders(handle.token),
      body: JSON.stringify({ planId, apply: false, confirmedRuleIds: [] }),
    });
    expect(second.status).toBe(409);

    engine.releaseExecution();
  });
});

describe('runs, apps and shutdown', () => {
  it('rejects an invalid run id with 400', async () => {
    const handle = await start(makeEngine());
    const res = await request(handle.port, {
      method: 'POST',
      path: '/api/runs/bad!id/undo',
      headers: jsonHeaders(handle.token),
      body: '{}',
    });
    expect(res.status).toBe(400);
  });

  it('lists runs', async () => {
    const handle = await start(makeEngine());
    const res = await request(handle.port, {
      path: '/api/runs',
      headers: authHeaders(handle.token),
    });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.text)).toEqual([]);
  });

  it('rejects an invalid bundle id with 400', async () => {
    const handle = await start(makeEngine());
    const res = await request(handle.port, {
      method: 'POST',
      path: '/api/apps/bad!id/quit',
      headers: jsonHeaders(handle.token),
      body: '{}',
    });
    expect(res.status).toBe(400);
  });

  it('quits an app', async () => {
    const handle = await start(makeEngine());
    const res = await request(handle.port, {
      method: 'POST',
      path: '/api/apps/com.example.app/quit',
      headers: jsonHeaders(handle.token),
      body: '{}',
    });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.text)).toEqual({ quit: true });
  });

  it('shuts down the server', async () => {
    const handle = await start(makeEngine());
    const res = await request(handle.port, {
      method: 'POST',
      path: '/api/shutdown',
      headers: jsonHeaders(handle.token),
      body: '{}',
    });
    expect(res.status).toBe(200);
    await waitForClosed(handle.port, authHeaders(handle.token));
  });
});

describe('app plans', () => {
  async function finishAppScan(handle: ServerHandle): Promise<string> {
    const scan = await request(handle.port, {
      method: 'POST',
      path: '/api/app-scans',
      headers: jsonHeaders(handle.token),
      body: '{}',
    });
    expect(scan.status).toBe(200);
    const { jobId } = JSON.parse(scan.text) as { jobId: string };
    await request(handle.port, {
      path: `/api/jobs/${jobId}/events`,
      headers: authHeaders(handle.token),
    });
    return jobId;
  }

  it('returns 404 for an unknown app scan job', async () => {
    const handle = await start(makeEngine());
    const res = await request(handle.port, {
      method: 'POST',
      path: '/api/app-plans',
      headers: jsonHeaders(handle.token),
      body: JSON.stringify({ appScanJobId: 'nope', bundleId: 'com.example.app' }),
    });
    expect(res.status).toBe(404);
  });

  it('returns 404 for a bundle id missing from the finished app scan', async () => {
    const handle = await start(makeEngine());
    const jobId = await finishAppScan(handle);
    const res = await request(handle.port, {
      method: 'POST',
      path: '/api/app-plans',
      headers: jsonHeaders(handle.token),
      body: JSON.stringify({ appScanJobId: jobId, bundleId: 'com.other.app' }),
    });
    expect(res.status).toBe(404);
  });

  it('builds an app plan whose id POST /api/executions accepts', async () => {
    const engine = makeEngine();
    const handle = await start(engine);
    const jobId = await finishAppScan(handle);

    const planRes = await request(handle.port, {
      method: 'POST',
      path: '/api/app-plans',
      headers: jsonHeaders(handle.token),
      body: JSON.stringify({ appScanJobId: jobId, bundleId: 'com.example.app' }),
    });
    expect(planRes.status).toBe(200);
    const plan = JSON.parse(planRes.text) as CleanupPlan;
    expect(plan.id).toBe('app-plan-1');
    expect(plan.items).toHaveLength(1);

    const execution = await request(handle.port, {
      method: 'POST',
      path: '/api/executions',
      headers: jsonHeaders(handle.token),
      body: JSON.stringify({ planId: plan.id, apply: false, confirmedRuleIds: [] }),
    });
    expect(execution.status).toBe(200);
    engine.releaseExecution();
  });
});

describe('app icons', () => {
  async function finishAppScan(handle: ServerHandle): Promise<void> {
    const scan = await request(handle.port, {
      method: 'POST',
      path: '/api/app-scans',
      headers: jsonHeaders(handle.token),
      body: '{}',
    });
    expect(scan.status).toBe(200);
    const { jobId } = JSON.parse(scan.text) as { jobId: string };
    await request(handle.port, {
      path: `/api/jobs/${jobId}/events`,
      headers: authHeaders(handle.token),
    });
  }

  it('rejects an icon request without a token with 401', async () => {
    const handle = await start(makeEngine());
    const res = await requestBinary(handle.port, { path: '/api/apps/com.example.app/icon' });
    expect(res.status).toBe(401);
  });

  it('returns 404 for a bundle the last app scan did not report', async () => {
    const handle = await start(makeEngine());
    await finishAppScan(handle);
    const res = await requestBinary(handle.port, {
      path: '/api/apps/com.other.app/icon',
      headers: authHeaders(handle.token),
    });
    expect(res.status).toBe(404);
  });

  it('serves a png for a bundle from the finished app scan', async () => {
    const handle = await start(makeEngine());
    await finishAppScan(handle);
    const res = await requestBinary(handle.port, {
      path: '/api/apps/com.example.app/icon',
      headers: authHeaders(handle.token),
    });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['cache-control']).toBe('private, max-age=3600');
    expect(res.body).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });
});

describe('static assets', () => {
  it('serves index.html for extensionless paths and blocks escapes', async () => {
    const dir = await makeAssetsDir();
    const handle = await start(makeEngine(), { assetsDir: dir });

    const root = await request(handle.port, { path: '/apps/x' });
    expect(root.status).toBe(200);
    expect(root.headers['content-type']).toContain('text/html');
    expect(root.text).toContain('INDEX');

    const asset = await request(handle.port, { path: '/app.js' });
    expect(asset.status).toBe(200);
    expect(asset.headers['content-type']).toContain('text/javascript');

    const escape = await request(handle.port, { path: '/../secret' });
    expect([403, 404]).toContain(escape.status);
    expect(escape.text).not.toContain('INDEX');

    const missing = await request(handle.port, { path: '/nope.png' });
    expect(missing.status).toBe(404);
  });

  it('returns 404 for static paths without an assets dir', async () => {
    const handle = await start(makeEngine());
    const res = await request(handle.port, { path: '/whatever' });
    expect(res.status).toBe(404);
  });
});

describe('idle shutdown', () => {
  it('closes after the idle window', async () => {
    const handle = await start(makeEngine(), { idleMs: 50 });
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    expect(handle.checkIdle()).toBe(true);
    await waitForClosed(handle.port, authHeaders(handle.token));
  });

  it('does not close while recent activity exists', async () => {
    const handle = await start(makeEngine(), { idleMs: 60_000 });
    const res = await request(handle.port, {
      path: '/api/health',
      headers: authHeaders(handle.token),
    });
    expect(res.status).toBe(200);
    expect(handle.checkIdle()).toBe(false);
  });
});
