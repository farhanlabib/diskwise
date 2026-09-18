# diskwise — Project Plan (v2)

An open-source macOS disk cleanup tool that **explains where your space went** and **only deletes what is provably safe**.

> v2 (2026-09-17): includes every adjustment from `AUDIT.md` and adds the **Apps** feature (per-app cache cleaning, §4.6).
> v2.1 (2026-09-17): **no Apple Developer account.** Nothing needs signing or notarizing. The GUI is a local web UI launched by `diskwise ui` (§7), not an Electron app.

---

## 1. Why this exists (the core idea)

macOS reports a vague "System Data" bucket that swallows tens of GB with no explanation. On the machine this plan was derived from, a real audit found:

| Finding | Reality |
|---|---|
| "System Data" ~78 GB | Mostly `/Library/Developer/CoreSimulator` + `/private/var` (7.7 GB) + `/opt/homebrew` (5 GB) |
| Two iOS simulator runtimes | ~32 GB, and 16 GB of that was a runtime nobody was using |
| `Docker.raw` | `ls -l` reports **228 GB**, but only **2.7 GB** is actually allocated (sparse file) |
| 55 `node_modules` folders | ~10 GB of dependencies that can be reinstalled |
| Chrome `OptGuideOnDeviceModel` | 4 GB on-device AI model, downloaded silently |
| App caches (Slack, Discord, VS Code, Teams, Spotify…) | Several GB spread across `Caches`, `Application Support/*/Cache`, and `Containers`. Finder doesn't show any of it per app |

> The exact CoreSimulator number differed between two measurements in the original session (19 GB vs 39 GB, because mounted runtime volumes were counted twice). This is why §4.1 forbids crossing device boundaries. Verification (§12) uses a recorded baseline, not hardcoded numbers.

Generic cleaners (`mole`, `merve`, `nbytes`, CleanMyMac) either show *where* space is without explaining *what it is*, or they delete aggressively with weak rationale. **diskwise's product is the reasoning, not the deletion.**

Four things no competitor does well, which are the whole point of diskwise:

1. **Decompose "System Data"** into named, sized, explained buckets, including an honest **Unmeasured** bucket for what can't be read.
2. **Never lie about sizes.** Report *allocated* bytes (and *reclaimable* bytes once clones are understood), never apparent bytes. Hardlinks and APFS clones are never double-counted.
3. **Tiered safety with stated cost.** Every target says *why it is safe* and *what it costs to get back*.
4. **Per-app view.** Every installed app shows its cache, log, and data footprint, with a one-app-at-a-time "clean caches" action that knows which folders are cache and which are your data.

### Non-goals (v1)

