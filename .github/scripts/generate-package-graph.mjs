#!/usr/bin/env node
// Generates docs/package-graph.md: a Mermaid graph of the pnpm workspace packages
// and the edges between them, built from package.json manifests plus static
// imports found under packages/*/src. Node stdlib only — no dependencies.
//
// Run by .github/workflows/graphify.yml (push to main commits a refresh;
// pull requests upload it as an artifact). Safe to run locally: `node
// .github/scripts/generate-package-graph.mjs`.

import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const outputFile = join(root, 'docs', 'package-graph.md');

// --- workspace discovery (minimal glob support for pnpm-workspace.yaml) ---

const globs = [];
let inPackages = false;
for (const raw of readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8').split('\n')) {
  const line = raw.replace(/#.*$/, '');
  if (/^\S/.test(line)) inPackages = /^packages\s*:/.test(line);
  if (!inPackages) continue;
  const item = line.match(/^\s*-\s*['"]?([^'"]+?)['"]?\s*$/);
  if (item) globs.push(item[1].trim());
}
if (globs.length === 0) throw new Error('no workspace globs found in pnpm-workspace.yaml');

function globToRegex(glob) {
  const source = glob
    .split('/')
    .map((segment) => {
      if (segment === '**') return '(.+?)';
      let out = '';
      for (const ch of segment) {
        if (ch === '*') out += '[^/]+';
        else if (ch === '?') out += '[^/]';
        else out += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
      }
      return out;
    })
    .join('/');
  return new RegExp(`^${source}$`);
}

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage']);

function* walkDirs(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    yield full;
    yield* walkDirs(full);
  }
}

function* walkFiles(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walkFiles(join(dir, entry.name));
    } else {
      yield join(dir, entry.name);
    }
  }
}

const packages = [];
for (const full of walkDirs(root)) {
  const rel = relative(root, full).split(sep).join('/');
  if (!globs.some((g) => globToRegex(g).test(rel))) continue;
  const manifestPath = join(root, rel, 'package.json');
  if (!existsSync(manifestPath)) continue;
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  packages.push({ name: manifest.name ?? rel, dir: rel, manifest });
}
if (packages.length === 0) throw new Error('no workspace packages matched');
packages.sort((a, b) => a.name.localeCompare(b.name));

const byName = new Map(packages.map((p) => [p.name, p]));

// --- edges: declared workspace dependencies ---

const declared = new Map();
for (const pkg of packages) {
  const deps = new Set();
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    for (const dep of Object.keys(pkg.manifest[section] ?? {})) {
      if (dep !== pkg.name && byName.has(dep)) deps.add(dep);
    }
  }
  declared.set(pkg.name, deps);
}

// --- edges: imports of other workspace packages in packages/*/src ---

const IMPORT_RE = /(?:\bfrom\s+|\bimport\s+|\bimport\(\s*|\brequire\(\s*)['"]([^'"]+)['"]/g;

function resolveSpecifier(specifier) {
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('node:')) return null;
  if (byName.has(specifier)) return specifier;
  let best = null;
  for (const name of byName.keys()) {
    if (specifier.startsWith(`${name}/`) && (!best || name.length > best.length)) best = name;
  }
  return best;
}

const imported = new Map();
for (const pkg of packages) {
  const srcDir = join(root, pkg.dir, 'src');
  if (!existsSync(srcDir)) continue;
  const deps = new Set();
  for (const file of walkFiles(srcDir)) {
    if (!/\.[cm]?[jt]sx?$/.test(file)) continue;
    for (const match of readFileSync(file, 'utf8').matchAll(IMPORT_RE)) {
      const dep = resolveSpecifier(match[1]);
      if (dep && dep !== pkg.name) deps.add(dep);
    }
  }
  imported.set(pkg.name, deps);
}

// --- merge and emit ---

const edges = [];
for (const pkg of packages) {
  for (const dep of declared.get(pkg.name)) edges.push({ from: pkg.name, to: dep, declared: true });
  for (const dep of imported.get(pkg.name) ?? []) {
    if (!declared.get(pkg.name)?.has(dep)) edges.push({ from: pkg.name, to: dep, declared: false });
  }
}
edges.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.declared - b.declared);

const nodeId = (name) => `p_${name.replace(/[^A-Za-z0-9]/g, '_')}`;

const mermaid = ['flowchart TD'];
for (const pkg of packages) {
  mermaid.push(`  ${nodeId(pkg.name)}["${pkg.name}<br/>${pkg.dir}"]`);
}
for (const edge of edges) {
  mermaid.push(
    edge.declared
      ? `  ${nodeId(edge.from)} --> ${nodeId(edge.to)}`
      : `  ${nodeId(edge.from)} -.->|"undeclared import"| ${nodeId(edge.to)}`,
  );
}

const table = ['| Package | Path | Declared workspace dependencies |', '| --- | --- | --- |'];
for (const pkg of packages) {
  const deps = [...declared.get(pkg.name)].sort().map((d) => `\`${d}\``).join(', ') || '—';
  table.push(`| \`${pkg.name}\` | \`${pkg.dir}\` | ${deps} |`);
}

const output = `<!-- Generated by .github/scripts/generate-package-graph.mjs — do not edit by hand.
     Regenerated on pushes to main and PRs touching packages/** (see docs/graphify.md). -->

# Package dependency graph

Built from the \`pnpm-workspace.yaml\` manifests and the static imports under
\`packages/*/src\`. Solid arrows are declared workspace dependencies; dotted arrows
are imports found in source without a matching manifest entry. See
[graphify.md](./graphify.md) for how this file is produced.

\`\`\`mermaid
${mermaid.join('\n')}
\`\`\`

${table.join('\n')}
`;

writeFileSync(outputFile, output);

const undeclared = edges.filter((e) => !e.declared);
console.log(`package graph: ${packages.length} packages, ${edges.length} edges -> ${relative(root, outputFile)}`);
for (const edge of undeclared) console.log(`  undeclared import: ${edge.from} -> ${edge.to}`);
