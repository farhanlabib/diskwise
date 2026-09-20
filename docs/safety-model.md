# The diskwise safety model

diskwise deletes files, so its safety guarantees are the product. This document maps every rule from the plan to **what it means**, **why it exists**, **where it is enforced**, and **which test proves it**. Every path and test name below is a real file in the repository.

A failure in any rule below blocks a release. Reports of a bypassed rule are security bugs — see [SECURITY.md](../SECURITY.md).

## 1. Dry-run is the default

- **What.** `diskwise clean` prints a plan and exits. Nothing is deleted without `--apply`.
- **Why.** The most common failure mode of a cleanup tool is doing too much, too fast, before the user has read the plan.
- **Enforced in.** `packages/core/src/execute/` (the executor refuses to run without an explicit apply flag) and `packages/cli/` (the command defaults to plan-only).
- **Tested by.** `packages/core/src/execute/execute.test.ts` — a dry run leaves the tree untouched and never touches the journal — and `packages/core/src/execute/permanent.test.ts` — a dry run leaves permanent removal untouched.

## 2. Allowlist, not denylist

- **What.** Every rule declares `roots`, and the executor rejects any target whose canonical path escapes them.
- **Why.** An allowlist fails closed. A denylist fails open the moment someone forgets an entry, and it cannot defeat symlink or `../` traversal.
- **Enforced in.** `packages/core/src/safety/paths.ts` (roots check) and `packages/core/src/rules/lint.ts` (a root must be on the approved list).
- **Tested by.** `packages/core/src/safety/paths.test.ts` — symlink escape, `../` traversal, `/` as a target, relative paths, and an unapproved root are all refused — and `packages/core/src/execute/execute.test.ts`, which re-checks the roots at execution time.

## 3. Path comparison is canonical

- **What.** Compare `realpath`, then Unicode NFD normalization, then case-fold when the volume is case-insensitive. This applies to allowlist and denylist checks alike.
- **Why.** `/system`, `/SYSTEM`, and NFC-vs-NFD home folder names all slip past a plain string comparison.
- **Enforced in.** `packages/core/src/safety/paths.ts` (a single canonicalization helper used by both checks).
- **Tested by.** `packages/core/src/safety/paths.test.ts` — case variants (`/system`), NFC vs NFD, and symlinked parents.

## 4. Prove identity, not just location

- **What.** Right before acting, `lstat` the target and require the same `dev`/`ino`/file type captured at scan time, with no symlink anywhere in the resolved chain. Abort on any mismatch.
- **Why.** Between scan and execute the path can be replaced (TOCTOU). Re-measuring is slow and still does not prove the target is the same object.
- **Enforced in.** `packages/core/src/safety/identity.ts`, called by every executor in `packages/core/src/execute/`.
- **Tested by.** `packages/core/src/safety/identity.test.ts` and `packages/core/src/execute/execute.test.ts` — a target whose inode changed under the same path is refused.

## 5. Permanent denylist, checked last

- **What.** `/`, `/System`, `/System/Volumes/*`, `/private/var/vm`, `/private/var/db`, `~/Library/Keychains`, `~/Library/Messages`, `~/Library/Mail`, `~/Library/Preferences`, `~/Library/Mobile Documents`, `~/Library/CloudStorage`, `/Applications/*.app` bundles, and Time Machine destinations are never actionable.
- **Why.** Some paths must never be touched no matter what a rule says. Checking the denylist last means no rule, profile, or bug can override it.
- **Enforced in.** `packages/core/src/safety/paths.ts`, after the allowlist check.
- **Tested by.** `packages/core/src/safety/paths.test.ts` — denylisted paths, their case variants, and NFC vs NFD variants are refused.

## 6. Tier 2 always goes to Trash

- **What.** Tier 2 items are moved to Trash. Permanent removal needs `--permanent` plus typed confirmation of the rule id. `permanentOnly` items always need typed confirmation, and Tier 2 is refused outright in a non-TTY.
- **Why.** User data must be recoverable by default, and the irreversible path must be deliberate.
- **Enforced in.** `packages/core/src/execute/` (tier gating and confirmation) and `packages/cli/` (non-TTY refusal).
- **Tested by.** `packages/core/src/execute/execute.test.ts` — a mismatched typed id blocks the action, and Tier 2 without `--permanent` becomes a Trash move — and `packages/core/src/execute/permanent.test.ts` — permanent removal without the typed rule id is skipped.

## 7. Root work is never automated

- **What.** `needsRoot` rules emit the exact command for the user to run themselves. diskwise never shells out to `sudo` and never shows a password prompt.
- **Why.** A tool that asks for your password to delete system paths is a tool you cannot audit. The user stays in control of privileged actions.
- **Enforced in.** `packages/core/src/rules/lint.ts` (a `needsRoot` rule must carry a `manualCommand` and an action that does not run) and `packages/core/src/plan/plan.ts` (a `needsRoot` finding becomes a rendered manual command, never an actionable item).
- **Tested by.** `packages/core/src/rules/lint.test.ts` and `packages/core/src/plan/plan.test.ts` — a `needsRoot` rule without a `manualCommand` is rejected, and the command lands in the plan's manual list, not its items.

## 8. Preflight state checks come from rule data

- **What.** Rules declare `preflight` (`processes`, `daemons`, `bootedSimulators`). diskwise refuses to touch an app's caches while it runs, Docker data while the daemon runs, or a runtime while a simulator is booted.
- **Why.** Deleting files out from under a running process corrupts data. The checks are data, so they are reviewable and testable.
- **Enforced in.** `packages/core/src/execute/` (preflight runs before every action).
- **Tested by.** `packages/core/src/execute/execute.test.ts` — an item blocked by a running process is skipped with the reason.

