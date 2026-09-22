#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=./test-category-ratchet-refs.sh
source "$REPO_ROOT/scripts/test-category-ratchet-refs.sh"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_eq() {
  local expected="$1"
  local actual="$2"
  local message="$3"
  if [ "$expected" != "$actual" ]; then
    fail "$message (expected='$expected', actual='$actual')"
  fi
}

TMP_REPO="$(mktemp -d)"
trap 'rm -rf "$TMP_REPO"' EXIT

git -C "$TMP_REPO" init -q
git -C "$TMP_REPO" config user.name "Docuvia CI"
git -C "$TMP_REPO" config user.email "ci@example.invalid"
printf 'fixture\n' > "$TMP_REPO/fixture.txt"
git -C "$TMP_REPO" add fixture.txt
git -C "$TMP_REPO" commit -q -m "fixture"

# Regression: a depth-1 main checkout has HEAD but not its parent. In that shape
# the resolver must not return the literal token HEAD^1 as a fetchable refspec.
unset CATEGORY_HEAD_REF CATEGORY_BASE_REF GITHUB_HEAD_REF GITHUB_BASE_REF
resolve_test_category_refs "$TMP_REPO"
assert_eq "HEAD" "$CATEGORY_RESOLVED_HEAD_REF" "default head ref"
assert_eq "" "$CATEGORY_RESOLVED_BASE_REF" "missing parent must resolve to an empty baseline"

# CI-provided event SHAs are authoritative and must not be replaced by local-history guesses.
CATEGORY_HEAD_REF="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
CATEGORY_BASE_REF="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
resolve_test_category_refs "$TMP_REPO"
assert_eq "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" "$CATEGORY_RESOLVED_HEAD_REF" "explicit head SHA"
assert_eq "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" "$CATEGORY_RESOLVED_BASE_REF" "explicit base SHA"

# PR fallback still resolves to the remote PR branches when explicit SHA inputs are absent.
unset CATEGORY_HEAD_REF CATEGORY_BASE_REF
GITHUB_HEAD_REF="feature/test-ratchet"
GITHUB_BASE_REF="main"
resolve_test_category_refs "$TMP_REPO"
assert_eq "origin/feature/test-ratchet" "$CATEGORY_RESOLVED_HEAD_REF" "PR head fallback"
assert_eq "origin/main" "$CATEGORY_RESOLVED_BASE_REF" "PR base fallback"

# GitHub uses an all-zero before SHA for branch creation. Treat it as unavailable rather
# than trying to fetch it or infer an unresolved symbolic parent.
CATEGORY_HEAD_REF="HEAD"
CATEGORY_BASE_REF="0000000000000000000000000000000000000000"
unset GITHUB_HEAD_REF GITHUB_BASE_REF
resolve_test_category_refs "$TMP_REPO"
assert_eq "" "$CATEGORY_RESOLVED_BASE_REF" "zero before SHA must degrade safely"

echo "test-category-ratchet ref resolution: PASS"
