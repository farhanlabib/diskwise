import { chmod, cp, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, '..');
const repoRoot = path.resolve(packageRoot, '..', '..');

const distDir = path.join(packageRoot, 'dist');

// A published CLI without its UI or helper is broken for every user, so a
// missing asset must fail the package build rather than be skipped.
function requireSource(src, label, buildCommand) {
  if (existsSync(src)) return;
  throw new Error(`${label} missing at ${src}; refusing to build a broken package. Run: ${buildCommand}`);
}

async function copyTree(src, dest, label, buildCommand) {
  requireSource(src, label, buildCommand);
  await mkdir(path.dirname(dest), { recursive: true });
  await cp(src, dest, { recursive: true });
}

async function copyFile(src, dest, label, buildCommand) {
  requireSource(src, label, buildCommand);
  await mkdir(path.dirname(dest), { recursive: true });
  const { mode } = await stat(src);
  await cp(src, dest);
  await chmod(dest, mode);
}

await copyTree(
  path.join(repoRoot, 'packages', 'ui', 'dist'),
  path.join(distDir, 'ui'),
  'web UI build (packages/ui/dist)',
  'pnpm -F @diskwise/ui build',
);

await copyFile(
  path.join(repoRoot, 'packages', 'native-helper', 'bin', 'diskwise-helper'),
  path.join(distDir, 'diskwise-helper'),
  'native helper (packages/native-helper/bin/diskwise-helper)',
  'packages/native-helper/build.sh',
);
