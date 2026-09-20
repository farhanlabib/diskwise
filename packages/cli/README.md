# diskwise

[![CI](https://github.com/farhanlabib/diskwise/actions/workflows/ci.yml/badge.svg)](https://github.com/farhanlabib/diskwise/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/diskwise)](https://www.npmjs.com/package/diskwise)
[![npm downloads](https://img.shields.io/npm/dm/diskwise)](https://www.npmjs.com/package/diskwise)
[![licence: MIT](https://img.shields.io/npm/l/diskwise)](./LICENSE)
![macOS 14+ | Node 22+](https://img.shields.io/badge/macOS_14%2B_%7C_Node_22%2B-lightgrey)

**Explains where your Mac's disk space went — and only deletes what is provably safe.**

macOS reports a vague "System Data" bucket that swallows tens of gigabytes with no explanation. diskwise decomposes it into named, sized, explained buckets, reports honest allocated bytes (never apparent bytes), and tiers every action with a stated cost: why it is safe, and what it costs to get back.

diskwise's product is the reasoning, not the deletion. `clean` is a dry run unless you pass `--apply`.

```sh
npx diskwise audit   # or: npm i -g diskwise && diskwise audit
```

Requires macOS 14 Sonoma or later, on Apple Silicon or Intel, with Node.js 22+.

## Commands

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

## Status

**v0.2.0.** Everything in the command list ships: audit, plan, clean with `--apply`, journaling with `undo` and `history`, report, rules, doctor, per-app cleaning, and the local web UI. The newest areas are still experimental: the web UI and orphaned-app-data detection (`apps --orphans`). Expect rough edges.

## Releases

Merging a pull request into `main` runs CI only. A `vX.Y.Z` tag publishes the CLI to npm and updates the Homebrew tap; [docs/development.md](https://github.com/farhanlabib/diskwise/blob/main/docs/development.md) and [packaging/README.md](https://github.com/farhanlabib/diskwise/blob/main/packaging/README.md) have the details.

## Safety tiers

| Tier | Name          | Meaning                                                                                            | Default action                                                       |
| ---- | ------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 0    | `REGENERATES` | No user data, rebuilt **locally** with no network (build outputs, render/code caches)              | Delete permanently                                                   |
| 1    | `REDOWNLOAD`  | No user data, but restoring needs **network or a long rebuild** (package caches, runtimes, models) | Delete permanently, shown with cost                                  |
| 2    | `USER_DATA`   | Contains real user data                                                                            | **Move to Trash**. Permanent only with `clean --apply --permanent` and a typed phrase |
| 3    | `NEVER`       | Explained for education, **never** actionable. May show a manual command                           | No action exists                                                     |

Tier 3 is a feature, not a gap: it is how diskwise explains swap, `/private/var/db`, Keychains, snapshots, and Docker volumes without ever offering to break the machine.

## Full Disk Access

macOS hides some folders (`~/Library/Safari`, parts of `~/Library/Mail`, `~/Library/Messages`, and other apps' containers) from every process without Full Disk Access. diskwise reports what it could not read instead of hiding it, and names the app you should grant access to.

Grant Full Disk Access to **the app that runs your terminal** (Terminal, iTerm2, Ghostty, Warp, or VS Code) in System Settings → Privacy & Security → Full Disk Access, then restart `diskwise`. Without it, diskwise still works, but more of the disk shows up as unreadable and containers are skipped rather than prompting.

## Privacy

- **No telemetry. Ever.**
- **No outbound network calls at all.** Updates come through npm or Homebrew; there is no in-app update check.
- The web UI listens on `127.0.0.1` only, uses a per-session token passed in the URL fragment and sent as `Authorization: Bearer`, and shuts down with the CLI process.
- `diskwise report --redact` rewrites your home folder, hostnames, and volume names before you share a report.

## Why there is no `.app`

Shipping a downloadable `.app` needs an Apple Developer account: without notarization, macOS 15+ makes users click through Gatekeeper, and an ad-hoc signed app's Full Disk Access grant is tied to its code hash, so it is lost on every update.

So there is no `.app`. `diskwise ui` runs inside the CLI process and **reuses your terminal's Full Disk Access**. Nothing needs signing, nothing needs a paid account, and every artifact is buildable from source with free tools.

## License

MIT — see [LICENSE](./LICENSE).
