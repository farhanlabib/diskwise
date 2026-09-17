# Contributing to macsweep

Thanks for helping make disk cleanup honest. There are two main ways to contribute: **add a cleanup rule** and **add an app profile**. Both are declarative data, not code, so they can be reviewed safely.

## Setup

```sh
pnpm install                        # install workspace dependencies
pnpm test                           # run the test suite
packages/native-helper/build.sh     # build the ad-hoc-signed Swift helper (macOS only)
```

Other useful commands:

```sh
pnpm lint                           # eslint, including the no-network rules
pnpm typecheck                      # tsc across the workspace
pnpm format                         # prettier --write
```

## Repository layout

```
packages/
  core/           @macsweep/core — the entire engine (fs, sources, probes, rules, apps, scan, plan, execute, safety)
  native-helper/  Swift CLI: trash, privatesize, capacity, running-apps, quit-app, icons
  report/         @macsweep/report — table, json, and markdown formatters
  server/         @macsweep/server — loopback-only HTTP + SSE API over core
  ui/             @macsweep/ui — React + Vite + Tailwind, built to static assets
  cli/            macsweep — the published binary (bundles server, ui assets, helper)
fixtures/         trees/ (synthetic filesystems), probes/ (recorded vendor output), baseline/ (redacted audit)
docs/             architecture.md, safety-model.md, system-data.md, app-profiles.md
```

## Add a cleanup rule

Rules are data. Code lives only in a small set of maintainer-reviewed matchers and executors, referenced by id. You add a rule object; you do not add matching or deletion logic.

Rules live in `packages/core/src/rules/catalog/*.ts`. Group them by theme (`xcode.ts`, `docker.ts`, `node.ts`, `browsers.ts`, `os-leftovers.ts`, …).

1. **Pick the tier by the definitions.** Tier 0 regenerates _locally with no network_. Tier 1 needs _network or a long rebuild_. Tier 2 contains _real user data_ (Trash by default). Tier 3 is _explain-only_ and must not have an `action`. If you are unsure between 0 and 1, it is 1.
2. **Write the rationale and the regeneration.** `rationale` answers "why is this provably safe to delete". `regeneration` answers "what does it cost to get back" — be specific ("Chrome re-downloads ~4 GB unless disabled") rather than vague ("it comes back").
3. **Declare narrow roots.** `roots` is an allowlist. Every target must resolve inside it, so list the smallest directory that contains the target (for example `~/Library/Developer/Xcode/DerivedData`, not `~/Library/Developer`). The executor rejects any target whose canonical path escapes its roots.
4. **Choose a declarative matcher.** `path`, `glob-children`, `project-dirs`, or `probe`. If you find yourself wanting arbitrary code in a rule, open an issue instead: new matchers need maintainer review.
5. **Add a fixture test.** Put a synthetic tree under `fixtures/trees/` (or a recorded vendor output under `fixtures/probes/`) and assert the matched paths, the tier, and the measured size. A rule without a test is not ready to merge.
6. **Run `pnpm test`.** Also run `pnpm lint`, which enforces the safety lint: `remove-path` and `remove-dir-contents` only at Tier 0/1, roots from the approved list, and no `action` on a Tier 3 rule.

Example shape:

```ts
export const derivedData: Rule = {
  schemaVersion: 1,
  id: 'xcode.derived-data',
  title: 'Xcode DerivedData',
  category: 'dev',
  tier: 0,
  requires: ['xcode'],
  roots: ['~/Library/Developer/Xcode/DerivedData'],
  matcher: { kind: 'path', path: '~/Library/Developer/Xcode/DerivedData' },
  action: 'remove-dir-contents',
  rationale: 'Build intermediates and indexes; Xcode rebuilds them from source.',
  regeneration: 'Rebuilt on the next build, locally, with no network.',
};
```

## Add an app profile

An app profile teaches macsweep which folders are an app's caches and which are its data. Profiles compile into rules (category `app`), so they go through the same roots, tiers, preflight, and journal as everything else.

Profiles live in `packages/core/src/apps/profiles/*.ts`. A profile lists exact cache subpaths with their tier and rationale, extra app-specific locations, the processes to check in preflight, and the sign-in and data folders that are **never** actionable. Profiles take precedence over the generic heuristic, and nothing outside the whitelisted cache folder names is ever actionable.

See "Apps: per-app cache cleaning" (PLAN §4.6) for the full location-classification table, and `docs/app-profiles.md` for the authoring guide.

## Safety review checklist

Every pull request that touches rules, profiles, safety, execution, or the server must answer these:

- [ ] Every new target is inside a narrow, declared `roots` allowlist.
- [ ] No `remove-path` or `remove-dir-contents` outside Tier 0/1; Tier 2 goes to Trash.
- [ ] Tier 3 rules have no `action`.
- [ ] No app profile marks a non-cache location (data, sign-in state, preferences) as Tier 0/1.
- [ ] `rationale` and `regeneration` are specific and honest about the cost.
- [ ] Preflight is declared for anything that must not run (app, Docker daemon, booted simulator).
- [ ] The change adds or updates a fixture test, and `pnpm test` passes.
- [ ] Nothing added imports or calls `http`, `https`, `net`, `dgram`, `undici`, `tls`, or `fetch` outside `packages/server` (loopback only).
- [ ] No shell is spawned: `execFile` with argv arrays only.

## Commit style

Use Conventional Commits, imperative mood, scoped to the package or area:

```
feat(rules): add xcode.derived-data
fix(safety): reject NFD path variants in the allowlist
docs: explain the Unmeasured bucket
```

Keep the subject under 72 characters, one logical change per commit, and explain _why_ in the body when the change is not obvious. Reference the rule id or issue in the body when relevant.
