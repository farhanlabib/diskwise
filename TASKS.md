# macsweep — Task Breakdown

Based on `PLAN.md` with the adjustments in `AUDIT.md` applied. IDs are stable. `deps` lists blocking tasks. Size: S ≤ ½ day, M ≈ 1–2 days, L ≈ 3–5 days.

---

## Phase 0 — Decisions & setup

| ID | Task | Size | Deps | Done when |
|---|---|---|---|---|
| P0-1 | Check `macsweep` / `@macsweep` on npm, Homebrew and GitHub. Do a quick trademark check on "Mac" in the app name | S | — | Names chosen and written into PLAN §2 |
| P0-2 | ~~Fold the AUDIT.md adjustments into PLAN.md~~ **Done (PLAN v2, includes Apps feature)** | S | — | PLAN.md updated, AUDIT marked resolved |
| P0-5 | ~~Apple Developer ID~~ **Not needed.** Create a `homebrew-tap` repo instead | S | P0-4 | Tap repo exists |
| P0-3 | Pin decisions: macOS ≥ 14, Apple Silicon + Intel, Node ≥ 20, ESM, tsup build, drop update check in v1 | S | — | Listed in PLAN §2 |
| P0-4 | `git init`, create GitHub repo, MIT LICENSE, `.gitignore`, `.editorconfig` | S | P0-1 | Repo pushed |

## Phase 1 — Monorepo scaffold

| ID | Task | Size | Deps | Done when |
|---|---|---|---|---|
| S-1 | pnpm workspace: `packages/core`, `packages/report`, `packages/cli`, `packages/server`, `packages/ui`, `packages/native-helper`, `fixtures/` | S | P0-4 | `pnpm -r build` succeeds on empty packages |
| S-2 | `tsconfig.base.json` (strict, `noUncheckedIndexedAccess`), project references | S | S-1 | `pnpm -r typecheck` green |
| S-3 | ESLint + Prettier. Ban `https`/`net`/`dgram`/`undici`/global `fetch` everywhere, and `http` everywhere except `packages/server`. Ban `child_process.exec` (only `execFile`) | S | S-1 | Lint fails on a planted violation |
| S-4 | Vitest workspace config, coverage thresholds for core | S | S-1 | `pnpm test` runs |
| S-5 | CI: ubuntu job (lint, typecheck, unit) + macos-15 job (measurement, integration) | M | S-2..S-4 | Both jobs green on PR |

## Phase 2 — v0.1 Walking skeleton (audit only, no execution path)

### Measurement
| ID | Task | Size | Deps | Done when |
|---|---|---|---|---|
| M-1 | `fs/allocated-size.ts`: allocated (`blocks*512`) + apparent sizes, cloud placeholder detection (`SF_DATALESS` / blocks=0 under CloudStorage), never opens files | S | S-2 | Unit tests for sparse file and placeholder |
| M-2 | `fs/walker.ts`: async pooled walker, `UV_THREADPOOL_SIZE` setup, never follows symlinks, `(dev,ino)` hardlink dedupe, no crossing `st_dev`, skip list (`/System/Volumes/Data`, `/Volumes`, `/dev`), depth/entry budgets, `AbortSignal`, progress events | L | M-1 | Golden tests pass; cancel within 200 ms |
| M-3 | EPERM/EACCES handling → `unreadable` totals by subtree | S | M-2 | Fixture with chmod 000 dir reported as Unreadable |
| M-4 | Golden fixture builder (macOS): known sizes, sparse files, hardlinks, symlink cycles, nested mounts (hdiutil image) | M | M-2 | Exact-byte assertions on macOS CI |
| M-5 | Perf benchmark script (`pnpm bench:walk`) against `~` | S | M-2 | Numbers recorded in docs/architecture.md |

