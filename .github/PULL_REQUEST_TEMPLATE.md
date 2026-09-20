<!-- One logical change per PR. See CONTRIBUTING.md for rules, app profiles, and the safety review checklist. -->

## What changed

## Why

## How it was tested

## Checklist

- [ ] `pnpm test` passes
- [ ] `pnpm lint` passes, including the safety lint
- [ ] `pnpm typecheck` passes
- [ ] Docs updated if behavior, workflow, or rule semantics changed
- [ ] No new outbound network calls (loopback in `packages/server` only)
- [ ] Safety impact considered (tiers, roots, preflight, journal); PRs touching rules, profiles, safety, execution, or the server answer the checklist in CONTRIBUTING.md

Reference screenshots and snapshots are tracked in git: do not rewrite them as a side effect of running tests. If `pnpm test` touched files under `fixtures/` or the e2e snapshots, restore those files before opening the PR unless this change is intentionally updating the reference data.
