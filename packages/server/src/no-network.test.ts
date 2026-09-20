import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import dns from 'node:dns';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectTools } from '@diskwise/core';
import { startServer } from './server';
import type { ServerEngine } from './engine';

// The no-outbound-network guarantee is enforced in layers: eslint bans the
// network modules statically, run.ts stamps a hardened env onto every probe,
// and this suite blocks and records attempts at runtime while the flows run.
// Subprocesses cannot be patched, so they are fenced by proxy env vars pointed
// at a dead loopback port.
interface BlockedAttempt {
  kind: string;
  target: string;
}

const attempts: BlockedAttempt[] = [];

function isLoopbackHost(value: string): boolean {
  let name = value.trim().toLowerCase();
  const zone = name.indexOf('%');
  if (zone >= 0) name = name.slice(0, zone);
  if (name.startsWith('[') && name.includes(']')) {
    name = name.slice(1, name.indexOf(']'));
  } else if ((name.match(/:/g) ?? []).length === 1) {
    name = name.slice(0, name.indexOf(':'));
  }
  return name === 'localhost' || name === '::1' || name.startsWith('127.');
}

function targetHost(input: unknown): string | undefined {
  if (typeof input === 'string') {
    try {
      return new URL(input).hostname;
    } catch {
      return undefined;
    }
  }
  if (input instanceof URL) return input.hostname;
  if (typeof input === 'object' && input !== null) {
    const options = input as http.RequestOptions;
    return options.hostname ?? options.host ?? undefined;
  }
  return undefined;
}

function unused(what: string): never {
  throw new Error(`${what} is not exercised by this suite`);
}

function makeEngine(): ServerEngine {
  return {
    version: '0.0.0',
    async audit() {
      return unused('audit');
    },
    listRules() {
      return [];
    },
    buildPlan() {
      return unused('buildPlan');
    },
    async executePlan() {
      return unused('executePlan');
    },
    async listRuns() {
      return [];
    },
    async undoRun() {
      return [];
    },
    async appReports() {
      return [];
    },
    async appIcon() {
      return unused('appIcon');
    },
    async buildAppPlan() {
      return unused('buildAppPlan');
    },
    async permissions() {
      return { fullDiskAccess: 'granted' };
    },
    async quitApp() {
      return { quit: true };
    },
  };
}

const originalRequest = http.request;
const originalLookup = dns.lookup;
const originalFetch = globalThis.fetch;
const savedEnv: Array<[string, string | undefined]> = [];

beforeAll(() => {
  const proxyUrl = 'http://127.0.0.1:9';
  const proxyKeys = [
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'ALL_PROXY',
    'http_proxy',
    'https_proxy',
    'all_proxy',
  ];
  for (const key of [...proxyKeys, 'NO_PROXY', 'no_proxy']) {
    savedEnv.push([key, process.env[key]]);
  }
  for (const key of proxyKeys) process.env[key] = proxyUrl;
  process.env.NO_PROXY = '';
  process.env.no_proxy = '';

  http.request = ((...args: unknown[]) => {
    const host = targetHost(args[0]);
    if (host !== undefined && !isLoopbackHost(host)) {
      attempts.push({ kind: 'http.request', target: host });
      throw new Error(`outbound connection blocked: ${host}`);
    }
    return (originalRequest as unknown as (...a: unknown[]) => http.ClientRequest)(...args);
  }) as unknown as typeof http.request;

  dns.lookup = ((hostname: string, ...rest: unknown[]) => {
    if (!isLoopbackHost(hostname)) {
      attempts.push({ kind: 'dns.lookup', target: hostname });
      throw new Error(`outbound DNS lookup blocked: ${hostname}`);
    }
    return (originalLookup as unknown as (...a: unknown[]) => unknown)(hostname, ...rest);
  }) as unknown as typeof dns.lookup;

  globalThis.fetch = (async (input: Parameters<typeof originalFetch>[0], init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    const { hostname } = new URL(url);
    if (!isLoopbackHost(hostname)) {
      attempts.push({ kind: 'fetch', target: hostname });
      throw new Error(`outbound fetch blocked: ${url}`);
    }
    return originalFetch(input, init);
  }) as unknown as typeof globalThis.fetch;
});