### Sources
| ID | Task | Size | Deps | Done when |
|---|---|---|---|---|
| SRC-1 | `sources/disk.ts`: `diskutil info -plist /` + `diskutil apfs list -plist` parsing (container total/used/free) | M | S-2 | Parsed from recorded plist fixtures |
| SRC-2 | `sources/permissions.ts`: Full Disk Access probe + which host app (Terminal/iTerm/VS Code) to grant | S | S-2 | Returns `granted | limited` with hint |
| SRC-3 | `bin-resolver.ts`: known prefixes → login-shell fallback → cache. Hardened env (`HOMEBREW_NO_AUTO_UPDATE`, etc.) | M | S-2 | Resolves brew/xcrun with `PATH=/usr/bin:/bin` |
| SRC-4 | Probe runner: `execFile` wrapper with timeout and recorded-output replay for tests (`fixtures/probes/`) | M | SRC-3 | Replay mode used in unit tests |

### Rules
| ID | Task | Size | Deps | Done when |
|---|---|---|---|---|
| R-1 | `rules/schema.ts` with zod: `schemaVersion`, id, title, category, tier, `macos` semver range, `requires`, `roots`, declarative `matcher`, `action`, `rationale`, `regeneration`, `preflight`, `minBytes`, `manualCommand`, `needsRoot`, `permanentOnly` | M | S-2 | Invalid rule fixtures rejected |
| R-2 | Matcher registry: `path`, `glob-children`, `project-dirs`, `probe` | M | R-1, M-2 | Each matcher unit tested |
| R-3 | Rule `xcode.derived-data` (T0) | S | R-2 | Fixture test |
| R-4 | Probe `simctl-runtimes` + rule `simulator.runtimes` (T1), mark booted/unused | M | R-2, SRC-4 | Replay fixture test |
| R-5 | Rule `dev.node-modules` with guards: `package.json` marker, not nested, global-prefix exclusion, age threshold, no-lockfile → T2 report-only | M | R-2 | Adversarial fixtures (global prefix, nested, no lockfile) |
| R-6 | `rules:validate` script (same as CI) + safety lint: `remove-path` only T0/T1, roots from approved list | S | R-1 | Lint rejects planted dangerous rule |
| R-7 | Trap detector: apparent ≫ allocated (ratio + absolute threshold) | S | M-1 | Sparse fixture flagged |

### Pipeline & output
| ID | Task | Size | Deps | Done when |
|---|---|---|---|---|
| PL-1 | `scan/`: run rules with bounded concurrency → `Finding[]` (with dev/ino identity) | M | R-2 | Integration test over fixture home |
| PL-2 | `plan/`: findings → `CleanupPlan` with per-tier totals, serializable to `plan.json` | S | PL-1 | Round-trip test |
| RP-1 | `@macsweep/report`: table formatter grouped by tier with "because … · restore cost …" | M | PL-2 | Snapshot tests |
| RP-2 | JSON formatter with versioned schema | S | PL-2 | Snapshot tests |
| CLI-1 | CLI skeleton (commander or clipanion), `audit`, `audit --json`, `audit --category`, `plan --tier` | M | RP-1, RP-2 | `node packages/cli/dist/index.js audit` runs on this Mac |
| CLI-2 | `rules list` / `rules show <id>` | S | CLI-1 | Output reviewed |
| V01 | Record redacted baseline `audit --json` of this Mac to `fixtures/baseline/` | S | CLI-1 | Committed |

## Phase 3 — v0.2 Executor + trust

