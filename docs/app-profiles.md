# App profiles

An **app profile** is reviewed, declarative knowledge about one popular macOS app. It
tells macsweep which folders for that app are caches it may clean, which folders must
never be touched, and why. Profiles are data — a single exported `AppProfile` object —
so adding one never means writing cleanup code.

Without a profile, macsweep falls back to a **generic heuristic**: a fixed, whitelisted
set of cache folder names (`Cache`, `Code Cache`, `GPUCache`, …, `Caches`,
`Saved Application State`) under `~/Library/Caches/<bundleId>`,
`~/Library/Application Support/<name|bundleId>`, and a sandboxed app's container. That
covers most Electron and Chromium apps, but it cannot know that, say, Spotify's
`Caches/com.spotify.client/Data` is re-downloadable offline audio rather than a cache
the app needs.

Profiles live in `packages/core/src/apps/profiles/`, one file per app, and are collected
in `index.ts`. A profile takes precedence over the generic heuristic: its entries
replace same-path generic ones and its `protect` list downgrades overlapping generic
caches to report-only.

## Fields

```ts
export interface AppProfile {
  schemaVersion: 1;
  id: string;              // stable slug, e.g. "spotify"
  name: string;            // display name, e.g. "Spotify"
  bundleIds: string[];     // CFBundleIdentifier values this profile covers
  caches: { path: string; tier: 0 | 1; note?: string }[];
  protect?: string[];      // generic locations to keep report-only
  rationale: string;       // plain-English why this is safe
  regeneration: string;    // what it costs the user to get the data back
}
```

- **`path`** is always a `~/` path (`~/Library/...` or a dotfile under `~/`). It is
  resolved against the scan home at runtime, so profiles work against fixture homes in
  tests.
- **`tier`** is only ever 0 or 1. Tier 0 (`REGENERATES`) is rebuilt locally with no
  network; tier 1 (`REDOWNLOAD`) needs network or a long rebuild. Caches that hold user
  data are not cache entries at all — they belong in `protect`.
- **`note`** is shown next to the folder in the UI, e.g. "Offline songs and streamed
  audio; Spotify downloads them again". Keep it short and honest.

## Safety rules the lint enforces

`lintProfile` (in `lint.ts`) rejects a profile that would put user data at risk:

1. **Home-relative only.** Every cache path must start with `~/Library/` or `~/.`.
2. **No traversal.** No path (`caches` or `protect`) may contain `..`.
3. **No overlap with a protected path.** A cache that equals or sits inside a `protect`
   entry is rejected — *unless* it is strictly deeper and its last segment is a known
   cache directory: `Cache`, `Code Cache`, `GPUCache`, `CacheStorage`, `ScriptCache`,
   `GrShaderCache`, `ShaderCache`, `DawnCache`, `Caches`. This is what lets Chrome list
   `.../Google/Chrome/Default/Code Cache` while protecting `.../Google/Chrome/Default`.
4. **No user-data folder names.** A cache whose last segment contains `Cookies`,
   `Local Storage`, `IndexedDB`, `databases`, `Session Storage`, `workspaceStorage`,
   `Messages`, `Preferences`, or `Keychains` is rejected.
5. **Unique bundle ids.** `lintProfiles(all)` rejects two profiles claiming the same
   `bundleId`.

`profiles.test.ts` asserts that every shipped profile lints clean and that deliberately
dangerous test profiles (a `Cookies` cache, a `..` path, a cache equal to a `protect`
entry, a `~/Documents` cache, duplicate bundle ids) are rejected.

## Finding an app's cache folders safely

Before writing a profile, confirm which folders are caches by hand — never guess:

1. **Quit the app.** Caches are rewritten while it runs, so a folder tree read during
   use proves nothing. Use the app's own Quit, not Force Quit.
2. **Note the folder sizes** with `du -sh` (or Finder's Get Info) for the candidates in
   `~/Library/Caches/<bundleId>`, `~/Library/Application Support/<name>`,
   `~/Library/Containers/<bundleId>/Data/Library/...`, and
   `~/Library/Group Containers/<teamId>.*/Library/...`.
3. **Launch the app, use it normally for a minute, and quit again.** Folders that grew
   or were rebuilt are caches. Folders that are unchanged but hold your content (drafts,
   downloaded media you asked for, a local database) are data.
4. **Read the contents.** `ls` the folder: cache files are usually hashed blobs, `Cache`,
   `Code Cache`, `GPUCache`, `Service Worker`, `ShaderCache`. If you see `Cookies`,
   `Local Storage`, `IndexedDB`, `*.sqlite`, `*.plist`, or a folder named after a user
   concept, stop — it is not a cache.
5. **Prefer regenerating evidence.** Only claim tier 0 if the app visibly rebuilds the
   folder offline on the next launch. If restoring it needs a download, it is tier 1.
6. **Check the vendor's own docs or source** when in doubt (Electron/Chromium apps
   document these folder names). When still unsure, leave it out: a missing cache is a
   small miss; deleting user data is the failure we exist to avoid.

## Adding a profile

1. Create `packages/core/src/apps/profiles/<id>.ts` exporting one `AppProfile`.
   Copy the shape from `spotify.ts` (a tier-1 example) or `chrome.ts` (a `protect`
   example with allowed deeper caches).
2. Add it to `appProfiles` in `profiles/index.ts`.
3. Add a test. At minimum, `profiles.test.ts` proves the shipped set lints clean; for a
   profile whose generic heuristic overlaps it, add a `resolveAppLocations` test in
   `apps/locations.test.ts` using a fake home that proves the profile cache is offered,
   the generic location is still reported, and any protected path is non-actionable.
   A `buildAppReports` test in `apps/report.test.ts` can additionally prove that
   overlapping folders are not double-counted.
4. Run the narrow checks:

   ```
   pnpm vitest run packages/core/src/apps
   pnpm -F @macsweep/core typecheck
   ```

   Both must be green. The lint is the gate: if `lintProfile` rejects your paths, the
   profile is describing something unsafe, not the lint being too strict.
5. In the pull request, include the `du` before/after numbers and the app version you
   tested. That evidence is the whole review.
