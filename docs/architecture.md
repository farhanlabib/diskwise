# macsweep architecture

macsweep is a pnpm + TypeScript monorepo with one shared engine and two frontends (a CLI and a local web UI). This document describes how the packages fit together, the pipeline data flows through, the shared contracts, how vendor tools are tested without running them, and the size definitions the whole product rests on.

## Packages

```
                ┌────────────────────────────────────────────┐
                │        packages/cli  (macsweep)            │
                │  the published binary: bundles server,     │
                │  UI assets, and the native helper          │
                └───────┬──────────────┬──────────────┬──────┘
                        │              │              │
                        ▼              ▼              ▼
              ┌───────────────┐ ┌─────────────┐ ┌──────────────────┐
              │packages/report│ │packages/    │ │ packages/ui      │
              │ table · json  │ │  server     │ │ React+Vite+TW    │
              │ · markdown    │ │ loopback API│ │ built to static  │
              └───────┬───────┘ │  + SSE      │ │ assets, served   │
                      │         └──────┬──────┘ │ from memory      │
                      │                │        └──────────────────┘
                      ▼                ▼
              ┌───────────────────────────────────────────────────┐
              │                 packages/core                     │
              │  fs/ (allocated-size, walker, path-safety)        │
              │  sources/ (disk, permissions, snapshots,          │
              │            system-data, apps)                     │
              │  probes/ (execFile runner, bin-resolver, replay)  │
              │  rules/ (schema, matchers, catalog/*.ts, lint)    │
              │  apps/ (inventory, profiles/*.ts, orphans)        │
              │  scan/ · plan/ · execute/ · safety/               │
              │  journal.ts · redact.ts                           │
              └───────────────────────┬───────────────────────────┘
                                      │ execFile, argv arrays, JSON
                                      ▼
                        ┌──────────────────────────────┐
                        │  packages/native-helper       │
                        │  Swift CLI, universal binary, │
                        │  ad-hoc signed (no Developer  │
                        │  ID): trash, privatesize,     │
                        │  capacity, running-apps,      │
                        │  quit-app, walk, icon         │
                        └──────────────────────────────┘
```

- **`@macsweep/core`** is the entire engine: measurement, sources, probes, the rule schema and matchers, app inventory and profiles, and the plan/execute/safety pipeline. It is the only place that reasons about paths and bytes.
- **`@macsweep/report`** renders findings to a table, versioned JSON, or markdown. It is pure formatting over core types.
- **`@macsweep/server`** is a loopback-only `node:http` server with a small hand-written router and SSE progress. It serves the UI and exposes jobs over core. It is the only package allowed to import `http`.
- **`@macsweep/ui`** is React + Vite + Tailwind, built to static assets with no CDN or web fonts. The CLI embeds the assets and the server serves them from memory.
- **`macsweep` (CLI)** is the published package. It bundles the server, the UI assets, and the native helper so one install gives you both frontends.
- **`packages/native-helper`** is a small Swift CLI for the few things Node cannot do safely: `NSFileManager` Trash moves with Put Back, clone-aware private size, purgeable capacity, running-app detection, graceful quit, and app icons.

## Pipeline

```
sources + rules + app profiles → scan → Finding[] → plan (CleanupPlan) → execute (via ActionId) → journal
                                          ↘ report (table | json | markdown)
```

- **`scan/`** runs matchers with bounded concurrency, resolves path ownership (each path belongs to exactly one finding; precedence is known app profile > specific rule > generic heuristic), captures `dev`/`ino` identity, and produces `Finding[]`.
- **`plan/`** turns findings into a selectable, serializable `CleanupPlan` (`plan.json`) with per-tier, per-category, per-app, and grand totals. This is also the only thing the server API will execute.
- **`execute/`** orders actions, runs preflight and identity checks, re-verifies the plan, and executes through an `ActionId` — dry-run by default.
- **`journal.ts`** writes a write-ahead JSONL log at `~/.macsweep/journal/<timestamp>.jsonl`: an **intent** record before each action and a **result** record after it. A lockfile at `~/.macsweep/lock` serializes runs across the CLI and the UI, and the recorded trashed URLs make `undo` possible.
- **`report/`** is a side branch off the plan: the same data, formatted for humans or machines. `redact.ts` rewrites home directories, hostnames, volume names, and email-like segments before a report leaves the machine.

## Data contracts

Every module builds against the types in [`packages/core/src/types.ts`](../packages/core/src/types.ts). The key ones:

