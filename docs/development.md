# Development

How to get a change into diskwise. For what to build — cleanup rules, app profiles, the safety model — see [CONTRIBUTING.md](../CONTRIBUTING.md).

## Prerequisites

- macOS. The test suite depends on APFS, macOS tools (`plutil`, `mdls`, `codesign`) and the macOS path layout; it does not run on Linux or Windows.
- Node.js 22 or newer.
- pnpm (`corepack enable`).
- The GitHub CLI (`gh`) if you want to watch CI from the terminal.

## Setup

```sh
git clone https://github.com/farhanlabib/diskwise.git
cd diskwise
pnpm install
pnpm test
packages/native-helper/build.sh     # macOS only: builds the ad-hoc-signed Swift helper
```

## Branch and commit

Branch from `main`, named after the change:

```sh
git checkout -b feat/rules-gradle
```

Use Conventional Commits, one logical change per commit, e.g. `feat(rules): add gradle.caches`. The full commit style is in [CONTRIBUTING.md](../CONTRIBUTING.md).

Do not rewrite the tracked reference screenshots or snapshots as a side effect of running tests. If `pnpm test` touched files under `fixtures/` or the e2e snapshots, restore them before committing — reference data changes only in a change that is explicitly about updating it.

## Before you open a PR

```sh
pnpm lint
pnpm typecheck
pnpm test
```

CI runs the same checks on every PR: lint and typecheck, then the test suite, native helper build, UI and CLI builds, a packed-tarball smoke test, and e2e on macOS (Node 22 and 24). If it fails locally it fails CI.

## Open a PR

1. Push your branch and open a pull request against `main` — with `gh pr create` or from https://github.com/farhanlabib/diskwise/compare.
2. Fill in the PR template: what changed, why, how it was tested, and the checklist. PRs touching rules, profiles, safety, execution, or the server must also answer the safety review checklist in CONTRIBUTING.md.
3. Keep it to one logical change. A PR that mixes a new rule with an unrelated refactor is harder to review and gets held back.

Review is requested automatically from the maintainer via CODEOWNERS. Respond to review comments in the PR, not in a new issue.

## How a PR gets merged

- `main` is protected: no direct pushes, at least one approving review, all required checks green, conversations resolved, linear history.
- PRs are squash-merged; the branch is deleted on merge.
- The squash commit message is the PR title and body, so make the PR title a good Conventional Commit subject.

## Maintainers: repository settings

`scripts/setup-github.sh` applies the settings described above (squash merges only, delete branch on merge, branch protection on `main` with the required checks). Run it once after creating the repository and re-run it to repair drift; `--dry-run` prints the `gh api` calls without applying them.

## Maintainers: cutting a release

Merging a version bump to `main` is what publishes. Run the **Prepare release** workflow (`.github/workflows/release-prepare.yml`) with `patch`, `minor`, `major`, or an explicit `X.Y.Z` — it opens a `chore(release): vX.Y.Z` pull request that bumps `packages/cli/package.json` and `packages/cli/src/version.ts`. Merging that PR runs `.github/workflows/release.yml`, which publishes to npm, creates the tag and GitHub release, and updates the Homebrew tap. Any other merge to `main` publishes nothing, and pushing a `vX.Y.Z` tag by hand still releases that version.

The bump pull request is opened with the workflow token, so CI does not run on it and the required checks never report; merge it with the admin bypass that `enforce_admins: false` allows.

A release needs npm credentials — the `NPM_TOKEN` secret, or npm trusted publishing configured for this repository — and `TAP_GITHUB_TOKEN` for the tap. Without npm credentials the Release workflow stops within seconds and says so. The one-time setup is in [packaging/README.md](../packaging/README.md).
