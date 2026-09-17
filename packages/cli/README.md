# macsweep

**Explains where your Mac's disk space went — and only deletes what is provably safe.**

macOS reports a vague "System Data" bucket that swallows tens of gigabytes with no explanation. macsweep decomposes it into named, sized, explained buckets, reports honest allocated bytes (never apparent bytes), and tiers every action with a stated cost: why it is safe, and what it costs to get back.

macsweep's product is the reasoning, not the deletion. `clean` is a dry run unless you pass `--apply`.

```sh
npx macsweep audit
```

Requires macOS 14 Sonoma or later, on Apple Silicon or Intel, with Node.js 20+.

## Commands

```sh
macsweep audit                         # full report, decomposed, with tiers
macsweep audit --json                  # machine-readable, versioned schema
macsweep audit --explain               # teaching mode: what "System Data" really is
macsweep audit --category dev|system|browser|app|user-data|os-leftovers
macsweep doctor                        # xcode/docker/brew/node versions, Full Disk Access status
macsweep plan --tier 0,1 [-o plan.json]
macsweep clean --tier 0 --apply        # dry run by default; nothing is deleted without --apply
macsweep clean --plan plan.json --apply
macsweep clean --interactive           # per-item prompts
macsweep undo --last                   # restore the last run's Trash moves
macsweep history                       # browse past runs
macsweep apps                          # installed apps sorted by reclaimable cache
macsweep apps clean slack --apply      # one app's caches/logs/saved state — never app data
macsweep report --redact               # shareable report, no usernames or hostnames
macsweep ui                            # local web UI on 127.0.0.1, opened in your browser
```

## Safety tiers

| Tier | Name          | Meaning                                                                                            | Default action                                                       |
| ---- | ------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 0    | `REGENERATES` | No user data, rebuilt **locally** with no network (build outputs, render/code caches)              | Delete permanently                                                   |
| 1    | `REDOWNLOAD`  | No user data, but restoring needs **network or a long rebuild** (package caches, runtimes, models) | Delete permanently, shown with cost                                  |
| 2    | `USER_DATA`   | Contains real user data                                                                            | **Move to Trash**. Permanent only with `clean --apply --permanent` and a typed phrase |
| 3    | `NEVER`       | Explained for education, **never** actionable. May show a manual command                           | No action exists                                                     |

Tier 3 is a feature, not a gap: it is how macsweep explains swap, `/private/var/db`, Keychains, snapshots, and Docker volumes without ever offering to break the machine.

## Full Disk Access

macOS hides some folders (`~/Library/Safari`, parts of `~/Library/Mail`, `~/Library/Messages`, and other apps' containers) from every process without Full Disk Access. macsweep reports what it could not read instead of hiding it, and names the app you should grant access to.

Grant Full Disk Access to **the app that runs your terminal** (Terminal, iTerm2, Ghostty, Warp, or VS Code) in System Settings → Privacy & Security → Full Disk Access, then restart `macsweep`. Without it, macsweep still works, but more of the disk shows up as unreadable and containers are skipped rather than prompting.

## Privacy

- **No telemetry. Ever.**
- **No outbound network calls at all.** Updates come through npm or Homebrew; there is no in-app update check.
- The web UI listens on `127.0.0.1` only, uses a per-session token passed in the URL fragment and sent as `Authorization: Bearer`, and shuts down with the CLI process.
- `macsweep report --redact` rewrites your home folder, hostnames, and volume names before you share a report.

## Why there is no `.app`

Shipping a downloadable `.app` needs an Apple Developer account: without notarization, macOS 15+ makes users click through Gatekeeper, and an ad-hoc signed app's Full Disk Access grant is tied to its code hash, so it is lost on every update.

So there is no `.app`. `macsweep ui` runs inside the CLI process and **reuses your terminal's Full Disk Access**. Nothing needs signing, nothing needs a paid account, and every artifact is buildable from source with free tools.

## License

MIT — see [LICENSE](./LICENSE).