| Type                          | Purpose                                                                                                                                                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Tier`, `TIER_NAMES`          | The four safety tiers (`0 REGENERATES`, `1 REDOWNLOAD`, `2 USER_DATA`, `3 NEVER`).                                                                                                                                 |
| `Category`                    | `dev`, `system`, `browser`, `app`, `user-data`, `os-leftovers`.                                                                                                                                                    |
| `Rule`                        | Declarative rule data: `id`, `tier`, `roots` (allowlist), `matcher`, `action`, `rationale`, `regeneration`, `preflight`, `minBytes`, `needsRoot`, `manualCommand`, `permanentOnly`. Validated by zod at load time. |
| `MatcherSpec`                 | The declarative matchers: `path`, `glob-children`, `project-dirs`, `probe`. No rule contains arbitrary code.                                                                                                       |
| `Candidate`                   | What a matcher returns before sizing: `kind` (`dir`/`file`/`virtual`), `path`, `detail`, optional `bytesHint`, `tierOverride`, `reportOnly`.                                                                       |
| `Match`                       | A sized candidate: adds `dev`/`ino` identity, `bytesAllocated`, `bytesApparent`, `bytesReclaimable`, and `unreadable`.                                                                                             |
| `Finding`                     | A rule's matched set with its tier, rationale, regeneration cost, action, `blockedBy`, and totals.                                                                                                                 |
| `SizeInfo` / `WalkResult`     | Allocation totals plus `entries`, `unreadable` entries, `cloudPlaceholders`, and `truncated`/`aborted` flags.                                                                                                      |
| `WalkOptions`                 | Walker bounds: `maxDepth`, `maxEntries`, `signal`, `onProgress`, `skip`, a shared `seen` set for hardlink dedupe, and `concurrency`.                                                                               |
| `DiskInfo`                    | Container and volume totals, `caseSensitive`, and optional `purgeable`.                                                                                                                                            |
| `PermissionStatus`            | Full Disk Access as `granted`/`limited`/`unknown`, plus the host app to grant.                                                                                                                                     |
| `AuditResult`                 | The top-level, versioned report: `findings`, `traps`, `unreadable`, and totals by tier.                                                                                                                            |
| `Trap`                        | A file whose apparent size far exceeds its allocated size (the `Docker.raw` case).                                                                                                                                 |
| `ProbeResult` / `ProbeRunner` | The `execFile` result shape and the runner signature used by matchers and sources.                                                                                                                                 |
| `MatcherContext`              | What a matcher receives: `home`, `now`, an `AbortSignal`, and the probe runner.                                                                                                                                    |

## Probe replay

macsweep leans on vendor tools (`xcrun simctl`, `docker`, `brew`, `diskutil`, `tmutil`, `plutil`, `mdls`) but never parses their output live in tests. `probes/run.ts` is an `execFile`-only runner (argv arrays, never a shell, with timeouts and a hardened environment), and every probe and source can be pointed at **recorded output** in `fixtures/probes/`.

This matters because CI cannot reproduce the real world: GitHub's macOS runners have no Docker, and simulator runtimes differ per machine. So:

- Unit and rule tests replay recorded output and assert exact parsing.
- Live smoke tests run only when the tool is present, and are skipped otherwise.
- The same recorded fixtures feed the golden measurement tests, so a change in parsing is caught before it reaches a disk.

Replay also keeps the no-network guarantee testable: the runner never reaches out, and the lint rules in `eslint.config.js` ban the modules that could.

## Measurement definitions

Sizes are the product, so the terms are exact and never mixed:

- **Allocated** — `lstat().blocks * 512`. What the file actually occupies on disk, including block rounding. This is the number macsweep reports by default.
- **Apparent** — `lstat().size`. What `ls -l` shows. A sparse file like `Docker.raw` can be 228 GB apparent and 2.7 GB allocated; macsweep flags that gap as a trap instead of alarming the user.
- **Reclaimable** — the bytes that would actually be freed if the target were deleted. v0.1 uses allocated bytes with hardlink dedupe (each `(dev, ino)` is counted once across the whole scan). From v0.3, the native helper reads `ATTR_CMNEXT_PRIVATESIZE`, which is clone-aware: APFS clones share extents, so allocated bytes would count them once per clone and overstate the win.

Two more invariants fall out of this:

- The walker **never follows symlinks** and **never crosses a device boundary** (`st_dev` change), so mounted images and simulator runtime volumes are never double-counted.
- Cloud placeholders (`SF_DATALESS` under `~/Library/CloudStorage` and `~/Library/Mobile Documents`) are `lstat`-ed only and **never opened**, because opening one triggers a download. They are labeled "cloud placeholder, 0 bytes local".
