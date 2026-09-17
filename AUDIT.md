# diskwise — Plan Audit

> **Status: resolved.** All findings were folded into PLAN.md v2 on 2026-09-17.

Audit of `PLAN.md` (2026-09-17). The core idea holds up: the product is the explanation, not the deletion, and safety comes from declarative rules plus tiers. The issues below are places where the plan is technically wrong, contradicts itself, or leaves out something that will block a milestone. Severity: **P0** = unsafe or blocks shipping, **P1** = wrong or misleading, fix before the milestone that uses it, **P2** = polish.

---

## A. Safety defects (P0)

### A1. `docker.prune` deletes user data
`docker system prune -a --volumes` deletes **named volumes**, which are local Postgres, MySQL and Redis databases. That is Tier 2 data that cannot be recovered and can't go to the Trash, and the plan has it at Tier 1 with a permanent delete.
**Adjust:** split into separate rules:
| Rule | Command | Tier |
|---|---|---|
| `docker.build-cache` | `docker builder prune -f` | 0 |
| `docker.dangling-images` | `docker image prune -f` | 1 |
| `docker.unused-images` | `docker image prune -a -f` | 1 |
| `docker.stopped-containers` | `docker container prune -f` | 1 |
| `docker.volumes` | list only, per volume, with size and last-used container | 3 (report only in v1) |

Also note in the rule text that `Docker.raw` may not shrink right away after a prune. Measure it again and report the real change.

### A2. `dev.node-modules` can break global tools and unpinned projects
- `/opt/homebrew/lib/node_modules`, `/usr/local/lib/node_modules`, `~/.nvm/versions/*/lib/node_modules`, `~/.volta`, `~/.fnm` and `~/.npm-global` are **global installs**. Deleting them breaks every globally installed CLI.
- If a project has no lockfile, reinstalling can pull in different versions. That is a real cost, not just "redownload".
- `node_modules` folders nested inside another `node_modules` get counted twice and deleted twice.

**Adjust:** a folder counts only if its parent contains `package.json`, it isn't inside another `node_modules`, it isn't under a known global prefix, and the project hasn't been touched for N days (default 14). Without a lockfile, the item goes up to Tier 2 and is report-only.

### A3. `simulator.devices` holds app data and can't be sent to the Trash
`xcrun simctl delete` is permanent, and simulator devices hold test app data and keychains.
**Adjust:** `simulator.devices-unavailable` (`simctl delete unavailable`) is Tier 1. Any other device is Tier 2, is **permanent-only**, and needs typed confirmation. Show this in the UI as "cannot be moved to Trash".

### A4. `trash.empty` contradicts "Tier 2 → Trash"
You can't move the Trash into the Trash.
**Adjust:** make it a special rule. Its action is `empty-trash`, it is always permanent, and it always needs typed confirmation. It isn't included in `--tier 2` bulk selection. Emptying the Trash also makes `undo` impossible for anything already in it, so warn about that.

### A5. Path comparison ignores APFS case-insensitivity and Unicode normalization
`/system`, `/SYSTEM` and NFC-vs-NFD home folder names all get past a plain string denylist or allowlist check.
**Adjust:** compare paths as `realpath` → NFD normalize → case-fold (when the volume is case-insensitive, which you can detect with `pathconf`/`diskutil info`). Add this to the adversarial test suite.

