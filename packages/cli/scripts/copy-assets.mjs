import { chmod, cp, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, '..');
const repoRoot = path.resolve(packageRoot, '..', '..');

const distDir = path.join(packageRoot, 'dist');

function warn(message) {
  process.stderr.write(`${message}\n`);
}

async function copyTree(src, dest, label) {
  if (!existsSync(src)) {
    warn(`warning: ${label} not found at ${src}; skipping`);
    return;
  }
  await mkdir(path.dirname(dest), { recursive: true });
  await cp(src, dest, { recursive: true });
}

async function copyFile(src, dest, label) {
  if (!existsSync(src)) {
    warn(`warning: ${label} not found at ${src}; skipping`);
    return;
  }
  await mkdir(path.dirname(dest), { recursive: true });
  const { mode } = await stat(src);
  await cp(src, dest);
  await chmod(dest, mode);
}

await copyTree(
  path.join(repoRoot, 'packages', 'ui', 'dist'),
  path.join(distDir, 'ui'),
  'web UI build (packages/ui/dist)',
);

await copyFile(
  path.join(repoRoot, 'packages', 'native-helper', 'bin', 'diskwise-helper'),
  path.join(distDir, 'diskwise-helper'),
  'native helper (packages/native-helper/bin/diskwise-helper)',
);
