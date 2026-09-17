# Packaging

Release artifacts that do **not** require an Apple Developer account: no Developer ID, no notarization, no `.app`.

- `homebrew/diskwise.rb` — the Homebrew formula, built from source.

## Homebrew tap

The formula lives in this repo for reference. To ship it, create a tap repository named `homebrew-tap` under the same owner:

```sh
gh repo create farhanlabib/homebrew-tap --public
```

Then copy the formula into it at `Formula/diskwise.rb`:

```sh
mkdir -p /tmp/homebrew-tap/Formula
cp packaging/homebrew/diskwise.rb /tmp/homebrew-tap/Formula/diskwise.rb
cd /tmp/homebrew-tap
git init && git add Formula/diskwise.rb
git commit -m "diskwise 0.1.0"
git remote add origin git@github.com:farhanlabib/homebrew-tap.git
git push -u origin main
```

Users then install with:

```sh
brew install farhanlabib/tap/diskwise
```

## Updating for a release

Each release needs two edits to `Formula/diskwise.rb` in the tap:

1. **`url`** — point at the new tag tarball:

   ```ruby
   url "https://github.com/farhanlabib/diskwise/archive/refs/tags/v0.1.0.tar.gz"
   ```

2. **`sha256`** — replace the 64-zero placeholder with the checksum of that exact tarball:

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
