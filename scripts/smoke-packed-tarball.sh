#!/usr/bin/env bash
set -euo pipefail

# Pack the CLI, verify the helper inside the tarball, then install the tarball
# into a clean directory OUTSIDE the monorepo and smoke-test it. This validates
# the artifact users receive, not just the workspace copy.

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

version="$(node -p "require('./packages/cli/package.json').version")"
base_dir="${RUNNER_TEMP:-$(mktemp -d)}"
pack_dir="$base_dir/diskwise-pack"
extract_dir="$base_dir/diskwise-extract"
smoke_dir="$base_dir/diskwise-smoke"
rm -rf "$pack_dir" "$extract_dir" "$smoke_dir"
mkdir -p "$pack_dir" "$extract_dir" "$smoke_dir"

(cd packages/cli && npm pack --pack-destination "$pack_dir")
tarball="$pack_dir/diskwise-$version.tgz"
[ -f "$tarball" ] || { echo "error: expected tarball $tarball was not produced" >&2; exit 1; }

tar -xzf "$tarball" -C "$extract_dir"
packed_helper="$extract_dir/package/dist/diskwise-helper"
packed_ui="$extract_dir/package/dist/ui/index.html"
[ -f "$packed_helper" ] || { echo "error: tarball is missing dist/diskwise-helper" >&2; exit 1; }
[ -f "$packed_ui" ] || { echo "error: tarball is missing dist/ui/index.html" >&2; exit 1; }

# The helper inside the tarball is what users run: verify signature,
# architectures and checksum on it, not only on the dist copy.
archs="$(lipo -archs "$packed_helper")"
echo "packed helper architectures: $archs"
echo "$archs" | grep -qw arm64 || { echo "error: packed helper has no arm64 slice" >&2; exit 1; }
echo "$archs" | grep -qw x86_64 || { echo "error: packed helper has no x86_64 slice" >&2; exit 1; }
codesign -dv "$packed_helper" 2>&1 | grep -q 'Signature=adhoc' || {
  echo "error: packed helper is not ad-hoc signed" >&2
  exit 1
}
packed_sha="$(shasum -a 256 "$packed_helper" | awk '{print $1}')"
dist_sha="$(shasum -a 256 packages/cli/dist/diskwise-helper | awk '{print $1}')"
[ "$packed_sha" = "$dist_sha" ] || {
  echo "error: packed helper checksum $packed_sha differs from dist copy $dist_sha" >&2
  exit 1
}

(cd "$smoke_dir" && npm init -y >/dev/null && npm install "$tarball" >/dev/null)
diskwise="$smoke_dir/node_modules/.bin/diskwise"
[ -x "$diskwise" ] || { echo "error: diskwise binary was not installed" >&2; exit 1; }
"$diskwise" --version

with_timeout() {
  local secs="$1"; shift
  if command -v timeout >/dev/null 2>&1; then
    timeout "$secs" "$@"
  else
    # macOS ships no GNU timeout; perl's alarm survives exec.
    perl -e 'alarm shift; exec @ARGV or die "exec failed\n"' "$secs" "$@"
  fi
}

with_timeout 120 "$diskwise" doctor --json > "$smoke_dir/doctor.json"
node -e 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"))' "$smoke_dir/doctor.json"
grep -q '"path"' "$smoke_dir/doctor.json" || {
  echo "error: doctor did not find the packed native helper:" >&2
  cat "$smoke_dir/doctor.json" >&2 || true
  exit 1
}

with_timeout 600 "$diskwise" audit --json > "$smoke_dir/audit.json"
node -e 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"))' "$smoke_dir/audit.json"

"$diskwise" ui --no-open --port 0 > "$smoke_dir/ui.log" 2>&1 &
ui_pid=$!
url=""
for _ in $(seq 1 30); do
  url="$(grep -m1 -o 'http://[^[:space:]]*' "$smoke_dir/ui.log" || true)"
  [ -n "$url" ] && break
  kill -0 "$ui_pid" 2>/dev/null || break
  sleep 1
done
[ -n "$url" ] || { echo "error: ui never started:" >&2; cat "$smoke_dir/ui.log" >&2 || true; exit 1; }
base_url="${url%%#*}"
curl -fsS --retry 15 --retry-connrefused --retry-delay 1 --max-time 60 "$base_url" | grep -qi '<html' || {
  echo "error: ui server did not serve index.html from $base_url" >&2
  cat "$smoke_dir/ui.log" >&2 || true
  exit 1
}
kill "$ui_pid" 2>/dev/null || true
wait "$ui_pid" 2>/dev/null || true

echo "smoke test passed: diskwise@$version packed tarball installs and runs standalone"
