#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

# A universal binary is the goal; if the toolchain cannot produce one, fall back
# to the host architecture so the helper still builds locally.
ARCH_FLAGS=(--arch arm64 --arch x86_64)
if ! swift build -c release "${ARCH_FLAGS[@]}"; then
  echo "warning: universal build failed; falling back to host architecture" >&2
  ARCH_FLAGS=()
  swift build -c release
fi

BIN_DIR="$(swift build -c release "${ARCH_FLAGS[@]}" --show-bin-path)"
mkdir -p bin
cp "$BIN_DIR/diskwise-helper" bin/diskwise-helper

# Ad-hoc signature: no Developer ID and no notarization are needed for a binary
# that is shipped inside an npm package or Homebrew formula (those are not
# quarantined by Gatekeeper). It also gives the binary a stable code identity
# for macOS privacy (TCC) prompts.
codesign --force -s - bin/diskwise-helper
codesign -dv bin/diskwise-helper 2>&1

echo "built bin/diskwise-helper"
