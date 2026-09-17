#!/usr/bin/env node
// Records the reference-Mac audit baseline used by PLAN.md §12.
//
// Redaction lives in TypeScript (@macsweep/core), so instead of scanning with
// `audit --json` and redacting the result here, we ask the CLI for an
// already-redacted AuditResult: `report --json --redact`.

import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliEntry = path.join(repoRoot, 'packages', 'cli', 'dist', 'index.js');
const outFile = path.join(repoRoot, 'fixtures', 'baseline', 'audit.redacted.json');

function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

const { stdout } = await execFileAsync(process.execPath, [cliEntry, 'report', '--json', '--redact'], {
  cwd: repoRoot,
  maxBuffer: 512 * 1024 * 1024,
  env: { ...process.env, NO_COLOR: '1' },
});

const result = JSON.parse(stdout);

await mkdir(path.dirname(outFile), { recursive: true });
await writeFile(outFile, `${JSON.stringify(result, null, 2)}\n`);

const reclaimable = result.totals?.reclaimable ?? 0;
const findings = result.findings?.length ?? 0;
process.stdout.write(
  `recorded ${path.relative(repoRoot, outFile)} — reclaimable ${formatBytes(reclaimable)} · ${findings} findings\n`,
);
