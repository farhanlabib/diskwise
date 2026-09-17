# Security Policy

## Supported versions

diskwise is in early development. Security fixes land on `main` and ship in the next release; only the latest published version is supported.

| Version                  | Supported |
| ------------------------ | --------- |
| `main` (unreleased)      | Yes       |
| Latest published release | Yes       |
| Older releases           | No        |

## Reporting a vulnerability

Please report security issues **privately** through GitHub's [private vulnerability reporting](https://github.com/<owner>/diskwise/security/advisories/new). Do not open a public issue for a security bug.

Include what you did, what happened, and what you expected, plus `diskwise --version` and your macOS version. A redacted report (`diskwise report --markdown --redact`) helps and never includes your username or private paths. We will acknowledge your report, keep you updated while we investigate, and credit you in the fix unless you prefer otherwise.

## What counts as a security bug

diskwise deletes files, so anything that makes a deletion unsafe or unexpected is a security bug:

- **A rule or app profile that deletes user data**, or that offers to delete data that is not provably regenerable.
- **A rule that escapes its declared roots** — symlink traversal, `../`, a path swapped between scan and execute, Unicode or case variants, or a target outside the rule's allowlist.
- **Bypassing dry-run**, or any action that executes without `--apply`.
- **Any outbound network call**, in the CLI, the library, or the UI. diskwise is offline by design.
- **Any UI server exposure beyond loopback** — binding anything other than `127.0.0.1`, missing or unenforced token checks, a missing `Host` or `Origin` check, or CORS headers.
- **Skipping a safety check**: a missing denylist check, an identity (`dev`/`ino`) mismatch that is not refused, a preflight that does not block, or a journal that can lose an action.

## Safety model

diskwise's safety guarantees are the product, and they are enforced in code and tested adversarially:

1. Dry-run is the default; nothing runs without `--apply`.
2. Allowlists, not denylists: every rule declares `roots` and targets must resolve inside them.
3. Canonical path comparison: `realpath`, then NFD normalization, then case-folding on case-insensitive volumes.
4. Identity is proved, not just location: the same `dev`/`ino`/type as at scan time, with no symlink in the resolved chain.
5. A permanent denylist is checked last, so it can never be overridden.
6. Tier 2 always goes to Trash; permanent removal needs `--permanent` and typed confirmation.
7. Root work is never automated; `needsRoot` rules print a command for you to run.
8. Preflight state checks come from rule data and refuse to corrupt running apps or daemons.
9. A write-ahead journal records an intent before every action and a result after it.
10. Undo restores Trash moves from recorded URLs, and says what it cannot restore and why.
11. No outbound network and no telemetry, enforced by lint and by tests with connections blocked.
12. The local UI server is not an attack surface: loopback only, per-session token, `Host`/`Origin` checks, no CORS.

The full model — what each rule means, where it is enforced, and which test covers it — is in [docs/safety-model.md](./docs/safety-model.md).