| ID | Task | Size | Deps | Done when |
|---|---|---|---|---|
| SAFE-1 | `safety/paths.ts`: realpath → NFD → case-fold compare; allowlist roots; permanent denylist checked last | M | R-1 | Adversarial suite: symlink escape, `../`, `/`, relative, case variants, NFC/NFD, denylisted paths — all refused |
| SAFE-2 | Identity check before action: same dev/ino/type, no symlink in resolved chain | S | SAFE-1 | TOCTOU swap test refused |
| SAFE-3 | Preflight: running processes / docker daemon / booted simulators from rule `preflight` data | M | SRC-4 | Blocked finding has reason |
| EX-1 | Executor framework: dry-run by default, before/after allocated bytes, topological order, per-action result | M | SAFE-1..3 | Dry-run purity test (mtime + tree hash unchanged) |
| EX-2 | `remove-path` executor (`fs.rm`, T0/T1 only) | S | EX-1 | Fixture delete + refusal tests |
| EX-3 | Native helper v1 (Swift CLI in `packages/native-helper`, universal binary, **ad-hoc signed** `codesign -s -`, built by `pnpm build:helper` and in CI): `trash <path>` → returns trashed URL | M | EX-1 | Trash + Put Back works; cross-volume test; `codesign -dv` shows adhoc |
| EX-4 | `trash-path` executor using EX-3 | S | EX-3 | Journal stores trashed URL |
| EX-5 | Package-manager executors: `brew-cleanup`, `npm-cache-clean`, `pnpm-store-prune`, `yarn-cache-clean` (classic only), `uv-cache-clean`, `go-clean` (split build/mod) | M | EX-1, SRC-3 | Replay tests + macOS smoke when tools present |
| J-1 | `journal.ts`: WAL intent/result JSONL at `~/.macsweep/journal/`, lockfile `~/.macsweep/lock` | M | EX-1 | Crash-mid-run test leaves intent without result |
| U-1 | `undo --last`: restore trashed items from recorded URLs, report unrestorable | M | J-1, EX-4 | Synthetic T2 test rule round-trip |
| R-8 | Tier 0/1 rules: `xcode.module-cache`, `homebrew.cache`, `node.npm-cache`, `node.pnpm-store`, `node.yarn-cache`, `node.gyp-cache`, `python.uv-cache`, `python.pip-cache`, `go.build-cache`, `go.mod-cache`, `rust.cargo-cache`, `ruby.cocoapods-cache`, `browser.code-cache`, `app.logs`; `simulator.dyld-cache` as needsRoot copy-paste | L | R-2, EX-5 | Per-rule fixture tests; tiers per AUDIT B8 |
| CLI-3 | `clean` (dry-run default), `--apply`, `--tier`, `--plan plan.json`, `--interactive`; non-TTY refuses T2 | M | EX-1, J-1 | E2E on fixture home |
| CLI-4 | `undo --last`, `history` | S | U-1 | E2E test |
| DOC-1 | `docs/safety-model.md`, `SECURITY.md` | S | SAFE-1 | Each rule in §5 documented with its test name |

## Phase 4 — v0.3 Differentiators

| ID | Task | Size | Deps | Done when |
|---|---|---|---|---|
| N-1 | Native helper v2: `privatesize` (ATTR_CMNEXT_PRIVATESIZE, clone-aware), `volume-capacity` (important-usage / purgeable), optional `getattrlistbulk` walk | L | EX-3 | Clone fixture: reclaimable counted once; bench vs M-2 |
| D-1 | Docker probes (`docker system df -v --format json`) + rules `docker.build-cache`, `docker.dangling-images`, `docker.unused-images`, `docker.stopped-containers`, `docker.volumes` (T3) | M | SRC-4, EX-1 | Replay fixtures; volumes never actionable |
| D-2 | Simulator: `simctl-runtime-delete`, `simulator.devices-unavailable` (T1), other devices T2 permanent-only + typed confirm | M | R-4, EX-1 | Replay fixtures |
| SD-1 | `sources/system-data.ts` decomposer: `/Library`, `/private/var`, `/opt`, hidden `~/Library` dirs, snapshots, **Unmeasured** residual | L | SRC-1, N-1 | Buckets + Unmeasured = container used |
| SD-2 | `sources/snapshots.ts`: `tmutil listlocalsnapshots`, count/dates, thin command as `manualCommand` | S | SRC-4 | Replay fixture |
| SD-3 | Tier 3 rules: `system.swap`, `system.var-db`, `keychain`, `messages`, `apfs.snapshots`, `system.var-folders`, `docker.volumes` | S | R-1 | Lint confirms no action |
| R-9 | `chrome.on-device-model` (T1, re-download note + policy command), `ai.local-model-caches`, `xcode.device-support` (T1) | M | R-2 | Fixture tests |
| CLI-5 | `audit --explain` rendered from rule data + `docs/system-data.md` | M | SD-1 | Explain output matches rule text |
| CLI-6 | `doctor` (xcode, docker, brew, node, pnpm, yarn, uv, go versions + FDA status) | S | SRC-2, SRC-3 | Output reviewed |
| RP-3 | Markdown report + `redact.ts` (home, username hash, hostnames, volume names, emails, optional segment hashing) | M | RP-1 | Snapshot tests; no username in output |
| AP-1 | `sources/apps.ts` inventory: scan `/Applications`, `~/Applications`, Setapp; `plutil` Info.plist (bundle id, name, version, executable), `codesign` Team ID, `mdls` last used; recorded probe fixtures | M | SRC-4 | Fixture Applications dir → exact inventory |
| AP-2 | Native helper `running-apps` + `quit-app <bundleId>` (graceful terminate, 10 s wait) | M | EX-3 | Quit test app in macOS CI |
| AP-3 | `app-paths` matcher: `{bundleId}/{appName}/{teamId}` templates, location classification table (PLAN §4.6), generic whitelist of cache dir names, Containers read only with FDA | L | R-2, AP-1 | Fixture `~/Library`: caches T0, logs T1, HTTPStorages/Cookies/IndexedDB/app data report-only |
| AP-4 | `remove-dir-contents` executor (keeps the dir) + app preflight via `running-apps` | S | EX-1, AP-2 | Refuses while running; dir still exists after clean |
| AP-5 | App profile schema (zod) + compile profiles → rules; path ownership precedence (profile > rule > generic) | M | AP-3 | Overlap fixture assigns each path once |
| AP-6 | First 10 profiles: Slack, Discord, VS Code, Cursor, Teams, Zoom, Spotify, Notion, Figma, Chrome | L | AP-5 | Per-profile fixture tests |
| AP-7 | Safety lint for profiles: non-cache location at T0/T1 rejected; `app.data`/`app.sign-in-data`/`app.preferences` never actionable | S | AP-5, R-6 | Dangerous test profile rejected |
| CLI-7 | `apps`, `apps show <name|bundleId>`, `clean --app <name> [--apply]` | M | AP-3, AP-4, CLI-3 | E2E on fixture home |
| DOC-4 | `docs/app-profiles.md` + `new-app-profile.yml` issue template | S | AP-5 | Reviewed |
| V03 | Verify on this Mac against V01 baseline (±10% or explained) | S | all above | Checklist in PLAN §12 passes |

