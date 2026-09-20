#!/bin/bash
# Render packaging/homebrew/diskwise.rb with a version and its tarball checksum
# and push it to the Homebrew tap as Formula/diskwise.rb. Idempotent: exits 0
# when the tap already has exactly this formula.
#
# Requires TAP_GITHUB_TOKEN (push access to the tap). TAP_REPOSITORY overrides
# the tap (default farhanlabib/homebrew-tap).
set -euo pipefail

usage() {
  echo "usage: $0 <version>   (X.Y.Z or vX.Y.Z)" >&2
  exit 1
}

[ "$#" -eq 1 ] || usage
VERSION="${1#v}"
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "error: invalid version '$1' (expected X.Y.Z or vX.Y.Z)" >&2
  exit 1
fi

TAP_REPOSITORY="${TAP_REPOSITORY:-farhanlabib/homebrew-tap}"
if [ -z "${TAP_GITHUB_TOKEN:-}" ]; then
  echo "error: TAP_GITHUB_TOKEN is not set; it needs push access to $TAP_REPOSITORY" >&2
  echo "See packaging/README.md for how to configure it." >&2
  exit 1
fi
export TAP_GITHUB_TOKEN

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FORMULA_TEMPLATE="$REPO_ROOT/packaging/homebrew/diskwise.rb"
for token in __VERSION__ __SHA256__; do
  grep -q "$token" "$FORMULA_TEMPLATE" || {
    echo "error: $FORMULA_TEMPLATE has no $token placeholder" >&2
    exit 1
  }
done

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

TARBALL_URL="https://github.com/farhanlabib/diskwise/archive/refs/tags/v${VERSION}.tar.gz"
echo "Downloading $TARBALL_URL"
curl -fsSL "$TARBALL_URL" -o "$WORK_DIR/source.tar.gz"
SHA256="$(shasum -a 256 "$WORK_DIR/source.tar.gz" | awk '{print $1}')"

echo "Cloning https://github.com/$TAP_REPOSITORY.git"
if ! git clone --depth 1 "https://github.com/${TAP_REPOSITORY}.git" "$WORK_DIR/tap"; then
  echo "error: cannot clone $TAP_REPOSITORY — create it first (see packaging/README.md)" >&2
  exit 1
fi

sed -e "s/__VERSION__/${VERSION}/g" -e "s/__SHA256__/${SHA256}/g" \
  "$FORMULA_TEMPLATE" > "$WORK_DIR/diskwise.rb"
if grep -q '__VERSION__\|__SHA256__' "$WORK_DIR/diskwise.rb"; then
  echo "error: rendering failed — a placeholder survived in the formula" >&2
  exit 1
fi

TAP_FORMULA="$WORK_DIR/tap/Formula/diskwise.rb"
if [ -f "$TAP_FORMULA" ] && cmp -s "$WORK_DIR/diskwise.rb" "$TAP_FORMULA"; then
  echo "$TAP_REPOSITORY already has diskwise $VERSION; nothing to do"
  exit 0
fi

if command -v brew >/dev/null 2>&1; then
  echo "Running brew audit --strict"
  brew audit --strict --formula "$WORK_DIR/diskwise.rb"
else
  echo "note: brew not found; skipping brew audit --strict"
fi

mkdir -p "$WORK_DIR/tap/Formula"
cp "$WORK_DIR/diskwise.rb" "$TAP_FORMULA"

# Git has no identity in CI, and the token is supplied through a local
# credential helper so it never appears in the remote URL or push output.
git -C "$WORK_DIR/tap" config user.name "github-actions[bot]"
git -C "$WORK_DIR/tap" config user.email "github-actions[bot]@users.noreply.github.com"
cat > "$WORK_DIR/cred-helper.sh" <<'EOF'
#!/bin/sh
printf 'username=x-access-token\n'
printf 'password=%s\n' "$TAP_GITHUB_TOKEN"
EOF
chmod +x "$WORK_DIR/cred-helper.sh"
git -C "$WORK_DIR/tap" config credential.helper "$WORK_DIR/cred-helper.sh"

git -C "$WORK_DIR/tap" add Formula/diskwise.rb
if git -C "$WORK_DIR/tap" diff --cached --quiet; then
  echo "$TAP_REPOSITORY already has diskwise $VERSION; nothing to do"
  exit 0
fi

# An empty tap has no HEAD yet; commit on main so the first push creates it.
if git -C "$WORK_DIR/tap" rev-parse --verify -q HEAD >/dev/null; then
  BRANCH="$(git -C "$WORK_DIR/tap" symbolic-ref --short HEAD)"
else
  BRANCH=main
  git -C "$WORK_DIR/tap" checkout -B main
fi

git -C "$WORK_DIR/tap" commit -m "diskwise $VERSION"
git -C "$WORK_DIR/tap" push origin "HEAD:${BRANCH}"
echo "Updated $TAP_REPOSITORY Formula/diskwise.rb to $VERSION on $BRANCH"
