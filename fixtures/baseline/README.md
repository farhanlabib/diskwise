# Baseline

A **redacted** audit of the reference Mac, used by PLAN.md §12 to verify that measurements stay correct between milestones. The reference numbers themselves (the ~78 GB "System Data", the 16 GB unused simulator runtime, `Docker.raw`'s 228 GB apparent / 2.7 GB allocated split) are not hardcoded anywhere; this file is the record they are compared against.

- `audit.redacted.json` — the output of `diskwise report --json --redact`, so usernames, hostnames, volume names, and home paths are already rewritten or stripped. It is safe to commit.

## Re-recording

Build the CLI, then run the recorder. It only reads the disk; it never writes outside this directory.

```sh
pnpm install
packages/native-helper/build.sh
pnpm -F @diskwise/ui build
pnpm -F @farhanlabib/diskwise build
node scripts/record-baseline.mjs
```

The script runs `node packages/cli/dist/index.js report --json --redact`, writes `audit.redacted.json`, and prints a summary line (`reclaimable … · N findings`). Never hand-edit the JSON — re-record it, so the file always reflects what the scanner actually produced.

## How it is compared (±10%)

Verification runs a fresh `node packages/cli/dist/index.js audit --json` and diffs it against this baseline. Bytes may differ by up to **±10%**; anything larger must be explained by a journal entry or a real change in the rule catalog, not waved away. The comparison checks the specific claims that catch measurement bugs:

- Simulator runtimes are listed **individually**, with mounted volumes never double-counted (the original session measured 19 GB and 39 GB for the same runtimes because of exactly that bug — see PLAN.md §1).
- Roughly 55 `node_modules` directories are found.
- `Docker.raw` is reported as ~2.7 GB **allocated**, with its ~228 GB **apparent** size called out as a trap, so no fabricated 228 GB reaches the totals.

Redaction removes paths and hostnames, so byte totals and finding counts are the parts that matter; the exact paths in this file are abbreviated by design.
