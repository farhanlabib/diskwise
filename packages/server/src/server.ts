import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { z } from 'zod';
import type { AppReport, AuditResult, CleanupPlan, PlanSelection } from '@diskwise/core/types';
import type { ServerEngine } from './engine';
import { JobManager } from './jobs';
import type { Job } from './jobs';
import {
  SECURITY_HEADERS,
  generateToken,
  hostAllowed,
  originAllowed,
  tokenMatches,
} from './security';

export interface StartServerOptions {
  engine: ServerEngine;
  assetsDir?: string;
  port?: number;
  token?: string;
  idleMs?: number;
  onClose?: () => void;
}

export interface ServerHandle {
  url: string;
  port: number;
  token: string;
  close(): Promise<void>;
  checkIdle(): boolean;
}

const MAX_BODY_BYTES = 1024 * 1024;
const MAX_PLANS = 10;
const IDLE_INTERVAL_MS = 30_000;
const PROGRESS_THROTTLE_MS = 200;
const DEFAULT_IDLE_MS = 600_000;

const RUN_ID_RE = /^[0-9A-Za-z-]+$/;
const BUNDLE_ID_RE = /^[A-Za-z0-9.-]+$/;

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

const scanBodySchema = z.object({});
const selectionSchema = z.object({
  tiers: z.array(z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)])).optional(),
  categories: z.array(z.string()).optional(),
  ruleIds: z.array(z.string()).optional(),
  itemIds: z.array(z.string()).optional(),
});
const planBodySchema = z.object({
  scanJobId: z.string(),
  selection: selectionSchema,
});
const executionBodySchema = z.object({
  planId: z.string(),
  itemIds: z.array(z.string()).optional(),
  apply: z.boolean(),
  confirmedRuleIds: z.array(z.string()),
});
const appPlanBodySchema = z.object({
  appScanJobId: z.string(),
  bundleId: z.string(),
});

class BodyTooLarge extends Error {}

