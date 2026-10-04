#!/usr/bin/env bash
# Emit path:count rows for matching tracked project test files.
set -euo pipefail

BACKEND="${1:?expected rg or grep}"
PATTERN="${2:?expected an extended regular expression}"
REPO_ROOT="${3:?expected repository root}"

if ! git -C "$REPO_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "not a git worktree: $REPO_ROOT" >&2
  exit 2
fi

TRACKED_TEST_FILES="$(mktemp)"
trap 'rm -f "$TRACKED_TEST_FILES"' EXIT

while IFS= read -r -d '' relative_path; do
  case "/$relative_path/" in
    */node_modules/*) continue ;;
  esac
  [[ -f "$REPO_ROOT/$relative_path" ]] || continue
  printf '%s\0' "$relative_path" >> "$TRACKED_TEST_FILES"
done < <(git -C "$REPO_ROOT" ls-files -z -- '*.test.ts')

[[ -s "$TRACKED_TEST_FILES" ]] || exit 0

cd "$REPO_ROOT"
case "$BACKEND" in
  rg)
    xargs -0 rg --with-filename -c -- "$PATTERN" < "$TRACKED_TEST_FILES" || true
    ;;
  grep)
    xargs -0 grep -HcE -- "$PATTERN" < "$TRACKED_TEST_FILES" || true
    ;;
  *)
    echo "unsupported scanner backend: $BACKEND" >&2
    exit 2
    ;;
esac
