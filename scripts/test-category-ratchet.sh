#!/usr/bin/env bash
# Repository-level 5-category coverage-shape ratchet for issue #263.
#
# The existing repository is intentionally not required to reach 5/5 in one PR. Instead, CI
# re-scans the PR base and HEAD with the same scanner and fails only when FAIL_COUNT increases.
# This makes the baseline executable evidence rather than a manually copied historical number.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCANNER="$REPO_ROOT/.claude/skills/test-audit/scripts/category-scan.mjs"
SCANNER_TEST="$REPO_ROOT/.claude/skills/test-audit/scripts/category-scan.unit.test.mjs"
OUTPUT_DIR="${TEST_CATEGORY_OUTPUT_DIR:-$REPO_ROOT/.test-results/test-category}"
HEAD_REF="${CATEGORY_HEAD_REF:-}"
BASE_REF="${CATEGORY_BASE_REF:-}"

mkdir -p "$OUTPUT_DIR"

# Pull-request jobs normally check out GitHub's synthetic merge commit at depth 1. Scanning
# HEAD^1 in that shape is unreliable because the parent commits may not exist locally. Resolve
# the real PR branch/base from GitHub's standard environment variables when explicit refs were
# not supplied, then fetch either ref on demand below.
if [ -z "$HEAD_REF" ]; then
  if [ -n "${GITHUB_HEAD_REF:-}" ]; then
    HEAD_REF="origin/${GITHUB_HEAD_REF}"
  else
    HEAD_REF="HEAD"
  fi
fi

if [ -z "$BASE_REF" ] || [ "$BASE_REF" = "0000000000000000000000000000000000000000" ]; then
  if [ -n "${GITHUB_BASE_REF:-}" ]; then
    BASE_REF="origin/${GITHUB_BASE_REF}"
  else
    BASE_REF="$(git -C "$REPO_ROOT" rev-parse "${HEAD_REF}^1" 2>/dev/null || true)"
  fi
fi

ensure_ref() {
  local ref="$1"
  if [ -z "$ref" ] || git -C "$REPO_ROOT" cat-file -e "${ref}^{commit}" 2>/dev/null; then
    return 0
  fi

  if [[ "$ref" == origin/* ]]; then
    local branch="${ref#origin/}"
    git -C "$REPO_ROOT" fetch --no-tags --depth=1 origin \
      "$branch:refs/remotes/origin/$branch"
  else
    git -C "$REPO_ROOT" fetch --no-tags --depth=1 origin "$ref"
  fi

  git -C "$REPO_ROOT" cat-file -e "${ref}^{commit}" 2>/dev/null
}

ensure_ref "$HEAD_REF"
if [ -n "$BASE_REF" ]; then
  ensure_ref "$BASE_REF"
fi

node --test "$SCANNER_TEST"

node "$SCANNER" \
  --root "$REPO_ROOT" \
  --ref "$HEAD_REF" \
  --json-out "$OUTPUT_DIR/head.json" \
  > "$OUTPUT_DIR/head.txt"

if [ -z "$BASE_REF" ]; then
  cat "$OUTPUT_DIR/head.txt"
  echo "CATEGORY_RATCHET=SKIPPED (no baseline ref available)"
  exit 0
fi

node "$SCANNER" \
  --root "$REPO_ROOT" \
  --ref "$BASE_REF" \
  --json-out "$OUTPUT_DIR/base.json" \
  > "$OUTPUT_DIR/base.txt"

read_json_number() {
  node -e 'const fs=require("fs"); const data=JSON.parse(fs.readFileSync(process.argv[1], "utf8")); console.log(data[process.argv[2]]);' "$1" "$2"
}

BASE_FAIL="$(read_json_number "$OUTPUT_DIR/base.json" failCount)"
HEAD_FAIL="$(read_json_number "$OUTPUT_DIR/head.json" failCount)"
BASE_FILES="$(read_json_number "$OUTPUT_DIR/base.json" filesScanned)"
HEAD_FILES="$(read_json_number "$OUTPUT_DIR/head.json" filesScanned)"

cat "$OUTPUT_DIR/head.txt"
echo "BASE_REF=$BASE_REF"
echo "HEAD_REF=$HEAD_REF"
echo "BASE_FAIL_COUNT=$BASE_FAIL"
echo "HEAD_FAIL_COUNT=$HEAD_FAIL"
echo "BASE_FILES_SCANNED=$BASE_FILES"
echo "HEAD_FILES_SCANNED=$HEAD_FILES"

if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "## Test category coverage ratchet"
    echo
    echo "| Metric | Base | Head |"
    echo "| --- | ---: | ---: |"
    echo "| Failing test files | $BASE_FAIL | $HEAD_FAIL |"
    echo "| Test files scanned | $BASE_FILES | $HEAD_FILES |"
    echo
    echo "Base: \`$BASE_REF\` · Head: \`$HEAD_REF\`"
    echo
    echo "The gate fails only when the failing-file count increases. Per-file machine-readable evidence is generated in .test-results/test-category/*.json."
  } >> "$GITHUB_STEP_SUMMARY"
fi

if [ "$HEAD_FAIL" -gt "$BASE_FAIL" ]; then
  echo "CATEGORY_RATCHET=FAILED: FAIL_COUNT increased from $BASE_FAIL to $HEAD_FAIL"
  exit 1
fi

if [ "$HEAD_FAIL" -lt "$BASE_FAIL" ]; then
  echo "CATEGORY_RATCHET=IMPROVED: FAIL_COUNT decreased from $BASE_FAIL to $HEAD_FAIL"
else
  echo "CATEGORY_RATCHET=PASSED: FAIL_COUNT unchanged at $HEAD_FAIL"
fi
