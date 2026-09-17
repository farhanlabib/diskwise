# What "System Data" really is

Open System Settings → General → Storage on any Mac and you will see a category called **System Data**. It is often the single biggest bar on the screen, and it is also the one Apple never explains. There is no public API that returns it, no folder named "System Data", and no way to click into it. It is a remainder: everything on the volume that the other categories did not claim.

macsweep takes the same idea and makes the remainder legible. This document explains how that estimate is built, what each bucket contains, and which parts are safe to touch.

## How macsweep defines it

```
System Data total = container used − visible space
System Data measured = sum of the buckets macsweep can walk
System Data unmeasured = total − measured   (never negative)
```

- **Container used** comes from `diskutil info -plist /` (`APFSContainerSize − APFSContainerFree`). It is the whole APFS container, not just the system volume, which is why it is the right denominator for "why is my disk full".
- **Visible space** is what macOS already shows in its own categories: the app bundles (`/Applications` and any extra roots) plus the user-visible folders `~/Desktop`, `~/Documents`, `~/Downloads`, `~/Pictures`, `~/Movies`, `~/Music` and `~/.Trash`. These are measured and then subtracted, so they are never counted as System Data.
- **The buckets** are measured once each, sharing a single set of seen file identities (`dev:ino`), so hardlinks and overlapping roots are counted a single time. Parent buckets are the sum of their children plus whatever is left over, so the tree always adds up.
- **Unmeasured** is simply what is left. It exists so the numbers are honest: `measured + unmeasured = total`, always.

Everything is measured as **allocated** size (`st.blocks * 512`), the space the file system actually reserves, not the logical file length. That is why macsweep can report a 228 GB sparse file as 2.7 GB.

**Excluded from measurement:** `~/Library/CloudStorage`, `~/Library/Mobile Documents`, `/Library/CloudStorage`, plus `/System/Volumes/Data`, `/Volumes` and `/dev`. Cloud-storage folders are File Provider mounts; they report the boot volume's device id, so a walker cannot tell them apart from local data, and enumerating them can block for minutes while the provider syncs. They hold cloud data, not local System Data, so macsweep skips them rather than hanging. If you keep local files in a cloud folder, they are not counted in the buckets and land in Unmeasured.

## The buckets

For each bucket: what lives there, and whether it is safe to remove.

### CoreSimulator — `/Library/Developer/CoreSimulator`

Xcode's simulator runtimes, simulated devices and caches. Children: `Images` (downloaded runtime images), `Devices` (per-simulator data), `Caches` (dyld and shader caches). Runtimes are large (several GB each) and re-downloadable from Apple; old devices can be erased. The walker does not cross into the mounted runtime volumes, so each runtime image is counted once rather than once per mount.

- **Images / runtimes:** removable, but use Xcode Settings → Platforms or `xcrun simctl runtime delete`; tier 1 (re-download).
- **Devices:** erase individually with `xcrun simctl delete`; old devices are tier 0/1.
- **Caches:** rebuild automatically; tier 0.

### /Library (other) — `/Library`

Shared support files for macOS and installed apps. Children: `Application Support`, `Caches`, `Updates`, `Developer` (excluding CoreSimulator). This is mostly system-owned. `Caches` and `Updates` are the reclaimable parts; `Application Support` and `Developer` are shared assets that apps and tools expect to find.

- **Caches:** rebuild on demand; tier 0.
- **Updates:** staged installers, removed by macOS after installing; tier 1. Only clear when no update is pending.
- **Application Support / Developer:** mixed. Report-only unless a specific rule proves an item is regenerable.

### /private/var

Runtime state for macOS and apps. Children: `vm` (swap files and the sleep image), `folders` (per-user temporary folders), `db` (system databases and installer receipts), `log` (system logs). This bucket is tier 3. `vm` is managed by the kernel — swap grows under memory pressure and **shrinks after a restart**; deleting swap files by hand can corrupt or crash the running system. `folders` is cleared by macOS at reboot. `db` and `log` are read-only to macsweep.

