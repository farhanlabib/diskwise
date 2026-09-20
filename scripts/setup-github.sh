#!/usr/bin/env bash
# setup-github.sh — apply diskwise repository settings and branch protection on main.
#
# Usage: scripts/setup-github.sh [--dry-run]
#
# Requires the GitHub CLI (`gh`), installed and authenticated with admin access to
# the repository. Overrides the repo slug with DISKWISE_REPO=<owner>/<name>.
#
# Applies:
#   - squash merges only, delete branch on merge
#   - branch protection on main: no direct pushes, required pull request review,
#     required status checks (Lint and typecheck, macOS (Node 22), macOS (Node 24)),
#     linear history, required conversation resolution
#
# Re-runnable: reads the current state first and skips what already matches.

set -euo pipefail

REPO="${DISKWISE_REPO:-farhanlabib/diskwise}"
DRY_RUN=false
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    *) echo "Unknown argument: $arg (supported: --dry-run)" >&2; exit 2 ;;
  esac
done

if ! command -v gh >/dev/null 2>&1; then
  echo "error: gh is not installed. Install it from https://cli.github.com/ and re-run." >&2
  exit 1
fi
if ! gh auth status >/dev/null 2>&1; then
  echo "error: gh is not authenticated. Run 'gh auth login' and re-run." >&2
  exit 1
fi

if $DRY_RUN; then
  run() { echo "+ $*"; }
else
  run() { "$@"; }
fi

echo "Repository settings for $REPO"
current="$(gh api "repos/$REPO" --jq '[.allow_squash_merge, .allow_merge_commit, .allow_rebase_merge, .delete_branch_on_merge] | @tsv' 2>/dev/null || true)"
if [ -z "$current" ]; then
  echo "error: cannot read $REPO. Does it exist, and does the authenticated user have admin access?" >&2
  exit 1
fi
if [ "$current" = "$(printf 'true\tfalse\tfalse\ttrue')" ]; then
  echo "  ok: squash merges only, delete branch on merge (already set)"
else
  echo "  change: squash merges only, delete branch on merge"
  run gh api -X PATCH "repos/$REPO" --input - <<'JSON'
{"allow_squash_merge": true, "allow_merge_commit": false, "allow_rebase_merge": false, "delete_branch_on_merge": true}
JSON
fi

echo "Branch protection on main"
# Check-run names as CI reports them (job names, matrix expanded).
checks='["Lint and typecheck","macOS (Node 22)","macOS (Node 24)"]'
matches="$(gh api "repos/$REPO/branches/main/protection" --jq "
  [ ((.required_status_checks.contexts // []) | sort) == ($checks | sort),
    (.required_status_checks.strict // false),
    (.required_pull_request_reviews.required_approving_review_count // 0) == 1,
    (.required_pull_request_reviews.dismiss_stale_reviews // false),
    (.required_pull_request_reviews.require_code_owner_reviews // false),
    (.required_linear_history // false),
    (.required_conversation_resolution // false),
    ((.allow_force_pushes.enabled // false) | not),
    ((.allow_deletions.enabled // false) | not) ] | all" 2>/dev/null || echo no-protection)"
if [ "$matches" = "true" ]; then
  echo "  ok: main is protected as required (already set)"
else
  echo "  change: applying branch protection on main"
  body="{
  \"required_status_checks\": {\"strict\": true, \"contexts\": $checks},
  \"required_pull_request_reviews\": {\"required_approving_review_count\": 1, \"dismiss_stale_reviews\": true, \"require_code_owner_reviews\": true},
  \"restrictions\": null,
  \"enforce_admins\": false,
  \"required_linear_history\": true,
  \"required_conversation_resolution\": true,
  \"allow_force_pushes\": false,
  \"allow_deletions\": false
}"
  if $DRY_RUN; then
    echo "+ gh api -X PUT repos/$REPO/branches/main/protection --input -"
    echo "$body"
  else
    gh api -X PUT "repos/$REPO/branches/main/protection" --input - <<<"$body" >/dev/null
    echo "  done: main is protected"
  fi
fi

echo "Done: $REPO is configured."