## Phase 5 — v0.4 Local web UI `macsweep ui` (audit + Tier 0/1)

| ID | Task | Size | Deps | Done when |
|---|---|---|---|---|
| DS-0 | Run DESIGN_PROMPT.md through Claude Design; export tokens (colors, tier badges, spacing) | M | — (can start any time) | Design files + tokens committed |
| APP-1 | `packages/ui`: Vite + React + Tailwind scaffold, system font stack, no external assets, build output embedded into the CLI package | M | S-1 | `pnpm -F @macsweep/ui build` emits static assets; no network URLs in bundle |
| APP-2 | `packages/server`: `node:http` loopback server (127.0.0.1, random port), small router, serves embedded UI assets, job manager (scan/execute as cancellable jobs), SSE progress stream, idle shutdown | M | PL-2 | Cancel mid-scan works; server exits on Ctrl-C and after idle timeout |
| APP-3 | API contract + security: shared zod schemas; per-run 256-bit token (URL fragment → `sessionStorage` → Bearer header); Host allowlist (anti DNS rebinding); reject foreign Origin; JSON-only POST; no CORS; CSP + frame-ancestors none; execute accepts only server-issued plan id + finding ids | M | APP-2 | Security suite: 401 bad token, 403 foreign Host/Origin, 415 form POST, no raw-path delete endpoint |
| APP-3b | `macsweep ui [--port] [--no-open]` command: start server, print URL, `open` it | S | APP-2, CLI-1 | Opens in default browser |
| APP-3c | Playwright e2e against `macsweep ui --no-open` on fixture home | M | APP-3b | Scan → Apps → clean caches → undo passes in macOS CI |
| APP-4 | Screens: Permissions onboarding (detect host terminal app to grant FDA, restart hint), Scanning | M | APP-3, DS-0, SRC-2 | FDA status updates after restart |
| APP-5 | Overview (segmented bar, largest wins, trap card) | M | APP-4 | Numbers equal CLI `audit --json` |
| APP-6 | System Data explainer with Unmeasured bucket + detail panel | M | APP-5, SD-1 | Matches `audit --explain` |
| APP-10 | Native helper `icon <app path>` → PNG, cached | S | EX-3 | Icons render in list |
| APP-11 | **Apps screen**: searchable/sortable list, filters, app detail with location group cards, Quit app, "Clean caches" → Review sheet | L | APP-5, CLI-7, APP-10 | Numbers equal `macsweep apps --json`; running app blocks clean |
| APP-7 | Cleanup list (tiers, blocked/root/protected states, detail panel, sticky footer) | L | APP-5 | Keyboard navigation works |
| APP-8 | Review sheet + Running/Result (T0/T1 only in v0.4) | M | APP-7, CLI-3 | E2E on fixture home |
| APP-9 | No-outbound test: run CLI + UI server e2e with outbound connections blocked; assert bundle has no external URLs | S | APP-3c | Test green |