- No Windows or Linux support. This is a macOS tool; the OS-specific knowledge is the value.
- **No outbound network calls at all, and no telemetry.** Updates come through npm or Homebrew. There is no in-app update check. (The UI server only listens on loopback, §7.1.)
- No "one-click clean everything" button. That is the failure mode we exist to avoid.
- No anti-virus, PRAM, or "speed up your Mac" snake oil. Only measurable reclamation.
- No app *uninstaller* in v1 (the Apps view cleans caches; it doesn't remove apps). Leftovers from already-uninstalled apps are reported (§4.6).
- No sandboxed App Store distribution in v1 (it needs Full Disk Access).
- **No paid Apple Developer Program dependency, ever.** Nothing in the build, release, or install path requires a Developer ID, notarization, or a signed `.app`. Anyone can build every artifact from source with free tools (Node + Xcode Command Line Tools).

---

## 2. Decisions locked in

| Decision | Choice |
|---|---|
| Name | `diskwise` (CLI) / DiskWise (UI title). Check npm, Homebrew, GitHub, and "Mac" trademark risk in Phase 0 |
| Language | TypeScript everywhere, plus one small Swift native helper (§4.7) |
| Structure | pnpm monorepo: one shared core, two frontends |
| Frontends | `diskwise` CLI + a local web UI (`diskwise ui`), both in the same npm package |
| GUI technology | React + Vite + Tailwind, served by the CLI on `127.0.0.1` only. No Electron, no `.app` bundle |
| Signing | None required. The Swift helper is ad-hoc signed (`codesign -s -`, free, and required for arm64) |
| Distribution | npm (`npx diskwise`), a Homebrew formula in our own tap (built from source), and later a `homebrew-core` submission |
| Scope | Dev-first, with general and per-app tiers behind the same safety engine |
| Minimum OS | macOS 14 Sonoma+, Apple Silicon and Intel |
| Node engine | `>=22` (Node 20 is end-of-life), ESM only, built with `tsup` |
| License | MIT |

---

## 3. Repository layout

```
~/Documents/diskwise/
├── PLAN.md  AUDIT.md  DESIGN_PROMPT.md  TASKS.md
├── README.md  LICENSE  CONTRIBUTING.md  SECURITY.md
├── pnpm-workspace.yaml  package.json  tsconfig.base.json
├── .github/
│   ├── workflows/ci.yml           # ubuntu unit/lint + macos-15 measurement/integration
│   └── ISSUE_TEMPLATE/
│       ├── dangerous-rule.yml     # highest priority
│       ├── new-cleanup-target.yml
│       └── new-app-profile.yml
├── packages/
│   ├── core/                      # @diskwise/core: the entire engine
│   │   └── src/
│   │       ├── fs/                # allocated-size, walker, path-safety
│   │       ├── sources/           # disk, permissions, snapshots, system-data, apps
│   │       ├── probes/            # execFile runner, bin-resolver, recorded replay
│   │       ├── rules/             # schema, matchers, catalog/*.ts
│   │       ├── apps/              # inventory, profiles/*.ts, generic heuristics, orphans
│   │       ├── scan/  plan/  execute/  safety/
│   │       ├── journal.ts
│   │       └── redact.ts
│   ├── native-helper/             # Swift CLI, universal binary (trash, privatesize, capacity, quit-app, icons)
│   ├── report/                    # @diskwise/report: table / json / markdown
│   ├── server/                    # @diskwise/server: loopback-only HTTP + SSE API over core (§7)
│   ├── ui/                        # @diskwise/ui: React + Vite + Tailwind, built to static assets
│   └── cli/                       # diskwise: the published binary (bundles server, ui assets, helper)
├── fixtures/
│   ├── trees/                     # synthetic filesystem builders
│   ├── probes/                    # recorded simctl/docker/brew/diskutil/tmutil output
│   └── baseline/                  # redacted audit --json of the reference Mac
└── docs/
    ├── architecture.md
    ├── safety-model.md
    ├── system-data.md             # the explainer, also rendered in the GUI
    └── app-profiles.md            # how to add an app profile
```

If the `@diskwise` npm scope is unavailable, fall back to unscoped `diskwise-core` / `diskwise-report`.

---

## 4. Core engine design (`packages/core`)

### 4.1 Measurement layer: correctness first

The whole product is a measuring instrument, so the measurements have to be right before anything deletes a byte.

- `fs/allocated-size.ts`
  - **Allocated** = `lstat().blocks * 512`. **Apparent** = `lstat().size`. Report both and never mix them up.
  - **Reclaimable** = bytes actually freed if deleted. v0.1 uses allocated bytes with hardlink dedupe. From v0.3, it uses `ATTR_CMNEXT_PRIVATESIZE` via the native helper, which is clone-aware.
  - **Cloud placeholders** (`SF_DATALESS`, iCloud Drive, File Provider under `~/Library/CloudStorage` and `~/Library/Mobile Documents`) are `lstat`-ed only and **never opened**, because opening one triggers a download. They're labeled "cloud placeholder, 0 bytes local".
- `fs/walker.ts`
  - Async walker with a bounded concurrency pool. The CLI sets `UV_THREADPOOL_SIZE=16` at startup. A `getattrlistbulk` walk in the native helper is benchmarked in v0.3 and used if it's faster.
  - **Never** follows symlinks. Counts each `(dev, ino)` **once** (hardlinks).
  - **Never crosses a device boundary** (`st_dev` change). Mounted simulator runtimes, disk images, and network or FUSE mounts count as separate volumes.
  - Skip list when walking from `/`: `/System/Volumes/Data` (firmlink alias), `/Volumes`, `/dev`, `/private/var/vm` (sized via `lstat` only), and automounts.
  - `EPERM`/`EACCES` subtrees are recorded as **Unreadable** with their path, never silently dropped.
  - Hard budgets: max depth, max entries, and cancellation via `AbortSignal`. It emits progress events and must never hang the UI.
  - Perf budget: a full `~` scan of ~1M entries in under 60 s on an M-series Mac.
- `sources/`
  - `disk.ts`: container and volume totals from `diskutil info -plist /` and `diskutil apfs list -plist`. Purgeable and "available for important usage" come from the native helper (v0.3).
  - `permissions.ts`: detects Full Disk Access by probing a protected path. It reports `granted | limited`, and in limited mode names the host app to grant (Terminal, iTerm, VS Code, or DiskWise).
  - `snapshots.ts`: `tmutil listlocalsnapshots /` for count and dates. Snapshot sizes can't be measured without root, so the report says exactly that and offers a copy-paste thin command.
  - `system-data.ts`: the decomposer (§4.8).
  - `apps.ts`: installed app inventory (§4.6).
- `probes/`
  - `bin-resolver.ts`: checks known prefixes first (`/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin`, `~/.cargo/bin`, `~/go/bin`, `/Applications/Docker.app/Contents/Resources/bin`, `xcrun`). It falls back once to `$SHELL -ilc 'command -v <bin>'` and caches the result. This is needed because GUI apps get `PATH=/usr/bin:/bin`.
  - `run.ts`: `execFile` only (never a shell), with argv arrays, timeouts, and a hardened env: `HOMEBREW_NO_AUTO_UPDATE=1`, `HOMEBREW_NO_ANALYTICS=1`, `HOMEBREW_NO_ENV_HINTS=1`, `NPM_CONFIG_UPDATE_NOTIFIER=false`.
  - Replay mode: tests replay recorded output from `fixtures/probes/`.

### 4.2 Rule registry: the heart of the project

A rule is **declarative data**. Code lives only in a small set of maintainer-reviewed **matchers** and **executors**, referenced by id. Contributors add data, not code.

```ts
// packages/core/src/rules/schema.ts
export interface Rule {
  schemaVersion: 1;
  id: string;                          // "xcode.derived-data"
  title: string;
  category: 'dev' | 'system' | 'browser' | 'app' | 'user-data';
  tier: Tier;                          // §4.3
  macos?: string;                      // semver range, e.g. ">=14"
  requires?: DepId[];                  // 'xcode' | 'docker' | 'homebrew' | …
  roots: string[];                     // ALLOWLIST: targets must resolve inside these
  matcher: MatcherSpec;                // declarative, see below
  action: ActionId | null;             // null = report only (Tier 3)
  rationale: string;                   // WHY it is safe
  regeneration: string;                // WHAT it costs to get back
  preflight?: {
    processes?: string[];              // bundle ids or executable names that must not be running
    daemons?: ('docker')[];
    bootedSimulators?: boolean;
  };
  minBytes?: number;                   // noise floor (default 50 MB)
  needsRoot?: boolean;                 // → copy-paste command, never a sudo prompt
  manualCommand?: string;              // exact command shown to the user (root or policy changes)
  permanentOnly?: boolean;             // cannot go to Trash (simctl, docker, empty-trash)
  docs?: string;
}

export type MatcherSpec =
  | { kind: 'path'; path: string }
  | { kind: 'glob-children'; root: string; include?: string[]; exclude?: string[] }
  | { kind: 'project-dirs'; name: string; marker: string; maxAgeDays: number; excludePrefixes: string[] }
  | { kind: 'probe'; probe: ProbeId }
  | { kind: 'app-paths'; bundleId: string; paths: AppPathTemplate[] };   // §4.6

export interface Match {
  kind: 'dir' | 'file' | 'virtual';    // virtual = command-managed (docker image, simctl runtime)
  path?: string;
  dev?: number; ino?: number;          // identity captured at scan time
  bytesAllocated: number;
  bytesApparent: number;
  bytesReclaimable?: number;
  detail: string;                      // "iOS 26.1 (23B86), unused 94 days"
  actionArgs?: Record<string, string>;
  appBundleId?: string;                // links the finding to the Apps view
}
```

- `zod` validates every rule at load time. A rule that fails validation fails CI, not someone's disk.
- **Path ownership:** each path belongs to exactly one finding. Precedence is known app profile > specific rule > generic app heuristic. Overlaps are resolved in `scan/`, and bytes are deduped by `(dev, ino)` in totals.

### 4.3 Safety tiers

| Tier | Name | Meaning | Default action |
|---|---|---|---|
| 0 | `REGENERATES` | No user data, rebuilt **locally** with no network (build outputs, render/code caches) | Delete permanently |
| 1 | `REDOWNLOAD` | No user data, but restoring needs **network or a long rebuild** (package caches, runtimes, models) | Delete permanently, shown with cost |
| 2 | `USER_DATA` | Contains real user data | **Move to Trash**. Permanent only with `--permanent` + typed rule id |
| 3 | `NEVER` | Explained for education, **never** actionable. May show a `manualCommand` | No action exists |

Tier 3 is a feature, not a gap. It is how the tool explains System Data (swap, `/private/var/db`, Keychains, snapshots, Docker volumes) without ever offering to break the machine.

`permanentOnly` Tier 2 items (for example, non-unavailable simulator devices) always need typed confirmation, and the UI says "cannot be moved to Trash".

### 4.4 Actions: vendor tooling before `rm`

| ActionId | Implementation | Allowed tiers |
|---|---|---|
| `simctl-runtime-delete` | `xcrun simctl runtime delete <uuid>` (UUID must appear in the probe output) | 1 |
| `simctl-device-delete-unavailable` | `xcrun simctl delete unavailable` | 1 |
| `simctl-device-delete` | `xcrun simctl delete <udid>` | 2 (permanentOnly) |
| `brew-cleanup` | `brew cleanup -s` | 1 |
| `docker-builder-prune` | `docker builder prune -f` | 0 |
| `docker-image-prune` | `docker image prune -f` (dangling) / `-a -f` (unused) | 1 |
| `docker-container-prune` | `docker container prune -f` | 1 |
| `npm-cache-clean` | `npm cache clean --force` | 1 |
| `pnpm-store-prune` | `pnpm store prune` | 1 |
| `yarn-cache-clean` | `yarn cache clean` (Yarn classic global cache only) | 1 |
| `uv-cache-clean` | `uv cache clean` | 1 |
| `go-clean-build` / `go-clean-mod` | `go clean -cache` / `go clean -modcache` | 0 / 1 |
| `trash-path` | Native helper → `NSFileManager trashItemAtURL`. Records the returned trashed URL | 2 (any tier may opt in) |
| `remove-path` | `fs.rm` (doesn't follow symlinks inside) | 0, 1 only |
| `remove-dir-contents` | Empties a cache dir but keeps the dir (some apps crash if it's missing) | 0, 1 only |
| `empty-trash` | Empties Trash. Always permanent, typed confirmation, never included in bulk tier selection | 2 (special) |

There is deliberately **no** `docker system prune --volumes` action. Docker volumes are databases and stay Tier 3.

Every executor must:
- support dry-run
- check that the target is inside the rule's `roots` and not denylisted (§5)
- re-verify identity (§5.4)
- run preflight
- record before and after reclaimable bytes

### 4.5 Pipeline

```
sources + rules + app profiles → scan → Finding[] → plan (CleanupPlan) → execute (via ActionId) → journal
                                                  ↘ report (table | json | markdown)
```

- `scan/`: runs matchers with bounded concurrency, resolves path ownership, and produces `Finding[]`.
- `plan/`: turns findings into a selectable, serializable `CleanupPlan` (`plan.json`) with per-tier, per-category, per-app, and grand totals.
- `execute/`: orders actions, runs preflight and identity checks, and executes.
- `journal.ts`: write-ahead JSONL at `~/.diskwise/journal/<timestamp>.jsonl`. It writes an **intent** record before each action and a **result** record after it. A lockfile at `~/.diskwise/lock` prevents concurrent runs (CLI and GUI). This enables `undo` and makes every run auditable.
- `redact.ts`: rewrites `/Users/<name>` to `~`. It also redacts hostnames, volume names, and email-like segments, and can optionally hash every path segment under `~` (project names are often client names).

### 4.6 Apps: per-app cache cleaning (new)

An **Apps** list shows every installed app with its disk footprint and lets you clean one app's caches with the same safety engine. Internally, **app profiles compile into rules** (category `app`), so nothing bypasses `roots`, tiers, preflight, or the journal.

**Inventory (`sources/apps.ts`)**
- Scans `/Applications`, `~/Applications`, `/Applications/Setapp`, and one level of subfolders. `/System/Applications` is listed as read-only.
- For each `.app` it reads `Contents/Info.plist` with `plutil -convert json -o -`: `CFBundleIdentifier`, `CFBundleName`, `CFBundleShortVersionString`, and the executable name. It also reads the Team ID from the code signature (`codesign -dv`, needed for Group Containers).
- Last used date from `mdls -name kMDItemLastUsedDate` (shown as "unknown" if Spotlight is off).
- Running state: native helper `running-apps`, which lists `NSRunningApplication` bundle ids.
- Bundle size is measured, but the bundle itself is never a cleanup target in v1.

**Per-app locations**, resolved from `{bundleId}`, `{appName}`, and `{teamId}`:

| Location | Classification | Tier |
|---|---|---|
| `~/Library/Caches/{bundleId}` | Cache | 0 |
| `~/Library/Containers/{bundleId}/Data/Library/Caches` | Cache (sandboxed app) | 0 |
| `~/Library/Group Containers/{teamId}.*/Library/Caches` | Cache (shared) | 0 |
| `~/Library/Application Support/{appName\|bundleId}/` → `Cache`, `Code Cache`, `GPUCache`, `DawnCache`, `DawnGraphiteCache`, `DawnWebGPUCache`, `ShaderCache`, `GrShaderCache`, `Service Worker/CacheStorage`, `Service Worker/ScriptCache` | Chromium/Electron caches (Slack, Discord, VS Code, Teams, Notion, Figma…) | 0 |
| `~/Library/WebKit/{bundleId}/NetworkCache`-style cache subfolders only | WebKit cache | 0 |
| `~/Library/Logs/{appName\|bundleId}` | Diagnostic logs | 1 |
| `~/Library/Saved Application State/{bundleId}.savedState` | Window restoration | 1 |
| `~/Library/Application Support/{…}` (everything else) | **App data** | 2, report-only in v1 |
| `~/Library/Containers/{bundleId}` (everything else) | **App data** | 2, report-only in v1 |
| `~/Library/HTTPStorages/{bundleId}`, `Cookies`, `WebKit` local storage and IndexedDB | **Sign-in and site data**. Deleting logs you out | 2, report-only |
| `~/Library/Preferences/{bundleId}.plist` | Settings | 3 |

**Two sources of knowledge**
1. **Known app profiles** (`apps/profiles/*.ts`) are declarative, reviewed data for popular apps. They list exact cache subpaths, extra locations (for example Spotify's `~/Library/Caches/com.spotify.client/Data` offline cache → Tier 1, "re-downloads offline songs"), app-specific rationale, and the processes to check in preflight. They take precedence over heuristics. The initial set is Slack, Discord, VS Code, Cursor, Microsoft Teams, Zoom, Spotify, Notion, Figma, Postman, Telegram, WhatsApp (caches only), JetBrains IDEs, Adobe Creative Cloud (media cache), Google Chrome, Arc, Brave, Firefox, and Safari (FDA).
2. **Generic heuristic** covers every other app, but only for the fixed, whitelisted cache folder names in the table above. These findings are labeled "generic rule", and nothing outside those names is ever actionable.

**Behavior**
- **Preflight:** an app's caches can't be cleaned while it runs. The user can click **Quit app**, which asks the app to quit gracefully through the native helper (`NSRunningApplication.terminate`, never force-kill), then re-checks.
- Cache folders are emptied with `remove-dir-contents` (the folder is kept).
- **Container privacy prompts:** since macOS 14, reading another app's `~/Library/Containers` can trigger an "access data from other apps" prompt. The scanner reads containers only with Full Disk Access granted. Without it, those containers are marked Unreadable instead of prompting repeatedly.
- **Orphaned app data** (v0.5): `Caches`, `Application Support`, `Containers`, `Logs`, `Saved Application State`, and `Preferences` entries whose bundle id matches no installed app. Caches and logs are Tier 0/1. Application Support and Containers are Tier 2 and go to Trash. Matching uses bundle ids only, never fuzzy names.
- Apple system apps (`com.apple.*`): caches are report-only unless a known profile marks them safe (for example `com.apple.Music` artwork cache).

### 4.7 Native helper (`packages/native-helper`)

A small Swift CLI (universal arm64 + x86_64) called through `execFile` with JSON output. **No Developer ID needed:**
- It's built in CI with `swiftc`/`swift build` (Xcode Command Line Tools) and **ad-hoc signed** (`codesign -s -`). The linker does this automatically on arm64.
- It ships as a prebuilt binary inside the npm package. Files installed by npm or Homebrew aren't quarantined, so Gatekeeper doesn't block them.
- The Homebrew formula builds it from source. `pnpm build:helper` does the same for contributors.
- Every API it uses (`NSFileManager trashItemAtURL`, `NSRunningApplication`, `getattrlist`, `NSWorkspace` icons, volume capacity keys) works in unsigned and ad-hoc-signed binaries.
- It needs no entitlements and no TCC permission of its own beyond what the terminal already has.

Commands:

| Command | Purpose | Milestone |
|---|---|---|
| `trash <path>` | `NSFileManager trashItemAtURL`, returns the trashed URL (supports Put Back and cross-volume `.Trashes`) | v0.2 |
| `running-apps` | Running bundle ids and pids | v0.3 |
| `quit-app <bundleId>` | Graceful `terminate()`, waits up to 10 s | v0.3 |
| `privatesize <path…>` | `ATTR_CMNEXT_PRIVATESIZE` / clone id, for clone-aware reclaimable bytes | v0.3 |
| `capacity /` | Important-usage and opportunistic available capacity (purgeable) | v0.3 |
| `walk <root>` | `getattrlistbulk` walker, used if the benchmark beats the Node walker | v0.3 |
| `icon <app path>` | App icon as PNG for the web UI Apps list | v0.4 |

The CLI works without the helper (it degrades to allocated sizes, `~/.Trash` moves with a warning, and no quit or purgeable info).

### 4.8 System Data decomposition

"System Data" isn't exposed by any Apple API. diskwise defines it (in `docs/system-data.md`) as **container used − (Applications + Documents/user files + other categorized)**, and breaks it into:

`/Library` (with Developer/CoreSimulator split into runtimes, images, devices, and caches) · `/private/var` (vm, folders, db, log) · `/opt/homebrew` or `/usr/local` · hidden `~/Library` (Caches, Containers, Application Support, Group Containers, Developer) · local snapshots (count only) · **Unmeasured** = total − everything measured (protected, needs root, snapshots). The buckets **plus Unmeasured always equal the total**.

### 4.9 Old macOS leftovers (category `os-leftovers`)

macOS upgrades and older toolchains leave files behind in `/Library`, `~/Library`, and the root of the disk. They're grouped in their own category and screen section, "Left over from previous macOS versions":

| Rule | Location | Tier | Notes |
|---|---|---|---|
| `os.installer-apps` | `/Applications/Install macOS *.app` | 1 | 12–15 GB each, re-downloadable from Apple. `trash-path` |
| `os.install-data` | `/macOS Install Data`, `/Library/Updates` (when not SIP-protected) | 1 | Staging from finished or failed upgrades. **needsRoot** → copy-paste command, and only when no update is pending (`softwareupdate --list` has nothing staged) |
| `os.relocated-items` | `/Users/Shared/Relocated Items` | 2 | Files macOS moved aside during an upgrade. Real data, so Trash only |
| `os.previous-system-info` | `/Previous System*`, `/Library/Preferences/SystemConfiguration/*.pre-update` | 3 | Explained, never touched |
| `os.aerial-wallpapers` | `/Library/Application Support/com.apple.idleassetsd/Customer` | 3 | Can be several GB. Explains how to remove videos in System Settings → Wallpaper, with `manualCommand` guidance only |
| `os.old-command-line-tools-sdks` | `/Library/Developer/CommandLineTools/SDKs/MacOSX1[0-4]*.sdk` (not the current one or its symlink target) | 1 | needsRoot, copy-paste |
| `os.old-device-support` | `~/Library/Developer/Xcode/{iOS,watchOS,tvOS} DeviceSupport/<version>` older than the newest two per platform | 1 | Rebuilt when that device connects |
| `os.old-simulator-caches` | `~/Library/Developer/CoreSimulator/Caches/dyld/<build>` for builds with no installed runtime | 0 | Rebuilt on demand |
| `os.orphaned-receipts` | `/private/var/db/receipts` entries for removed packages | 3 | Report only (tiny, but explains `pkgutil --forget`) |
| `os.stale-var-folders` | `/private/var/folders` totals | 3 | Explained only. macOS cleans it at reboot |

Leftovers from uninstalled **apps** (as opposed to the OS) are `app.orphaned-data` (§4.6).

---

## 5. Safety model (the actual product)

These are enforced in code and tested adversarially. `docs/safety-model.md` maps each rule to its tests.

1. **Dry-run is the default.** `diskwise clean` prints a plan and exits. Nothing is deleted without `--apply`.
2. **Allowlist, not denylist.** Every rule declares `roots`, and the executor rejects any target whose `realpath` escapes them. This defeats symlink and `../` traversal.
3. **Path comparison is canonical.** `realpath`, then Unicode NFD normalization, then case-folding when the volume is case-insensitive. This applies to allowlist and denylist checks alike.
4. **Prove identity, not just location.** Right before acting: `lstat` the target, require the same `dev`/`ino`/file type captured at scan time, and require no symlink in the resolved chain. Abort on any mismatch.
5. **Permanent denylist**, checked last so it can never be overridden: `/`, `/System`, `/System/Volumes/*`, `/private/var/vm`, `/private/var/db`, `~/Library/Keychains`, `~/Library/Messages`, `~/Library/Mail`, `~/Library/Preferences`, `~/Library/Mobile Documents`, `~/Library/CloudStorage`, `/Applications/*.app` bundles, and Time Machine destinations.
6. **Tier 2 always goes to Trash.** Permanent removal requires `--permanent` plus typed confirmation of the rule id. `permanentOnly` items always need typed confirmation. In non-TTY mode, Tier 2 is refused outright.
7. **Root work is never automated.** `needsRoot` rules emit the exact command for the user to run themselves. diskwise never shells out to `sudo` and never shows a password prompt.
8. **Preflight state checks come from rule data.** They refuse to touch an app's caches while it runs, Docker data while the daemon runs, or a runtime while a simulator is booted. The tool quits gracefully when asked, or skips; it never corrupts data.
9. **Write-ahead journal + single-run lock.** Every action has an intent record before it runs and a result record after.
10. **Undo.** `diskwise undo --last` restores Trash moves from the recorded trashed URLs and states exactly what can't be restored and why ("Trash was emptied", "rebuilds automatically").
11. **No outbound network, no telemetry.** Lint bans outbound network modules (`https`, `net.connect`, `undici`, `fetch`) everywhere. The only exception is `packages/server`, which may call `http.createServer`, and only for loopback listening. A test runs the CLI and UI server with outbound connections blocked. The UI ships a strict CSP (`default-src 'self'; connect-src 'self'`).
12. **The local UI server is not an attack surface** (§7.1): it binds to `127.0.0.1` only, uses a per-session secret token, validates `Host` and `Origin`, sends no CORS headers, and every mutating call needs the token plus a JSON body. It shuts down with the CLI process.

---

## 6. CLI surface (`packages/cli`)

```
diskwise audit                         # full report, decomposed, with tiers
diskwise audit --json                  # machine-readable, versioned schema
diskwise audit --explain               # teaching mode: what "System Data" really is
diskwise audit --category dev|system|browser|app|user-data|os-leftovers
diskwise doctor                        # xcode/docker/brew/node/... versions, Full Disk Access status
diskwise apps                          # installed apps sorted by reclaimable cache
diskwise apps show <name|bundleId>     # one app: caches, logs, data, sign-in data, running state
diskwise apps --orphans                # data left behind by uninstalled apps
diskwise plan --tier 0,1 [-o plan.json]
diskwise clean --tier 0 --apply
diskwise apps clean slack --apply      # clean one app's caches, logs and saved state (never app data)
diskwise clean --plan plan.json --apply
diskwise clean --interactive           # per-item prompts
diskwise undo --last
diskwise history
diskwise rules list | rules show <id>
diskwise report --markdown --redact > disk-report.md
diskwise ui [--port 0] [--no-open]    # start the local web UI on 127.0.0.1 and open the browser
```

Output style: a table grouping findings by tier with `— because <rationale> · restore cost: <regeneration>` for each. `--explain` and `rules show` are generated from the same rule data that drives deletion, so the explanation can never drift from the behavior.

---

## 7. Local web UI (`diskwise ui`)

**Why not Electron:** without an Apple Developer account, a downloaded `.app` can't be notarized. On macOS 15+ users would have to click through System Settings → Privacy & Security → "Open Anyway". Worse, an ad-hoc signed app's Full Disk Access grant is tied to its code hash, so it is **lost on every update**. A local web UI avoids all of that:
- nothing to sign
- it runs inside the CLI process, so it **reuses the terminal's Full Disk Access**
- it ships in the same npm or Homebrew install
- one engine process serves both CLI and GUI

- `diskwise ui` starts `@diskwise/server` inside the CLI process, binds `127.0.0.1` on a random free port, prints the URL, and opens it with `open` (skip with `--no-open`). **Ctrl-C** or closing all tabs (after an idle timeout of 10 min with no connected client) stops it.
- **UI:** React + Vite + Tailwind in `packages/ui`, built to static assets embedded in the CLI package and served from memory. No CDN, no web fonts from the internet (system font stack: `-apple-system`, `SF Mono` via `ui-monospace`).
- **API:** JSON over `node:http` with a small hand-written router. Request and response bodies are validated with zod schemas shared with the UI. **Server-Sent Events** stream scan progress, execution progress, and job status. No framework, to keep the dependency surface of a tool that deletes files small.
- **Jobs:** scans and executions run as cancellable jobs in the same process (the walker is async and doesn't block the event loop). Only one execute job runs at a time (the journal lock also covers the CLI in another terminal).
- Root-requiring items render as "copy this command" cards, mirroring the CLI.
- The page works in Safari, Chrome, Firefox, and Arc. It's also installable as a PWA shortcut for a Dock icon, with no signing needed.

### 7.1 Server security (tested, release-blocking)

| Threat | Mitigation |
|---|---|
| Other machines on the network | Bind `127.0.0.1` only, never `0.0.0.0` or `::` |
| Malicious website calling localhost (CSRF) | 256-bit random token generated per run, passed once in the URL fragment (`#t=…`, never sent to the server in logs), stored in `sessionStorage`, and sent as `Authorization: Bearer` on every call. Missing or wrong token → 401 |
| DNS rebinding | Reject any request whose `Host` isn't exactly `127.0.0.1:<port>` or `localhost:<port>` |
| Cross-origin reads | No CORS headers. Reject requests with a foreign `Origin`. Mutating endpoints are `POST` with `Content-Type: application/json` only (no simple-request forms) |
| Clickjacking | `X-Frame-Options: DENY`, `frame-ancestors 'none'` |
| Other local users | Token plus per-user server. The port is ephemeral and the server exits with the CLI |
| Destructive API misuse | The API can only execute a `CleanupPlan` produced by this server's own scan (plan id + finding ids). There's no "delete this path" endpoint. Every executor safety check (§5) still runs server-side, and typed confirmation is re-verified by the server |

Screens (design brief in `DESIGN_PROMPT.md`):

1. **Permissions onboarding**: why Full Disk Access is needed, **which terminal app to grant it to** (detected: Terminal, iTerm2, Ghostty, Warp, VS Code), a note to restart `diskwise ui` afterwards, a live status indicator, and "continue with limited access".
2. **Scanning**: live progress and cancel.
3. **Overview**: segmented bar (Apps · Developer · Caches · Your data · System (protected) · Unmeasured · Purgeable · Free), the headline "reclaimable: X GB", the largest wins, and trap cards (sparse files).
4. **System Data explainer**: the decomposition macOS hides, including Unmeasured.
5. **Apps**: a searchable, sortable list of installed apps (icon, name, version, last used, running state, cache size, data size). App detail shows location groups (Caches, Logs, App data, Sign-in data, Settings) with tiers, and a **Clean caches** button that goes through Review. There is also an "Orphaned app data" filter.
6. **Cleanup**: items grouped by tier with checkboxes, rationale, restore cost, exact action, and a live running total.
7. **Review & confirm**: grouped by what happens (rebuilds / re-downloads / moved to Trash / permanent), with typed confirmation for Tier 2 and permanent-only items.
8. **Running & result**: per-item status, and freed vs planned bytes with an honest explanation of any gap.
9. **History**: journal browser and undo.
10. **Settings**: scan scope, node_modules age threshold, exclusions, redacted export.

---

## 8. Initial rule catalog

Grounded in the real audit, so v1 is useful from day one.

**Tier 0: regenerates locally**
`xcode.derived-data` · `xcode.module-cache` · `simulator.dyld-cache` *(needsRoot, copy-paste)* · `go.build-cache` · `docker.build-cache` · `browser.code-cache` *(preflight: browser not running)* · `app.caches` *(generated per app, §4.6)*

**Tier 1: needs network or a long rebuild**
`simulator.runtimes` *(the 16 GB win)* · `simulator.devices-unavailable` · `docker.dangling-images` · `docker.unused-images` · `docker.stopped-containers` · `dev.node-modules` *(guards: `package.json` marker, lockfile present, not nested, not a global prefix, untouched ≥ 14 days)* · `homebrew.cache` · `node.npm-cache` · `node.pnpm-store` · `node.yarn-cache` *(classic)* · `node.gyp-cache` · `python.uv-cache` · `python.pip-cache` · `go.mod-cache` · `rust.cargo-cache` *(registry)* · `ruby.cocoapods-cache` · `chrome.on-device-model` *(re-downloads unless disabled; policy offered as `manualCommand`)* · `ai.local-model-caches` *(Ollama, LM Studio, Hugging Face hub, with a "you may want these" warning)* · `xcode.device-support` · `app.logs` · `app.saved-state` · `ide.obsolete-extensions` *(VS Code/Cursor folders listed in `.obsolete` and superseded versions only)*

**Tier 2: user data (Trash by default)**
`browser.chrome-profiles` · `messaging.whatsapp-media` · `mail.attachments` · `ios.backups` · `downloads.triage` *(age/size filters)* · `simulator.devices` *(permanentOnly)* · `app.orphaned-data` · `trash.empty` *(special: `empty-trash`, always permanent, excluded from bulk)* · `dev.node-modules-unlocked` *(no lockfile: report only)*

**Old macOS leftovers (§4.9)**
`os.installer-apps` (T1) · `os.install-data` (T1, needsRoot) · `os.old-command-line-tools-sdks` (T1, needsRoot) · `os.old-device-support` (T1) · `os.old-simulator-caches` (T0) · `os.relocated-items` (T2) · `os.previous-system-info` · `os.aerial-wallpapers` · `os.orphaned-receipts` · `os.stale-var-folders` (T3)

**Tier 3: never (report only)**
`system.swap` · `system.var-db` · `system.var-folders` · `keychain` · `messages` · `apfs.snapshots` *(manualCommand: thin snapshots)* · `docker.volumes` *(databases live here)* · `app.data` · `app.sign-in-data` · `app.preferences`

Plus a non-rule **trap detector** that flags files whose apparent size far exceeds their allocated size (the `Docker.raw` case), so users stop panicking at what Finder shows.

---

## 9. Roadmap

**v0.1: walking skeleton.** Monorepo, measurement layer (allocated size, hardlink dedupe, no crossing devices, Unreadable), `diskutil`, permissions and bin-resolver sources, declarative rule schema and matchers, `audit` CLI with table and JSON output, and 3 rules (DerivedData, simulator runtimes, node_modules with guards). Plan output only: **no execution path exists yet.** Record the baseline.

**v0.2: executor + trust.** Path safety (canonical compare, identity check), preflight, executors, write-ahead journal and lock, native helper `trash`, `trash-path` + `undo` (exercised by a synthetic test rule), Tier 0/1 package-manager and Xcode rules, dyld as copy-paste. `clean --apply` ships.

**v0.3: the differentiators.** Native helper (`privatesize`, `capacity`, `running-apps`, `quit-app`, walker benchmark), Docker rules (split), simulator runtimes and devices, System Data decomposition with Unmeasured, snapshots, `audit --explain`, `doctor`, redacted markdown reports, **app inventory + generic app caches + first 10 app profiles, `diskwise apps` and `apps clean`.**

**v0.4: local web UI v1 (`diskwise ui`).** Loopback server with the §7.1 security suite, onboarding, scanning, overview, explainer, **Apps**, cleanup, review, running and result. Audit plus Tier 0/1 only.

**v0.5: Tier 2.** Typed confirmation, browser profiles, WhatsApp media, Downloads triage, iOS backups, `trash.empty`, **orphaned app data**, remaining app profiles, History and Settings screens, full undo story.

**v1.0: distribution.** npm release with the prebuilt ad-hoc-signed universal helper, a Homebrew formula in our own tap (`brew install <owner>/tap/diskwise`, which builds the helper from source), a reproducible-build note (anyone can compare their build), published `docs/system-data.md`, rule and app-profile authoring guides, and first external contributions. After v1.0, submit to `homebrew-core` once the project meets its notability requirements. **No cask, no `.app`, no notarization.**

---

## 10. Testing

- **Vitest**, run from the pnpm workspace root.
- **Golden-fixture measurement tests (macOS runners only):** synthetic trees with known allocated sizes, sparse files, hardlinks, APFS clones (`cp -c`), symlink cycles, mounted disk images (device-boundary test), chmod-000 directories (Unreadable), and dataless placeholders where possible. Exact-byte assertions. This is the highest-value suite.
- **Per-rule tests:** each rule has a fixture plus assertions on matched paths, tier, and size.
- **App profile tests:** a fixture `~/Library` for each profile, plus generic-heuristic tests proving that nothing outside the whitelisted cache names is ever actionable, and that HTTPStorages, Cookies, and IndexedDB stay report-only.
- **Probe replay tests:** simctl, docker, brew, diskutil, tmutil, plutil, and mdls outputs are recorded in `fixtures/probes/`. Live smoke tests run only when the tool exists (GitHub macOS runners have no Docker).
- **Adversarial safety tests:** symlink escape, `../` traversal, `/` as a target, relative paths, case variants (`/system`), NFC vs NFD, denylisted paths, a rule declaring an unapproved root, and a target swapped between scan and execute (identity mismatch). Every one must be refused, and any failure blocks release.
- **Dry-run purity test:** snapshot mtimes and a tree hash, run every action in dry-run, and assert zero mutation.
- **Journal crash test:** kill mid-run and assert the intent record exists without a result, and that the lock recovers.
- **No-network test:** the CLI and UI e2e run with outbound connections blocked, and the lint rule bans outbound network modules.
- **UI server security suite:** binds loopback only; missing or wrong token → 401; foreign `Host` (rebinding) → 403; foreign `Origin` → 403; `text/plain` or form POST → 415; no CORS headers present; no endpoint accepts a raw path to delete; typed confirmation is enforced server-side. Any failure blocks release.
- **UI e2e:** Playwright against `diskwise ui --no-open` on a fixture home (scan → Apps → clean caches → undo).
- **Snapshot tests** for report formatters and redaction.
- **CI matrix:** `ubuntu-latest` for lint, typecheck, schema, planner, and formatters. `macos-15` for measurement, native helper, integration, and e2e.
- **Safety lint:** fails if `remove-path` or `remove-dir-contents` is used outside Tier 0/1, a root isn't on the approved list, a Tier 3 rule has an action, or an app profile marks a non-cache location as Tier 0/1 without maintainer override.

---

## 11. Open-source hygiene

- MIT `LICENSE`. Every release artifact is buildable from source with free tools, with no paid accounts required to contribute or release. `CONTRIBUTING.md` centers on two walkthroughs: **add a cleanup rule** and **add an app profile** (the main ways to contribute).
- `SECURITY.md` documents the safety model and treats "a rule or profile that deletes user data" as a security bug.
- Issue templates: **Dangerous rule report** (priority), **New cleanup target**, **New app profile**.
- A `rules:validate` script (covering rules and app profiles) that contributors run locally, identical to CI.
- Zero telemetry and zero network: stated in the README and enforced by lint and tests.

---

## 12. Verification

How to confirm the implementation is correct at each milestone:

1. `pnpm -r build && pnpm -r typecheck && pnpm test`: all green on both CI runners.
2. `node packages/cli/dist/index.js audit --json` on the reference Mac matches `fixtures/baseline/` within ±10%, or the difference is explained by a journal entry. Specifically: simulator runtimes are listed individually without double-counting mounted volumes, 55-ish `node_modules` dirs are found, and `Docker.raw` is reported as ~2.7 GB allocated with its 228 GB apparent size called out as a trap.
3. `audit --explain`: the named System Data sub-buckets **plus Unmeasured** equal the container's used total.
4. `diskwise apps` lists every app in `/Applications`, with cache sizes that match a manual `du` of the resolved cache folders. `apps show slack` separates caches from sign-in data and app data.
5. **Dry-run purity:** `clean --tier 0` and `apps clean slack` (no `--apply`) leave `diskutil` numbers and fixture hashes unchanged.
6. **Safety suite:** every adversarial test fails closed, and the safety lint rejects a deliberately dangerous test rule and a dangerous test app profile.
7. **End-to-end on the reference Mac:** `clean --tier 0 --apply` frees a measurably positive number of bytes. `apps clean <running app>` refuses until the app quits. `undo --last` restores anything moved to Trash. `diskwise ui` shows the same numbers as `audit --json` and `apps --json`.
8. **Clean-machine install without an Apple account:** on a fresh macOS user, `npx diskwise audit` and `brew install <owner>/tap/diskwise && diskwise ui` both work with no Gatekeeper prompt, and the helper reports `codesign -dv` as ad-hoc.

---

## 13. Open questions to settle during Phase 0

- Is the `@diskwise` npm scope available? (fallback: unscoped package names)
- GitHub org or repo home, and whether `gh` should create it.
- Trademark risk of "Mac" in a distributed app name. Have a fallback name ready.
- ~~Apple Developer ID account~~ **Resolved: not needed.** The GUI is a local web UI and the helper is ad-hoc signed (§4.7, §7).
- Homebrew tap repo name (`<owner>/homebrew-tap`).
- Which 10 app profiles ship first in v0.3. Proposed: Slack, Discord, VS Code, Cursor, Teams, Zoom, Spotify, Notion, Figma, Chrome.
