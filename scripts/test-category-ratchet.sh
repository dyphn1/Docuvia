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
mkdir -p "$OUTPUT_DIR"

# Keep event/base resolution in one testable place. In particular, a depth-1 push checkout may
# not contain HEAD's parent; the resolver verifies the parent commit instead of leaking a literal
# "HEAD^1" token into ensure_ref() as an invalid fetch refspec.
REF_RESOLVER="$REPO_ROOT/scripts/test-category-ratchet-refs.sh"
if [ ! -f "$REF_RESOLVER" ]; then
  echo "ERROR: Missing required category ref resolver: $REF_RESOLVER" >&2
  exit 1
fi
# shellcheck source=./test-category-ratchet-refs.sh
source "$REF_RESOLVER"
resolve_test_category_refs "$REPO_ROOT"
HEAD_REF="$CATEGORY_RESOLVED_HEAD_REF"
BASE_REF="$CATEGORY_RESOLVED_BASE_REF"

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