## 9. Write-ahead journal and single-run lock

- **What.** Every action writes an **intent** record before it runs and a **result** record after it, as JSONL at `~/.diskwise/journal/<timestamp>.jsonl`. A lockfile at `~/.diskwise/lock` prevents concurrent runs (CLI and GUI).
- **Why.** If a run crashes after deleting but before recording, history is silently lost. The intent-first write makes every run auditable and every gap explainable.
- **Enforced in.** `packages/core/src/journal/journal.ts` and `packages/core/src/journal/lock.ts`, used by `packages/core/src/execute/`.
- **Tested by.** `packages/core/src/journal/journal.test.ts` — an interrupted run is flagged as incomplete and a malformed trailing line after a crash is skipped — and `packages/core/src/journal/lock.test.ts` — a live lock blocks a second run while a stale or garbage lock is taken over.

## 10. Undo

- **What.** `diskwise undo --last` restores Trash moves from the URLs recorded when the native helper trashed them, and states exactly what it cannot restore and why ("Trash was emptied", "rebuilds automatically").
- **Why.** Recoverability is what makes Tier 2 safe to offer, and honest reporting is what makes the tool trustworthy when recovery is impossible.
- **Enforced in.** `packages/core/src/journal/journal.ts` (recorded trashed URLs) and `packages/core/src/journal/undo.ts` (the undo path).
- **Tested by.** `packages/core/src/journal/undo.test.ts` — a recorded Trash move round-trips, every failure mode (including `missing-from-trash`) is reported, and undo is repeat-safe.

## 11. No outbound network, no telemetry

- **What.** There are no outbound network calls and no telemetry anywhere. Updates come through npm or Homebrew; there is no in-app update check. Only `packages/server` may call `http.createServer`, and only for loopback listening. The UI ships a strict CSP (`default-src 'self'; connect-src 'self'`).
- **Why.** A tool that reads your entire disk has no business talking to the internet. "No network" is easy to state and test; "limited network" is not.
- **Enforced in.** `eslint.config.js` bans `https`, `net`, `dgram`, `undici`, `http2`, `tls`, `http`, and their `node:` forms in `packages/**`, and bans the `fetch` and `WebSocket` globals. `packages/cli/src/env.ts` stamps the suppression env (`HOMEBREW_NO_AUTO_UPDATE=1`, `HOMEBREW_NO_ANALYTICS=1`, `HOMEBREW_NO_ENV_HINTS=1`, `NPM_CONFIG_UPDATE_NOTIFIER=false`) into the CLI process, and `packages/core/src/probes/run.ts` applies the same env to every probe, so a vendor tool cannot reach out on our behalf. Binary resolution (`packages/core/src/probes/bin-resolver.ts`) checks known macOS prefixes and the inherited `PATH` only — no login or interactive shell is ever spawned and no shell startup file is evaluated.
- **Tested by.** `packages/server/src/no-network.test.ts` — the local UI server flow and the CLI tool-detection flow run while outbound connection attempts are blocked and recorded (dead-loopback proxy env plus `http`, DNS, and `fetch` guards), failing on any attempt, and the built `packages/ui/dist` bundle is scanned for external scripts, styles, fonts, images, and API URLs.

## 12. The local UI server is not an attack surface

- **What.** The `diskwise ui` server binds `127.0.0.1` only, requires a per-session secret token, validates `Host` and `Origin`, sends no CORS headers, and shuts down with the CLI process.
- **Why.** A local server that answers any local request is reachable by any web page you have open. Every request must be proven to come from the UI we launched.
- **Enforced in.** `packages/server/` (binding, router, token and header checks, job manager).
- **Tested by.** `packages/server/src/server.test.ts` — the server security suite below.

### Server threat model

| Threat                                     | Mitigation                                                                                                                                                                                                                               | Tested by                                                                                                                                          |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Other machines on the network              | Bind `127.0.0.1` only, never `0.0.0.0` or `::`                                                                                                                                                                                           | `packages/server/src/server.test.ts` — asserts the bound address is loopback                                                                    |
| Malicious website calling localhost (CSRF) | 256-bit random token generated per run, passed once in the URL fragment (`#t=…`, never sent in server-side logs), stored in `sessionStorage`, and sent as `Authorization: Bearer` on every call. Missing or wrong token → 401            | `packages/server/src/server.test.ts` — missing and wrong tokens return 401                                                                      |
| DNS rebinding                              | Reject any request whose `Host` isn't exactly `127.0.0.1:<port>` or `localhost:<port>`                                                                                                                                                   | `packages/server/src/server.test.ts` — a foreign `Host` returns 403                                                                             |
| Cross-origin reads                         | No CORS headers. Reject requests with a foreign `Origin`. Mutating endpoints are `POST` with `Content-Type: application/json` only                                                                                                       | `packages/server/src/server.test.ts` — a foreign `Origin` returns 403, a form or `text/plain` POST returns 415, and no CORS headers are present |
| Clickjacking                               | `X-Frame-Options: DENY`, `frame-ancestors 'none'`                                                                                                                                                                                        | `packages/server/src/server.test.ts` — response headers include both                                                                            |
| Other local users                          | Token plus per-user server. The port is ephemeral and the server exits with the CLI                                                                                                                                                      | `packages/server/src/server.test.ts` — the server shuts down with the process and after the idle timeout                                        |
| Destructive API misuse                     | The API can only execute a `CleanupPlan` produced by this server's own scan (plan id + finding ids). There is no "delete this path" endpoint. Every §5 check still runs server-side, and typed confirmation is re-verified by the server | `packages/server/src/server.test.ts` — no endpoint accepts a raw path, and a plan id or finding id from another run is refused                  |
