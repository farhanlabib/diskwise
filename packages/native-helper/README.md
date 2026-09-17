# @diskwise/native-helper

A tiny Swift command-line helper for the macOS APIs that Node cannot reach
without a native addon: the user's Trash, the list of running applications,
graceful app termination, per-file allocated/private sizes, volume capacity
figures, and app icons.

The helper is an executable, not a library or an app bundle, so there is nothing
to load into Node and nothing to notarize. `packages/core` shells out to it with
`execFile` and reads one JSON object from stdout.

## Commands

Every invocation prints exactly one JSON object to stdout — `{"ok":true,...}` or
`{"ok":false,"error":"..."}` — and exits `0` when `ok` is true and `1` otherwise.
Nothing else is written to stdout, so callers can parse it unconditionally.

| Command | Output | Notes |
| --- | --- | --- |
| `version` | `{ok, version}` | Helper version string. |
| `trash <path>` | `{ok, path, trashedPath}` | Moves the item to the user's Trash with `FileManager.trashItem(at:resultingItemURL:)`, so it can be restored from Finder. Not a delete. |
| `running-apps` | `{ok, apps:[{bundleId,name,pid,bundlePath}]}` | Running `NSRunningApplication`s that have a `bundleIdentifier`. Background/helper processes without one are omitted. |
| `quit-app <bundleId> [--timeout <sec>]` | `{ok, quit, stillRunning}` | Default timeout 10s. Calls `terminate()` only — never `forceTerminate()` — on every match, polls `isTerminated` every 200 ms, and reports how many are still up. `ok` mirrors `quit`. An app that is not running returns `{ok:true, quit:true, stillRunning:0}`. |
| `privatesize <path>...` | `{ok, items:[{path, allocated, privateSize?, note?}], privateSizeSupported}` | Files only. `allocated` comes from `totalFileAllocatedSize`/`fileAllocatedSize`; `privateSize` additionally uses `getattrlist` with `ATTR_CMNEXT_PRIVATESIZE` (macOS 14+, APFS-aware, excludes APFS clone-shared blocks). Directories report `allocated: 0` with a `note`; missing paths report a `note` too. `privateSizeSupported` is false when the volume/filesystem rejects the extended attribute, in which case callers should fall back to `allocated`. |
| `tree <path> [--skip <path>]... [--max-entries N]` | `{ok, path, allocated, privateSize, entries, unreadable, truncated, privateSizeSupported}` | One `fts_open` walk with `FTS_PHYSICAL \| FTS_XDEV \| FTS_NOCHDIR`: physical (never follows symlinks), never crosses a device, and dedupes by `(dev, ino)` so a hardlink is counted once. `allocated` sums `st_blocks * 512` for every counted entry; `privateSize` sums `ATTR_CMNEXT_PRIVATESIZE` for regular files and `allocated` for everything else, so APFS clone-shared blocks are excluded. A skipped subtree (any path equal to a `--skip` path or under it) is not counted at all. Unreadable directories are reported as `{path, code}` (`EPERM`/`EACCES`) capped at 200. `--max-entries` stops the walk early and sets `truncated`. |
| `capacity [path]` | `{ok, path, total, available, importantUsage, opportunisticUsage, purgeableEstimate}` | Volume data for `path` (default `/`). `total` is the volume's size, `available` is the plain free space, `importantUsage` is what is available if the system purges cacheable data, `opportunisticUsage` is the pessimistic figure, and `purgeableEstimate` is `importantUsage - available` clamped at 0. |
| `icon <appPath> <outPng> [--size 64]` | `{ok, out}` | Renders `NSWorkspace.icon(forFile:)` to a `size`×`size` PNG via `NSBitmapImageRep`. Missing parent directories of `outPng` are created. |

An unknown command fails with an error that lists the available commands.

## Why no Developer ID is needed

diskwise ships without a paid Apple Developer account, so the helper is signed
**ad-hoc** (`codesign --force -s -`). That is sufficient here:

- Gatekeeper's quarantine gate applies to files that carry a `com.apple.quarantine`
  attribute, which is set by browsers and other download agents. A binary
  installed by npm (`postinstall`) or Homebrew is unpacked by those tools and is
  not quarantined, so there is no notarization policy to satisfy.
- The helper is an executable, not an app bundle, so it never goes through the
  Launch Services "is this app safe to open?" path.
- Ad-hoc signing still gives the binary a stable code identity, which macOS uses
  to remember privacy (TCC) decisions — full-disk-access–style prompts behave
  consistently across runs instead of re-prompting on every rebuild.
- If a user does download a tarball through a browser, removing the quarantine
  bit (`xattr -d com.apple.quarantine`) is the standard workaround; a Developer
  ID signature would only change which of those two steps is needed, not whether
  the tool can run.

Distributing to other machines does eventually want notarization for a smooth
first run, but nothing in this repository depends on it.

## Building

```sh
./build.sh
```

The script runs `swift build -c release --arch arm64 --arch x86_64` to produce a
universal binary. If the toolchain cannot build both architectures it prints a
warning and falls back to the host architecture, so a local build always
succeeds. The product is copied to `bin/diskwise-helper`, signed ad-hoc, and
`codesign -dv` output is printed for verification (look for `Signature=adhoc`).

Build products live in `.build/` and `bin/`, both git-ignored.

Requires Swift 6.x / Xcode Command Line Tools and macOS 14 or newer.

## Calling the helper

`packages/core/src/native/helper.ts` exports `findHelper()` plus typed wrappers
(`trashItem`, `runningApps`, `quitApp`, `privateSize`, `volumeCapacity`). The
lookup order is:

1. `$DISKWISE_HELPER`
2. `packages/native-helper/bin/diskwise-helper` relative to the module
3. `diskwise-helper` next to `process.argv[1]` (i.e. beside the installed CLI)

The wrappers throw `HELPER_MISSING` when no candidate is executable.
