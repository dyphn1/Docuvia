#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP_REPO="$(mktemp -d)"
trap 'rm -rf "$TMP_REPO"' EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_eq() {
  local expected="$1"
  local actual="$2"
  local message="$3"
  if [[ "$expected" != "$actual" ]]; then
    fail "$message (expected='$expected', actual='$actual')"
  fi
}

git -C "$TMP_REPO" init -q
git -C "$TMP_REPO" config user.name "Docuvia CI"
git -C "$TMP_REPO" config user.email "ci@example.invalid"
mkdir -p "$TMP_REPO/test" "$TMP_REPO/node_modules/.pnpm/zod@3.25.76/node_modules/zod/src/v4/mini/tests"
printf 'expect(value).toBeTruthy()\n' > "$TMP_REPO/test/tracked.test.ts"
printf 'expect(value).toBeTruthy()\n' > "$TMP_REPO/node_modules/.pnpm/zod@3.25.76/node_modules/zod/src/v4/mini/tests/object.test.ts"
git -C "$TMP_REPO" add test/tracked.test.ts
git -C "$TMP_REPO" add -f node_modules/.pnpm/zod@3.25.76/node_modules/zod/src/v4/mini/tests/object.test.ts
git -C "$TMP_REPO" commit -q -m "scanner fixture"

EXPECTED="test/tracked.test.ts:1"
for backend in grep rg; do
  if [[ "$backend" == rg ]] && ! command -v rg >/dev/null 2>&1; then
    echo "SKIP: rg is unavailable"
    continue
  fi
  ACTUAL="$(bash "$REPO_ROOT/scripts/test-quality-gate-scan.sh" "$backend" 'toBeTruthy\(\)' "$TMP_REPO")"
  assert_eq "$EXPECTED" "$ACTUAL" "$backend must count tracked project tests and exclude node_modules"
done

echo "test-quality-gate scanner scope: PASS (rg + grep fallback)"
