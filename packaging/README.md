# Packaging

Release artifacts that do **not** require an Apple Developer account: no Developer ID, no notarization, no `.app`.

- `homebrew/diskwise.rb` — the Homebrew formula, built from source. It is a **template**: `__VERSION__` and `__SHA256__` are placeholders that `scripts/update-homebrew-tap.sh` fills in when it pushes the formula to the tap, so never copy this file to the tap without replacing them.

## The release chain

```
merge to main ───> CI (.github/workflows/ci.yml) — builds and tests, publishes nothing

Prepare release (.github/workflows/release-prepare.yml, run by hand)
    bumps packages/cli/package.json and packages/cli/src/version.ts on a
    release/vX.Y.Z branch and opens the "chore(release): vX.Y.Z" pull request
    (refuses to run if the tag or the branch already exists)
        │
        ▼
merge the pull request ───> Release (.github/workflows/release.yml, on push to main)
    sees packages/cli's version has no matching vX.Y.Z tag yet, builds, tests,
    smoke-tests the tarball, then in the same run:
    1. publishes to npm (--provenance --access public)
    2. creates the vX.Y.Z tag and the GitHub release with the helper checksum
    3. updates the tap via scripts/update-homebrew-tap.sh: downloads the tag
       tarball, renders packaging/homebrew/diskwise.rb with its version and
       sha256, runs brew audit --strict when brew is available, commits
       "diskwise X.Y.Z" and pushes Formula/diskwise.rb

A merge to main without a version bump finds the tag already present and does
nothing ("nothing to release"). Pushing a vX.Y.Z tag by hand triggers the same
Release workflow (it then verifies the tag matches packages/cli's version).
```

After the Release workflow finishes, `brew install farhanlabib/tap/diskwise` installs the new version with a real checksum.

## One-time setup

1. Create the tap repository. It can start empty — the first release seeds `Formula/diskwise.rb` and `main`:

   ```sh
   gh repo create farhanlabib/homebrew-tap --public
   ```

2. Add two repository secrets (Settings → Secrets and variables → Actions → Repository secrets):

   - `NPM_TOKEN` — an npm publish token for `diskwise`.
   - `TAP_GITHUB_TOKEN` — a token with **Contents: read and write** on `farhanlabib/homebrew-tap`. The built-in `GITHUB_TOKEN` cannot push to a different repository, so this must be a personal access token (fine-grained, limited to the tap repository).

   Optionally set the repository variable `TAP_REPOSITORY` to publish the formula to a tap other than `farhanlabib/homebrew-tap`.

## Cutting a release

Either:

- Run **Prepare release** (Actions tab → Prepare release → Run workflow) with `major`, `minor`, `patch`, or an explicit `X.Y.Z`. It opens a `chore(release): vX.Y.Z` pull request; merging that pull request into `main` publishes the version, creates the tag and GitHub release, and updates the tap.
- Or do the same by hand: bump `version` in `packages/cli/package.json` and `VERSION` in `packages/cli/src/version.ts`, open a `chore(release): vX.Y.Z` pull request, and merge it — the merge is what publishes. Pushing a `vX.Y.Z` tag by hand also still works.

If `TAP_GITHUB_TOKEN` is missing, the release still succeeds but the tap update is skipped with a warning. Recover by running `TAP_GITHUB_TOKEN=... scripts/update-homebrew-tap.sh vX.Y.Z` locally once the secret is in place, or by hand (see the fallback below).

## Manual tap update (fallback)

Only needed when the automation is broken. If the tap is still empty, create `Formula/diskwise.rb` in it from `packaging/homebrew/diskwise.rb` first. Then each release needs two edits to that file — the same two placeholders the script fills in:

1. **`url`** — point at the new tag tarball:

   ```ruby
   url "https://github.com/farhanlabib/diskwise/archive/refs/tags/v0.1.0.tar.gz"
   ```

2. **`sha256`** — replace the `__SHA256__` placeholder with the checksum of that exact tarball:

   ```sh
   curl -L https://github.com/farhanlabib/diskwise/archive/refs/tags/v0.1.0.tar.gz -o diskwise.tar.gz
   shasum -a 256 diskwise.tar.gz
   ```

   Paste the resulting hash into the formula. `brew audit --strict --formula Formula/diskwise.rb` catches a stale or malformed checksum before users see it.

Verify locally before pushing:

```sh
brew install --build-from-source Formula/diskwise.rb
brew test diskwise
```

## Why the build is from source

The formula compiles the Swift helper and the UI/CLI on the user's machine rather than downloading a prebuilt binary. Two consequences:

- **Nothing is quarantined.** Files that Homebrew and npm install are not given the `com.apple.quarantine` attribute, so Gatekeeper never runs the "downloaded from the internet" prompt on the helper or the CLI. Ad-hoc signing (`codesign -s -`, done by `build.sh`) is enough for arm64 and for a stable TCC identity; it never needs a paid certificate.
- **Reproducible by anyone.** Every artifact is buildable with free tools (Node + Xcode Command Line Tools), so a user can rebuild and compare without trusting our binary.

`pnpm` and Xcode are build-only dependencies, so they are not installed for users who already have the built formula.