## Phase 6 — v0.5 Tier 2

| ID | Task | Size | Deps | Done when |
|---|---|---|---|---|
| T2-1 | Typed confirmation + `--permanent` flow (CLI + web UI, re-verified server-side) | M | APP-8 | Mismatch blocks action |
| T2-2 | Rules: `browser.chrome-profiles`, `messaging.whatsapp-media`, `mail.attachments`, `ios.backups`, `downloads.triage` (age/size filters) | L | EX-4, SAFE-3 | Fixture + preflight tests |
| T2-3 | `trash.empty` special rule (`empty-trash`, always permanent, excluded from bulk) | S | T2-1 | Not selectable via `--tier 2` |
| T2-6 | Orphaned app data: bundle-id match against inventory across Caches/Application Support/Containers/Logs/Saved State/Preferences; caches T0/1, data T2 Trash; `apps --orphans` + UI filter | M | AP-5, T2-1 | Uninstalled-app fixture detected; installed apps never flagged |
| T2-7 | Remaining app profiles (Postman, Telegram, WhatsApp caches, JetBrains, Adobe media cache, Arc, Brave, Firefox, Safari) | L | AP-6 | Per-profile fixture tests |
| T2-4 | History screen + undo in web UI | M | U-1, APP-8 | Undo restores and UI updates |
| T2-5 | Settings screen (scope, thresholds, exclusions, export/redact) | M | RP-3 | Settings persisted |

## Phase 7 — v1.0 Distribution

| ID | Task | Size | Deps | Done when |
|---|---|---|---|---|
| REL-1 | npm publish pipeline (changesets); CLI bundles UI assets + ad-hoc-signed universal helper | M | all v0.5 | `npx macsweep audit` and `npx macsweep ui` work on a fresh macOS user with no Gatekeeper prompt |
| REL-2 | Homebrew formula in own tap (`<owner>/homebrew-tap`): depends on node, builds helper from source with Xcode CLT | M | REL-1, P0-5 | `brew install <owner>/tap/macsweep && macsweep ui` works |
| REL-3 | Release provenance without Apple: npm `--provenance` from GitHub Actions, SHA-256 checksums in GitHub Release, documented build-from-source steps | S | REL-1 | Provenance badge on npm; checksums match a local build of the helper |
| DOC-2 | README (pitch, 60-second demo GIF, zero-telemetry statement, "why no .app" note), `docs/architecture.md`, publish `docs/system-data.md` | M | CLI-5 | Reviewed |
| DOC-3 | CONTRIBUTING "add a cleanup target" walkthrough + issue templates (dangerous-rule, new-target) | S | R-6 | A test contributor adds a rule using only the guide |

---

## Parallel tracks

After Phase 1, these can run at the same time:
- **Track A (measurement):** M-1 → M-2 → M-3/M-4/M-5 → N-1
- **Track B (sources & probes):** SRC-1..4 → R-4, D-1, D-2, SD-2
- **Track C (rules & schema):** R-1 → R-2 → R-3/R-5/R-6/R-7 → R-8/R-9
- **Track D (design):** DS-0, which can start today
- **Track E (safety):** SAFE-1..3 start as soon as R-1 exists
- **Track F (apps):** AP-1 → AP-3 → AP-5 → AP-6/AP-7 → CLI-7 → APP-11 (AP-1 can start right after SRC-4)

Critical path to a usable v0.2: S-1 → M-2 → R-2 → PL-1 → CLI-1 → SAFE-1 → EX-1 → J-1 → CLI-3.