export async function startServer(opts: StartServerOptions): Promise<ServerHandle> {
  const token = opts.token ?? generateToken();
  const jobs = new JobManager();
  // The most recent app scan job: icons are only served for bundles it reported.
  let lastAppsJob: Job | undefined;
  const plans = new Map<string, CleanupPlan>();
  const openStreams = new Set<ServerResponse>();
  const idleMs = opts.idleMs ?? DEFAULT_IDLE_MS;

  let port = 0;
  let lastActivity = Date.now();
  let closed = false;

  const server = createServer((req, res) => {
    void handle(req, res).catch(() => {
      if (!res.headersSent) res.statusCode = 500;
      res.end();
    });
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    const onError = (error: Error): void => rejectListen(error);
    server.once('error', onError);
    server.listen(opts.port ?? 0, '127.0.0.1', () => {
      server.off('error', onError);
      resolveListen();
    });
  });

  const address = server.address();
  port = typeof address === 'object' && address !== null ? address.port : (opts.port ?? 0);

  const idleTimer = setInterval(() => {
    checkIdle();
  }, IDLE_INTERVAL_MS);
  idleTimer.unref();

  function checkIdle(): boolean {
    if (closed) return false;
    if (openStreams.size > 0) return false;
    if (Date.now() - lastActivity <= idleMs) return false;
    void close();
    return true;
  }

  async function close(): Promise<void> {
    if (closed) return;
    closed = true;
    clearInterval(idleTimer);
    jobs.cancelAll();
    for (const stream of openStreams) {
      try {
        stream.end();
      } catch {
        /* response already gone */
      }
    }
    openStreams.clear();
    await new Promise<void>((resolveClose) => {
      server.close(() => resolveClose());
      server.closeAllConnections();
    });
    opts.onClose?.();
  }

  function sendJson(res: ServerResponse, status: number, body: unknown): void {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(body));
  }

  function sendStatus(res: ServerResponse, status: number, allow?: string): void {
    res.statusCode = status;
    if (allow !== undefined) res.setHeader('Allow', allow);
    res.end();
  }

  function requireJsonContentType(req: IncomingMessage, res: ServerResponse): boolean {
    const contentType = req.headers['content-type'];
    if (typeof contentType !== 'string' || !contentType.startsWith('application/json')) {
      sendJson(res, 415, { error: 'unsupported-media-type' });
      return false;
    }
    return true;
  }

  function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolveBody, rejectBody) => {
      const chunks: Buffer[] = [];
      let size = 0;
      let settled = false;
      req.on('data', (chunk: Buffer) => {
        if (settled) return;
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          settled = true;
          rejectBody(new BodyTooLarge());
          req.resume();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        if (settled) return;
        settled = true;
        resolveBody(Buffer.concat(chunks).toString('utf8'));
      });
      req.on('error', (error: Error) => {
        if (settled) return;
        settled = true;
        rejectBody(error);
      });
    });
  }

  async function readJsonBody(req: IncomingMessage, res: ServerResponse): Promise<unknown> {
    let text: string;
    try {
      text = await readBody(req);
    } catch (error) {
      if (error instanceof BodyTooLarge) sendJson(res, 413, { error: 'payload-too-large' });
      else sendJson(res, 400, { error: 'invalid-body' });
      return undefined;
    }
    try {
      return JSON.parse(text);
    } catch {
      sendJson(res, 400, { error: 'invalid-json' });
      return undefined;
    }
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name, value);
    lastActivity = Date.now();

    if (!hostAllowed(req.headers.host, port)) {
      sendJson(res, 403, { error: 'forbidden' });
      return;
    }
    if (!originAllowed(req.headers.origin, port)) {
      sendJson(res, 403, { error: 'forbidden' });
      return;
    }
    if (req.method === 'OPTIONS') {
      sendStatus(res, 405, 'GET, HEAD, POST');
      return;
    }

    const [rawPath = '/'] = (req.url ?? '/').split('?');
    if (rawPath.startsWith('/api/')) {
      await routeApi(req, res, rawPath);
      return;
    }
    await routeStatic(req, res, rawPath);
  }

  function pathParts(rawPath: string): string[] {
    return rawPath
      .split('/')
      .filter((part) => part.length > 0)
      .map((part) => {
        try {
          return decodeURIComponent(part);
        } catch {
          return part;
        }
      });
  }

  async function routeApi(
    req: IncomingMessage,
    res: ServerResponse,
    rawPath: string,
  ): Promise<void> {
    res.setHeader('Cache-Control', 'no-store');
    if (!tokenMatches(req.headers.authorization, token)) {
      sendJson(res, 401, { error: 'unauthorized' });
      return;
    }

    const method = req.method ?? 'GET';
    const parts = pathParts(rawPath);

    if (parts.length === 2) {
      const name = parts[1];
      if (name === 'health' && method === 'GET') {
        sendJson(res, 200, { ok: true, version: opts.engine.version });
        return;
      }
      if (name === 'permissions' && method === 'GET') {
        sendJson(res, 200, await opts.engine.permissions());
        return;
      }
      if (name === 'rules' && method === 'GET') {
        sendJson(res, 200, opts.engine.listRules());
        return;
      }
      if (name === 'runs' && method === 'GET') {
        sendJson(res, 200, await opts.engine.listRuns());
        return;
      }
      if (name === 'scans' && method === 'POST') {
        await startScan(req, res);
        return;
      }
      if (name === 'plans' && method === 'POST') {
        await createPlan(req, res);
        return;
      }
      if (name === 'executions' && method === 'POST') {
        await startExecution(req, res);
        return;
      }
      if (name === 'app-scans' && method === 'POST') {
        await startAppScan(req, res);
        return;
      }
      if (name === 'app-plans' && method === 'POST') {
        await createAppPlan(req, res);
        return;
      }
      if (name === 'shutdown' && method === 'POST') {
        await shutdown(req, res);
        return;
      }
    }

    if (parts.length === 3 && parts[1] === 'jobs' && method === 'GET') {
      const jobId = parts[2] ?? '';
      const job = jobs.get(jobId);
      if (!job) {
        sendJson(res, 404, { error: 'not-found' });
        return;
      }
      sendJson(res, 200, {
        id: job.id,
        kind: job.kind,
        state: job.state,
        progress: job.progress,
        error: job.error,
        result: job.result,
      });
      return;
    }

    if (parts.length === 4) {
      const id = parts[2] ?? '';
      const action = parts[3];
      if (parts[1] === 'jobs' && action === 'events' && method === 'GET') {
        streamJobEvents(req, res, id);
        return;
      }
      if (parts[1] === 'jobs' && action === 'cancel' && method === 'POST') {
        await cancelJob(req, res, id);
        return;
      }
      if (parts[1] === 'runs' && action === 'undo' && method === 'POST') {
        await undoRun(req, res, id);
        return;
      }
      if (parts[1] === 'apps' && action === 'quit' && method === 'POST') {
        await quitApp(req, res, id);
        return;
      }
      if (parts[1] === 'apps' && action === 'icon' && method === 'GET') {
        await serveAppIcon(res, id);
        return;
      }
    }

    sendJson(res, 404, { error: 'not-found' });
  }

  async function startScan(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!requireJsonContentType(req, res)) return;
    const body = await readJsonBody(req, res);
    if (body === undefined) return;
    if (!scanBodySchema.safeParse(body).success) {
      sendJson(res, 400, { error: 'invalid-body' });
      return;
    }
    const job = jobs.start('scan', async (ctx) => {
      let lastProgress = 0;
      return opts.engine.audit({
        signal: ctx.signal,
        onProgress: (progress) => {
          const now = Date.now();
          if (now - lastProgress >= PROGRESS_THROTTLE_MS) {
            lastProgress = now;
            ctx.emit('progress', progress);
          }
        },
      });
    });
    sendJson(res, 200, { jobId: job.id });
  }

  async function createPlan(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!requireJsonContentType(req, res)) return;
    const body = await readJsonBody(req, res);
    if (body === undefined) return;
    const parsed = planBodySchema.safeParse(body);
    if (!parsed.success) {
      sendJson(res, 400, { error: 'invalid-body' });
      return;
    }
    const scanJob = jobs.get(parsed.data.scanJobId);
    if (!scanJob) {
      sendJson(res, 404, { error: 'unknown-scan' });
      return;
    }
    if (scanJob.state !== 'done') {
      sendJson(res, 409, { error: 'scan-not-done' });
      return;
    }
    const plan = opts.engine.buildPlan(
      scanJob.result as AuditResult,
      parsed.data.selection as PlanSelection,
    );
    storePlan(plan);
    sendJson(res, 200, plan);
  }

  function storePlan(plan: CleanupPlan): void {
    plans.set(plan.id, plan);
    while (plans.size > MAX_PLANS) {
      const oldest = plans.keys().next().value;
      if (oldest === undefined) break;
      plans.delete(oldest);
    }
  }

  async function createAppPlan(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!requireJsonContentType(req, res)) return;
    const body = await readJsonBody(req, res);
    if (body === undefined) return;
    const parsed = appPlanBodySchema.safeParse(body);
    if (!parsed.success) {
      sendJson(res, 400, { error: 'invalid-body' });
      return;
    }
    const appScanJob = jobs.get(parsed.data.appScanJobId);
    if (!appScanJob) {
      sendJson(res, 404, { error: 'unknown-app-scan' });
      return;
    }
    if (appScanJob.state !== 'done') {
      sendJson(res, 409, { error: 'app-scan-not-done' });
      return;
    }
    const reports = (appScanJob.result as AppReport[] | undefined) ?? [];
    const report = reports.find((entry) => entry.app.bundleId === parsed.data.bundleId);
    if (!report) {
      sendJson(res, 404, { error: 'unknown-bundle-id' });
      return;
    }
    const plan = await opts.engine.buildAppPlan(report);
    storePlan(plan);
    sendJson(res, 200, plan);
  }

  async function startExecution(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!requireJsonContentType(req, res)) return;
    const body = await readJsonBody(req, res);
    if (body === undefined) return;
    const parsed = executionBodySchema.safeParse(body);
    if (!parsed.success) {
      sendJson(res, 400, { error: 'invalid-body' });
      return;
    }
    const plan = plans.get(parsed.data.planId);
    if (!plan) {
      sendJson(res, 404, { error: 'unknown-plan' });
      return;
    }
    if (jobs.runningOfKind('execute')) {
      sendJson(res, 409, { error: 'execution-in-progress' });
      return;
    }

    let items = plan.items;
    if (parsed.data.itemIds) {
      const known = new Set(plan.items.map((item) => item.id));
      const unknown = parsed.data.itemIds.filter((id) => !known.has(id));
      if (unknown.length > 0) {
        sendJson(res, 400, { error: 'unknown-item-ids' });
        return;
      }
      const wanted = new Set(parsed.data.itemIds);
      items = plan.items.filter((item) => wanted.has(item.id));
    }
    const executePlan: CleanupPlan = { ...plan, items };

    const job = jobs.start('execute', (ctx) =>
      opts.engine.executePlan(executePlan, {
        apply: parsed.data.apply,
        confirmedRuleIds: parsed.data.confirmedRuleIds,
        signal: ctx.signal,
        onItem: (result) => ctx.emit('item', result),
      }),
    );
    sendJson(res, 200, { jobId: job.id });
  }

  async function startAppScan(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!requireJsonContentType(req, res)) return;
    const body = await readJsonBody(req, res);
    if (body === undefined) return;
    if (!scanBodySchema.safeParse(body).success) {
      sendJson(res, 400, { error: 'invalid-body' });
      return;
    }
    const job = jobs.start('apps', (ctx) => opts.engine.appReports({ signal: ctx.signal }));
    lastAppsJob = job;
    sendJson(res, 200, { jobId: job.id });
  }

  async function serveAppIcon(res: ServerResponse, bundleId: string): Promise<void> {
    if (!BUNDLE_ID_RE.test(bundleId)) {
      sendJson(res, 400, { error: 'invalid-bundle-id' });
      return;
    }
    const job = lastAppsJob;
    if (!job || job.state !== 'done') {
      sendJson(res, 404, { error: 'not-found' });
      return;
    }
    const reports = (job.result as AppReport[] | undefined) ?? [];
    if (!reports.some((report) => report.app.bundleId === bundleId)) {
      sendJson(res, 404, { error: 'not-found' });
      return;
    }
    const icon = await opts.engine.appIcon(bundleId);
    if (!icon) {
      sendJson(res, 404, { error: 'not-found' });
      return;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.end(icon);
  }

  async function cancelJob(
    req: IncomingMessage,
    res: ServerResponse,
    id: string,
  ): Promise<void> {
    if (!requireJsonContentType(req, res)) return;
    req.resume();
    if (!jobs.get(id)) {
      sendJson(res, 404, { error: 'not-found' });
      return;
    }
    jobs.cancel(id);
    sendJson(res, 200, { ok: true });
  }

  async function undoRun(
    req: IncomingMessage,
    res: ServerResponse,
    runId: string,
  ): Promise<void> {
    if (!requireJsonContentType(req, res)) return;
    req.resume();
    if (!RUN_ID_RE.test(runId)) {
      sendJson(res, 400, { error: 'invalid-run-id' });
      return;
    }
    const results = await opts.engine.undoRun(runId);
    sendJson(res, 200, { results });
  }

  async function quitApp(
    req: IncomingMessage,
    res: ServerResponse,
    bundleId: string,
  ): Promise<void> {
    if (!requireJsonContentType(req, res)) return;
    req.resume();
    if (!BUNDLE_ID_RE.test(bundleId)) {
      sendJson(res, 400, { error: 'invalid-bundle-id' });
      return;
    }
    const result = await opts.engine.quitApp(bundleId);
    sendJson(res, 200, { quit: result.quit });
  }

  async function shutdown(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!requireJsonContentType(req, res)) return;
    req.resume();
    sendJson(res, 200, { ok: true });
    res.on('finish', () => {
      void close();
    });
  }

  function streamJobEvents(req: IncomingMessage, res: ServerResponse, id: string): void {
    const job = jobs.get(id);
    if (!job) {
      sendJson(res, 404, { error: 'not-found' });
      return;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/x-ndjson');
    openStreams.add(res);

    let finished = false;
    let unsubscribe: () => void = () => {};
    const finish = (): void => {
      if (finished) return;
      finished = true;
      openStreams.delete(res);
      unsubscribe();
      res.end();
    };
    unsubscribe = jobs.subscribe(id, (event) => {
      if (finished) return;
      res.write(`${JSON.stringify({ event: event.event, data: event.data })}\n`);
      if (event.event === 'done' || event.event === 'error') finish();
    });
    req.on('close', () => {
      if (finished) return;
      finished = true;
      openStreams.delete(res);
      unsubscribe();
    });
    res.on('error', () => {
      if (finished) return;
      finished = true;
      openStreams.delete(res);
      unsubscribe();
    });
  }

  async function routeStatic(
    req: IncomingMessage,
    res: ServerResponse,
    rawPath: string,
  ): Promise<void> {
    const method = req.method ?? 'GET';
    if (method !== 'GET' && method !== 'HEAD') {
      sendStatus(res, 405, 'GET, HEAD');
      return;
    }
    const assetsDir = opts.assetsDir;
    if (!assetsDir) {
      sendJson(res, 404, { error: 'not-found' });
      return;
    }

    const root = resolve(assetsDir);
    let relPath: string;
    try {
      relPath = decodeURIComponent(rawPath).replace(/^\/+/, '');
    } catch {
      sendJson(res, 400, { error: 'invalid-path' });
      return;
    }

    const requested = resolve(root, relPath);
    if (requested !== root && !requested.startsWith(root + sep)) {
      sendJson(res, 403, { error: 'forbidden' });
      return;
    }

    const target = extname(requested) === '' ? join(root, 'index.html') : requested;
    let data: Buffer;
    try {
      data = await readFile(target);
    } catch {
      sendJson(res, 404, { error: 'not-found' });
      return;
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', CONTENT_TYPES[extname(target)] ?? 'application/octet-stream');
    if (method === 'HEAD') res.end();
    else res.end(data);
  }

  return {
    url: `http://127.0.0.1:${port}/#t=${token}`,
    port,
    token,
    close,
    checkIdle,
  };
}