### A6. TOCTOU: "re-check size class" is expensive and doesn't prove identity
Re-measuring a 20 GB tree before deleting it is slow, and it still doesn't prove the target is the same object.
**Adjust:** store `(dev, ino)` for every matched root when the scan runs. Right before acting, `lstat` the path and require the same `dev`/`ino`, the same file type, and no symlink anywhere along the resolved path. Delete with `fs.rm` (it doesn't follow symlinks inside the tree), and never use a shell `rm -rf`.

### A7. Journal must be write-ahead, with a single-run lock
If a run crashes after the delete but before the journal write, the history is silently lost.
**Adjust:** write an `intent` record, run the action, then write a `result` record. Take a lockfile at `~/.diskwise/lock` so two runs (for example CLI and GUI) can't execute at the same time.

---

## B. Technically wrong claims (P1)

### B1. `(dev, ino)` dedupe does **not** detect APFS clones
Hardlinks share an inode, but clones don't. Each clone has its own inode and shares extents, so `blocks*512` counts the shared bytes once per clone. The plan says clones are deduplicated, and that isn't true.
**Adjust:** say plainly that v0.1 dedupes hardlinks only. Add a v0.3 native helper (a small Swift binary or N-API addon) that reads `ATTR_CMNEXT_PRIVATESIZE` (bytes that deleting the file would actually free) and `ATTR_CMNEXT_CLONEID`. Report **"reclaimable"** from private size, not from allocated size. This is the number that matters for "never lie about sizes".

### B2. `df` does not report purgeable space
**Adjust:** get container and volume numbers from `diskutil apfs list -plist` and `diskutil info -plist /`. "Available for important usage" (which includes purgeable space) only comes from `NSURLVolumeAvailableCapacityForImportantUsageKey`, so it goes through the same native helper as B1.

### B3. APFS local snapshots can't be sized without root
`tmutil listlocalsnapshots` gives names only.
**Adjust:** show the snapshot count and dates with "size: not measurable without root". Offer `tmutil thinlocalsnapshots / <bytes> 4` as a copy-paste command. It stays Tier 3, but a Tier 3 item is allowed a copy-paste command (add `manualCommand?: string` to the schema).

### B4. "Sub-buckets summing to the reported total" is impossible
Without root, much of `/private/var/db` and other SIP-protected areas can't be read, and snapshots can't be sized.
**Adjust:** the System Data breakdown always ends with an explicit **"Unmeasured (protected / needs root / snapshots)"** bucket, calculated as `container used − everything measured`. Verification step 3 becomes "the buckets plus Unmeasured equal the total, and Unmeasured is shown honestly". You also can't reproduce macOS's own "System Data" number exactly because Apple doesn't expose it. Define ours in `docs/system-data.md`.

### B5. Walker design: `worker_threads` "one per volume" gives no parallelism
Most Macs have one data volume, and Node fs calls already run on the libuv threadpool (4 threads by default).
**Adjust:** v0.1 uses an async walker with a bounded concurrency pool (set `UV_THREADPOOL_SIZE=16` when the CLI starts). In v0.3, benchmark it against a native `getattrlistbulk` helper, which is usually 5–10× faster on large trees. Set a perf budget: full `~` scan of about 1M entries in under 60 s on an M-series Mac.

### B6. Walker boundaries are underspecified
- **Don't cross device boundaries** (`st_dev` changes). Mounted simulator runtimes under `/Library/Developer/CoreSimulator/Volumes/*` are separate volumes backed by images in `.../Images`, so crossing into them counts the same bytes twice.
- When walking from `/`, skip `/System/Volumes/Data` (a firmlink alias of `/`), `/Volumes`, `/dev`, `/private/var/folders/*/*/C/com.apple.*` (noisy), and network or FUSE mounts.
- **iCloud Drive and File Provider (`~/Library/CloudStorage`, `~/Library/Mobile Documents`)**: files marked dataless (`SF_DATALESS`) take up 0 bytes, and **reading them triggers a download**. Only `lstat` them, never open them, and label them "cloud placeholder".

### B7. `ScanContext` rules contradict "declarative data, not imperative code"
`match(ctx): Promise<Match[]>` is arbitrary code. Zod can't validate it and the safety lint can't analyze it.
**Adjust:** a rule declares a **matcher by id**, plus arguments that zod validates. This works the same way `ActionId` does:
    matcher: { kind: 'path', path: '~/Library/Developer/Xcode/DerivedData' }
    matcher: { kind: 'glob-children', root: '~/Library/Caches/Homebrew' }
    matcher: { kind: 'project-dirs', name: 'node_modules', marker: 'package.json', maxAgeDays: 14 }
    matcher: { kind: 'probe', probe: 'simctl-runtimes' }
Matchers and probes live in core and need maintainer review. New rules are pure data, so outside contributors can add them safely.

### B8. Tier 0 vs Tier 1 definitions don't match the catalog
Package-manager caches (npm, pnpm, yarn, pip, uv, cargo registry, CocoaPods, Homebrew, `go mod`) need the network to restore, so by the plan's own definitions they're Tier 1, not 0.
**Adjust:** Tier 0 = rebuilt **locally**, no network needed. Tier 1 = needs network or a long rebuild. Move these to Tier 1: `homebrew.cache`, `node.*-cache`, `node.gyp-cache`, `python.*-cache`, `rust.cargo-cache` (registry), `ruby.cocoapods-cache`. Split `go.build-cache` (T0) from `go.mod-cache` (T1). `xcode.device-support` isn't user data (Xcode rebuilds it when a device connects), so move it from Tier 2 to Tier 1. `app.logs` → Tier 1 (rename to "diagnostic logs"; you lose diagnostic history).

### B9. `chrome.on-device-model` comes back
Chrome downloads it again automatically.
**Adjust:** the regeneration text should say "Chrome will re-download (~4 GB) unless disabled". Link to the `GenAILocalFoundationalModelSettings` policy and offer it as a copy-paste command. Don't apply it automatically.

### B10. Shell-outs will fail from the GUI and may reach the network
- GUI apps get `PATH=/usr/bin:/bin`, so `brew`, `docker`, `pnpm`, `uv` and `go` won't be found.
  **Adjust:** a `bin-resolver` checks known prefixes (`/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin`, `~/.cargo/bin`, `~/go/bin`, the Docker.app bundle, and so on). If that fails, it falls back once to `$SHELL -ilc 'command -v X'` and caches the result.
- `brew cleanup` can auto-update and `npm` checks for updates, which breaks "no network".
  **Adjust:** always set `HOMEBREW_NO_AUTO_UPDATE=1`, `HOMEBREW_NO_ANALYTICS=1`, `HOMEBREW_NO_ENV_HINTS=1`, and `NPM_CONFIG_UPDATE_NOTIFIER=false`. Pass arguments as argv arrays (`execFile`), never through a shell.

### B11. Moving to `~/.Trash` by hand breaks "Put Back" and cross-volume items
**Adjust:** trash items through `NSFileManager trashItemAtURL` (native helper, or the `trash` package's Swift binary). Record the **returned trashed URL** in the journal, because the Trash renames items on collision. Items on external volumes go to `/Volumes/X/.Trashes/<uid>`. `undo` restores from the recorded URL and reports anything the user has already emptied.

---

## C. Missing pieces (P1)

1. **Full Disk Access (TCC).** Without it, whole areas return `EPERM` (Mail, Messages, Safari, parts of Containers). The CLI inherits access from the terminal app, and the desktop app needs its own grant, tied to its code signature (dev builds get prompted again). Add:
   - `sources/permissions.ts` checks FDA by probing a protected path, for example `~/Library/Safari`.
   - Every `EPERM` subtree gets counted in an **"Unreadable"** total so it doesn't silently vanish.
   - A desktop **Permissions onboarding screen** and a CLI hint that says which terminal app to grant.
2. **Electron process model.** Importing core into the main process blocks it during scans. Run scan and execute in an Electron **`utilityProcess`** (isolates crashes, supports cancel), and use main only as a broker.
3. **Minimum OS and hardware.** Set macOS ≥ 14 (Sonoma), Apple Silicon plus Intel. Homebrew is at `/opt/homebrew` or `/usr/local`, and Xcode paths can differ with `xcode-select`.
4. **Rule schema fields that are needed but missing:** `schemaVersion`, `preflight: { processes?: string[], daemons?: ('docker')[] }` (turns safety rule 7 into data), `minBytes` (noise floor), `manualCommand?`, `macos: '>=14'` (semver range instead of `platforms: string[]`), `permanentOnly?: boolean`.
5. **Match identity.** `Match` needs `dev`, `ino` and `kind: 'dir' | 'file' | 'virtual'`. Command-based matches (docker, simctl) have no path, so the allowlist can't apply. Their safety has to be in the executor (for example, simctl runtime delete takes only a UUID that appeared in the probe output).
6. **Undo scope in v0.2.** v0.2 only ships Tier 0 permanent actions, so `undo` has nothing to restore. Either ship `trash-path` in v0.2 for at least one Tier 2-style rule (for example `downloads.triage` as a dry-run preview), or define v0.2 `undo` as "show what ran; nothing restorable". Recommendation: ship `trash-path` plus `undo` in v0.2 using a synthetic test rule, so that code path gets tested before Tier 2 exists.
7. **Redaction** also needs to cover volume names, hostnames, email addresses in paths, and project folder names (which often contain client names). Add an option to hash every path segment under `~`.
8. **Update check.** Drop it in v1. Homebrew and cask handle updates, so "no network, ever" stays literally true and easy to test.

---

## D. CI and verification (P1)

- **GitHub macOS runners can't run Docker** (no nested virtualization on arm64) and have few simulator runtimes. Test docker, simctl and brew rules against **recorded probe output** in `fixtures/probes/`, and run live smoke tests only when the tool is present.
- **Measurement golden tests must run on macOS.** Sparse-file allocation, clones and case-insensitivity behave differently on ext4. Ubuntu can run schema, lint, planner and formatter tests.
- Use `macos-15` (or `macos-latest`) instead of `macos-14`.
- **No-network assertion:** core and CLI get a lint ban on `http`, `https`, `net`, `dgram`, `undici` and `fetch` imports, plus a test run with outbound connections blocked. Desktop gets CSP `connect-src 'self'` and blocks `session.webRequest` to non-`file:` URLs.
- **Verification numbers in §12 are internally inconsistent.** §1 says CoreSimulator is 39 GB, and §12 says ≈ 19 GB. They're also tied to one machine. Replace them with a recorded `audit --json` baseline from this machine (committed in redacted form) and assert "within ±10% or explained by a journal entry".

---

## E. Minor (P2)

- Remove "Step 0" from the plan; it's done.
- `cache.codex-runtimes` is specific to one machine. Generalize it to `ai.local-model-caches` (Ollama, LM Studio, HF hub `~/.cache/huggingface`) at **Tier 1 with a size warning**, because these are often deliberately kept models. `ide.reinstallable-extensions` needs a concrete definition (for example, VS Code `~/.vscode/extensions/.obsolete`-listed dirs and old version folders only).
- `yarn cache clean` behaves differently in Yarn Berry (per-project `.yarn/cache`, which is often committed on purpose). Limit the rule to Yarn classic's global cache.
- `browser.code-cache` needs a preflight process check (browser not running), like the other browser rules.
- Branding: "Mac" in a product name can draw Apple trademark complaints for a signed, distributed `.app`. Check before v1.0. Also check `diskwise` on npm, Homebrew and GitHub during Phase 0.
- Add `--yes` / non-TTY behavior: `clean --apply` in a non-TTY never prompts and **refuses** Tier 2.
- Add `diskwise rules list|show <id>` so users can read a rule's rationale without running a scan.

---

## Summary of plan edits

| § | Change |
|---|---|
| 1, 4.1 | Hardlink dedupe only in v0.1. Add native helper for clone-aware private size and purgeable space (v0.3) |
| 4.1 | Async pooled walker, no crossing devices, cloud placeholders, skip list, perf budget, EPERM → Unreadable |
| 4.1 | Add `sources/permissions.ts` (FDA) and a `bin-resolver` |
| 4.2 | Declarative `matcher` by id replaces `match()`; add `preflight`, `minBytes`, `manualCommand`, `permanentOnly`, `schemaVersion`, identity on `Match` |
| 4.3 | Tier 0 = local rebuild, Tier 1 = network or long rebuild |
| 4.4 | Split docker actions; `empty-trash` action; trash through NSFileManager; env hardening; execFile only |
| 4.5 | WAL journal plus lockfile |
| 5 | Case and Unicode-aware path checks; dev/ino identity instead of size re-check |
| 7 | utilityProcess; Permissions onboarding screen; Scanning screen |
| 8 | Re-tier catalog per B8; split docker, simulator devices, node_modules guards; generalize codex/IDE rules |
| 9 | v0.2 includes trash-path plus undo with a synthetic rule; native helper in v0.3 |
| 10, 12 | Probe fixtures; macOS measurement tests; macos-15; baseline JSON instead of hardcoded numbers; "Unmeasured" bucket |
| 13 | Add: trademark check, minimum macOS version |
