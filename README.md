# diskwise

[![CI](https://github.com/farhanlabib/diskwise/actions/workflows/ci.yml/badge.svg)](https://github.com/farhanlabib/diskwise/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/diskwise)](https://www.npmjs.com/package/diskwise)
[![npm downloads](https://img.shields.io/npm/dm/diskwise)](https://www.npmjs.com/package/diskwise)
[![licence: MIT](https://img.shields.io/npm/l/diskwise)](./LICENSE)
![macOS 14+ | Node 22+](https://img.shields.io/badge/macOS_14%2B_%7C_Node_22%2B-lightgrey)

diskwise is an open-source macOS disk cleanup tool that **explains where your space went** and **only deletes what is provably safe**.

macOS reports a vague "System Data" bucket that swallows tens of gigabytes with no explanation. Generic cleaners either show _where_ the space is without explaining _what it is_, or delete aggressively with weak rationale. diskwise's product is the reasoning, not the deletion.

- **It decomposes "System Data"** into named, sized, explained buckets, including an honest **Unmeasured** bucket for what can't be read.
- **It never lies about sizes.** It reports _allocated_ bytes (and _reclaimable_ bytes once APFS clones are understood), never apparent bytes. Hardlinks and clones are never double-counted.
- **It tiers every action** with a stated cost: why it is safe, and what it costs to get back.
- **It shows a per-app view**, so you can clean one app's caches without touching its data or signing you out.

## Why

A real audit of the machine this project was derived from found:

| Finding                                               | Reality                                                                                                                   |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| "System Data" ~78 GB                                  | Mostly `/Library/Developer/CoreSimulator` + `/private/var` (7.7 GB) + `/opt/homebrew` (5 GB)                              |
| Two iOS simulator runtimes                            | ~32 GB, and 16 GB of that was a runtime nobody was using                                                                  |
| `Docker.raw`                                          | `ls -l` reports **228 GB**, but only **2.7 GB** is actually allocated (a sparse file)                                     |
| 55 `node_modules` folders                             | ~10 GB of dependencies that can be reinstalled                                                                            |
| Chrome `OptGuideOnDeviceModel`                        | A 4 GB on-device AI model, downloaded silently                                                                            |
| App caches (Slack, Discord, VS Code, Teams, Spotify…) | Several GB spread across `Caches`, `Application Support/*/Cache`, and `Containers`. Finder doesn't show any of it per app |

## Features

- **System Data decomposition** — `/Library`, `/private/var`, `/opt/homebrew`, hidden `~/Library`, and local snapshots, with an **Unmeasured** bucket so the parts always add up to the whole.
- **Honest sizes** — allocated vs apparent bytes are reported separately, so sparse files like `Docker.raw` stop looking scary.
- **Safety tiers** — every target carries a tier, a rationale, and a restore cost (see below).
- **Per-app caches** — one app at a time, cache folders only, with sign-in and app data kept report-only.
- **Old macOS leftovers** — installers, staging data, old SDKs, and Device Support from previous OS versions, in their own category.
- **Local web UI** — `diskwise ui` serves a browser interface on `127.0.0.1` only. No Electron, no `.app`, nothing to notarize.

## Safety tiers

| Tier | Name          | Meaning                                                                                            | Default action                                                       |
| ---- | ------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 0    | `REGENERATES` | No user data, rebuilt **locally** with no network (build outputs, render/code caches)              | Delete permanently                                                   |
| 1    | `REDOWNLOAD`  | No user data, but restoring needs **network or a long rebuild** (package caches, runtimes, models) | Delete permanently, shown with cost                                  |
| 2    | `USER_DATA`   | Contains real user data                                                                            | **Move to Trash**. Permanent only with `clean --apply --permanent` and a typed phrase |
| 3    | `NEVER`       | Explained for education, **never** actionable. May show a manual command                           | No action exists                                                     |

Tier 3 is a feature, not a gap: it is how diskwise explains swap, `/private/var/db`, Keychains, snapshots, and Docker volumes without ever offering to break the machine.

## Install

```sh
# Run it without installing anything:
npx diskwise audit

# Or install globally:
npm i -g diskwise          # then just: diskwise audit

# Or with Homebrew (the tap ships with the first tagged release):
brew install farhanlabib/tap/diskwise

# Build from source (Node 22+ and Xcode Command Line Tools):
pnpm install
packages/native-helper/build.sh
pnpm -F @diskwise/ui build
pnpm -F diskwise build
node packages/cli/dist/index.js audit
```

Requirements: macOS 14 Sonoma or later, on Apple Silicon or Intel, with Node.js 22+.

## Usage

```sh
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
diskwise clean --tier 2 --apply --permanent  # Tier 2 permanently instead of Trash; typed phrase per rule
diskwise undo --last
diskwise history
diskwise rules list | rules show <id>
diskwise report --markdown --redact > disk-report.md
diskwise ui [--port 0] [--no-open]    # start the local web UI on 127.0.0.1 and open the browser
```

`diskwise clean` is a dry run by default. It prints a plan and exits; nothing is deleted without `--apply`.

Tier 2 items always go to the Trash. Permanent deletion exists only in the CLI: `clean --apply --permanent` asks you to type a phrase per rule and refuses to run without an interactive terminal. The web UI can apply the same plans with in-browser confirmations, but it never deletes permanently — every Tier 2 action there is a Trash move.

## Privacy

- **No telemetry. Ever.**
- **No outbound network calls at all.** Updates come through npm or Homebrew; there is no in-app update check. This is enforced by lint rules that ban the network modules, by an integration test that runs the CLI tool detection and the local UI server while every outbound connection attempt is blocked and recorded, and by a scan of the packaged UI assets for external scripts, styles, fonts, images, and API URLs. No step spawns a shell — not even tool discovery.
- The web UI listens on `127.0.0.1` only, uses a per-session token, and shuts down with the CLI process.
- `diskwise report --markdown --redact` rewrites your home folder, hostnames, and volume names before you share a report.

## Full Disk Access

macOS hides some folders (`~/Library/Safari`, parts of `~/Library/Mail`, `~/Library/Messages`, and other apps' containers) from every process without Full Disk Access. diskwise reports what it could not read instead of hiding it, and names the app you should grant access to.

Grant Full Disk Access to **your terminal app** (Terminal, iTerm2, Ghostty, Warp, or VS Code) in System Settings → Privacy & Security → Full Disk Access, then restart `diskwise`. Without it, diskwise still works, but more of the disk shows up as Unreadable and containers are skipped rather than prompting.

## Why no `.app`?

Shipping a downloadable `.app` needs an Apple Developer account: without notarization, macOS 15+ makes users click through Gatekeeper, and an ad-hoc signed app's Full Disk Access grant is tied to its code hash, so it is lost on every update.

So there is no `.app`. `diskwise ui` runs inside the CLI process and **reuses your terminal's Full Disk Access**. Nothing needs signing, nothing needs a paid account, and every artifact is buildable from source with free tools.

## Status

**v0.2.0.** Everything in the usage list ships: audit, plan, clean with `--apply`, journaling with `undo` and `history`, report, rules, doctor, per-app cleaning, and the local web UI. The newest areas are still experimental: the web UI and orphaned-app-data detection (`apps --orphans`). Expect rough edges.

## Releases

Merging a pull request into `main` runs CI only. A `vX.Y.Z` tag publishes the CLI to npm and updates the Homebrew tap; [docs/development.md](./docs/development.md) and [packaging/README.md](./packaging/README.md) have the details.

## Contributing

- Rule and app-profile walkthroughs: [CONTRIBUTING.md](./CONTRIBUTING.md)
- Code of conduct: [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)
- Security reports: [SECURITY.md](./SECURITY.md)
- Issues: templates under [.github/ISSUE_TEMPLATE/](./.github/ISSUE_TEMPLATE/)

## License

MIT — see [LICENSE](./LICENSE).
