#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

# Universal (arm64 + x86_64) is mandatory for every build. The only way to get a
# host-only binary is DISKWISE_HELPER_DEV=1, for local development on a machine
# whose toolchain cannot cross-compile. A release must never silently ship a
# single-architecture helper.
RELEASE="${DISKWISE_HELPER_RELEASE:-0}"
DEV="${DISKWISE_HELPER_DEV:-0}"

if [[ "$RELEASE" == "1" && "$DEV" == "1" ]]; then
  echo "error: DISKWISE_HELPER_RELEASE and DISKWISE_HELPER_DEV are mutually exclusive" >&2
  exit 1
fi

# A hung Swift/Xcode toolchain must fail loudly instead of stalling CI forever.
SWIFT_BUILD_TIMEOUT="${SWIFT_BUILD_TIMEOUT:-900}"

run_with_timeout() {
  if command -v timeout >/dev/null 2>&1; then
    timeout "$SWIFT_BUILD_TIMEOUT" "$@"
  else
    # macOS ships no GNU timeout; perl's alarm survives exec.
    perl -e 'alarm shift; exec @ARGV or die "exec failed\n"' "$SWIFT_BUILD_TIMEOUT" "$@"
  fi
}

toolchain_diagnostics() {
  {
    echo "Swift build failed or timed out after ${SWIFT_BUILD_TIMEOUT}s. Toolchain diagnostics:"
    xcode-select -p 2>&1 || true
    swift --version 2>&1 || true
    xcodebuild -version 2>&1 || true
    ls /Applications 2>/dev/null | grep -i xcode || true
  } >&2
}

build_universal() {
  # Called in a conditional context, so set -e is suspended here: each step
  # short-circuits explicitly to keep the first real failure visible.
  run_with_timeout swift build -c release --arch arm64 || return 1
  run_with_timeout swift build -c release --arch x86_64 || return 1
  local arm_bin x86_bin
  arm_bin="$(swift build -c release --arch arm64 --show-bin-path)/diskwise-helper" || return 1
  x86_bin="$(swift build -c release --arch x86_64 --show-bin-path)/diskwise-helper" || return 1
  lipo -create "$arm_bin" "$x86_bin" -output bin/diskwise-helper || return 1
}

mkdir -p bin

if [[ "$DEV" == "1" ]]; then
  if ! run_with_timeout swift build -c release; then
    toolchain_diagnostics
    exit 1
  fi
  cp "$(swift build -c release --show-bin-path)/diskwise-helper" bin/diskwise-helper
else
  if ! build_universal; then
    toolchain_diagnostics
    echo "error: universal (arm64 + x86_64) build failed; set DISKWISE_HELPER_DEV=1 for a host-only local build" >&2
    exit 1
  fi
fi

archs="$(lipo -archs bin/diskwise-helper)"
echo "helper architectures: $archs"
if [[ "$DEV" != "1" ]]; then
  echo "$archs" | grep -qw arm64 || { echo "error: arm64 slice missing from bin/diskwise-helper" >&2; exit 1; }
  echo "$archs" | grep -qw x86_64 || { echo "error: x86_64 slice missing from bin/diskwise-helper" >&2; exit 1; }
fi

# Ad-hoc signature: no Developer ID and no notarization are needed for a binary
# that is shipped inside an npm package or Homebrew formula (those are not
# quarantined by Gatekeeper). It also gives the binary a stable code identity
# for macOS privacy (TCC) prompts.
codesign --force -s - bin/diskwise-helper
codesign -dv bin/diskwise-helper 2>&1

echo "built bin/diskwise-helper"