- **vm:** never touch.
- **folders:** macOS cleans it; a reboot is the correct "fix".
- **db / log:** never delete; `log` is rotated and aged out by the system.

### Homebrew — `/opt/homebrew` (Apple silicon) or `/usr/local/Homebrew` (Intel)

Homebrew packages, downloads and build caches. The reclaimable part is downloads and old versions, which `brew cleanup` handles correctly and knows what is still needed.

- **Cells / downloads / caches:** tier 1. Prefer `brew cleanup` over deleting directories.

### ~/Library

Your personal library: caches, sandboxed app containers, and support files. Children: `Caches`, `Containers`, `Group Containers`, `Application Support`, `Developer`, `Logs`, `Mail`, `Messages`.

- **Caches / Logs:** rebuild; tier 0.
- **Containers / Group Containers / Application Support:** mixed. Some hold real data (an offline library, a database). macsweep only acts on them through reviewed, per-app rules.
- **Mail / Messages:** your actual messages and attachments. Tier 2/3 — Trash or report only, never deleted.

### Hidden home folders

Every dot-directory directly in your home other than `~/.Trash`, grouped into one bucket with the ten largest shown as children: things like `~/.npm`, `~/.cache`, `~/.cargo`, `~/.gradle`. Tool caches rebuild; configs and credentials (for example `~/.ssh`, `~/.aws`) also live here, so this is treated as user data. `~/Library` has its own bucket and is measured there.

## Snapshots

Local Time Machine snapshots are listed with `tmutil listlocalsnapshots /`. macsweep reports their **count and names only**: their size cannot be read without admin rights, so counting it would be a guess. They are shown with a zero-byte row, a tier 3 marker, and the command that thins them:

```
$ tmutil thinlocalsnapshots / 10000000000 4
```

This asks macOS to reclaim up to 10 GB of local snapshots, keeping the four most recent. macOS decides what it can actually free.

## Why Unmeasured exists

`/private/var/db` internals, `~/Library/Mail` for a non-authorized account, other users' home directories, APFS metadata and purgeable space are all protected by the system or by SIP. macsweep would have to report a number it cannot verify, so it does not. Instead it puts the difference in a single **Unmeasured** row and says so. `measured + unmeasured` equals the total by construction. The honest gap is more useful than a confident wrong number.

If Unmeasured is large, grant Full Disk Access in System Settings → Privacy & Security → Full Disk Access and re-run; some of that gap will move into the measured buckets. The rest is genuinely macOS's.

## Reading `macsweep audit --explain`

`macsweep audit --explain` is the teaching view of the decomposition — the same data as this document, for the Mac in front of you:

```
What macOS calls "System Data": 49.0 GB

CoreSimulator              ████████        16.2 GB
    Xcode simulator data: runtime images, simulated devices and caches. The walker does not
    cross into the mounted runtime volumes, so each runtime image is counted once.
  └ Images  15.4 GB
  └ Devices  0.8 GB
...

Unmeasured                   ████████████  24.1 GB
    macOS protects these areas; macsweep reports the gap instead of guessing.

Measured 24.9 GB of 49.0 GB
```

- The bar is proportional to the **total**, not to the largest bucket, so its width is the bucket's share of the whole System Data figure. A bar at full width is a bucket that *is* the whole remainder.
- The size on the right is allocated bytes on disk, formatted the way Finder counts (decimal units).
- Each bucket's explanation sits on the line below its row.
- Children are indented with `└`; they are already included in the parent's size, they do not add to it.
- A `$ command` line is a manual step: macsweep never runs `sudo` and never automates root work.
- The last row is **Unmeasured**; the footer states how much of the total macsweep actually measured.

The buckets plus Unmeasured always equal the total. If you want the machine-readable version, `macsweep audit --json` includes the same report under `systemData`.