afterAll(() => {
  http.request = originalRequest;
  dns.lookup = originalLookup;
  globalThis.fetch = originalFetch;
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

beforeEach(() => {
  attempts.length = 0;
});

interface LoopbackResponse {
  status: number;
  text: string;
}

function loopbackRequest(
  port: number,
  opts: { path: string; headers?: Record<string, string> },
): Promise<LoopbackResponse> {
  return new Promise((resolveRequest, rejectRequest) => {
    const req = originalRequest(
      {
        host: '127.0.0.1',
        port,
        method: 'GET',
        path: opts.path,
        headers: opts.headers ?? {},
      },
      (res) => {
        const chunks: string[] = [];
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => chunks.push(chunk));
        res.on('end', () =>
          resolveRequest({ status: res.statusCode ?? 0, text: chunks.join('') }),
        );
      },
    );
    req.on('error', rejectRequest);
    req.end();
  });
}

function expectNoAttempts(): void {
  expect(attempts).toEqual([]);
}

const servers: { close(): Promise<void> }[] = [];
const tempDirs: string[] = [];

afterEach(async () => {
  while (servers.length > 0) {
    await servers.pop()!.close();
  }
  while (tempDirs.length > 0) {
    await rm(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe.skipIf(process.platform !== 'darwin')('no outbound network', () => {
  it('serves the local UI flow without any connection attempt', async () => {
    const assetsDir = await mkdtemp(join(tmpdir(), 'diskwise-nonet-'));
    tempDirs.push(assetsDir);
    await writeFile(join(assetsDir, 'index.html'), '<!doctype html><html><body>diskwise</body></html>');
    await mkdir(join(assetsDir, 'assets'));
    await writeFile(join(assetsDir, 'assets', 'app.js'), 'export const ok = true;\n');

    const handle = await startServer({ engine: makeEngine(), assetsDir });
    servers.push(handle);
    const auth = { authorization: `Bearer ${handle.token}` };

    const page = await loopbackRequest(handle.port, { path: '/' });
    expect(page.status).toBe(200);
    expect(page.text).toContain('diskwise');

    const asset = await loopbackRequest(handle.port, { path: '/assets/app.js' });
    expect(asset.status).toBe(200);

    const health = await loopbackRequest(handle.port, { path: '/api/health', headers: auth });
    expect(health.status).toBe(200);
    expect(JSON.parse(health.text)).toEqual({ ok: true, version: '0.0.0' });

    const rules = await loopbackRequest(handle.port, { path: '/api/rules', headers: auth });
    expect(rules.status).toBe(200);
    expect(JSON.parse(rules.text)).toEqual([]);

    const runs = await loopbackRequest(handle.port, { path: '/api/runs', headers: auth });
    expect(runs.status).toBe(200);
    expect(JSON.parse(runs.text)).toEqual([]);

    expectNoAttempts();
  });

  it('detects CLI tools without any connection attempt', async () => {
    const tools = await detectTools();

    for (const tool of tools) {
      if (tool.path !== undefined) {
        expect(tool.path.startsWith('/')).toBe(true);
        expect(existsSync(tool.path)).toBe(true);
      }
    }

    expectNoAttempts();
  });
});

const uiDist = fileURLToPath(new URL('../../ui/dist', import.meta.url));
const TEXT_EXTENSIONS = new Set(['.html', '.css', '.js', '.mjs', '.json', '.svg', '.txt', '.map']);
// Loopback is the app's own server; www.w3.org is SVG/HTML namespace strings,
// react.dev links are error-decoder text, and tailwindcss.com is the version
// banner in the generated CSS, none of them loaded resources.
const ALLOWED_HOSTS = new Set([
  '127.0.0.1',
  'localhost',
  'www.w3.org',
  'react.dev',
  'reactjs.org',
  'tailwindcss.com',
]);
const EXTERNAL_URL_RE = /https?:\/\/[^\s"'`<>\\)]+/g;

describe('packaged ui assets', () => {
  it.skipIf(!existsSync(uiDist))('ships no external runtime resources', async () => {
    const entries = await readdir(uiDist, { recursive: true, withFileTypes: true });
    const files = entries.filter(
      (entry) => entry.isFile() && TEXT_EXTENSIONS.has(extname(entry.name)),
    );
    expect(files.length).toBeGreaterThan(0);

    const violations: string[] = [];
    for (const entry of files) {
      const text = await readFile(join(entry.parentPath, entry.name), 'utf8');
      for (const match of text.matchAll(EXTERNAL_URL_RE)) {
        let host: string;
        try {
          host = new URL(match[0]).hostname;
        } catch {
          continue;
        }
        if (!ALLOWED_HOSTS.has(host)) {
          violations.push(`${relative(uiDist, join(entry.parentPath, entry.name))}: ${match[0]}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
