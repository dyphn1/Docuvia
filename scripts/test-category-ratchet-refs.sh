#!/usr/bin/env bash
# Shared ref resolution for the test-category ratchet.
#
# Outputs are intentionally written to global variables for the sourcing caller:
#   CATEGORY_RESOLVED_HEAD_REF
#   CATEGORY_RESOLVED_BASE_REF
#
# Explicit CATEGORY_* refs win. PR branch fallbacks are next. Only when neither
# source provides a base do we inspect the local parent, and that lookup must
# verify to a real commit so a symbolic token such as HEAD^1 never escapes as a
# later git-fetch refspec. GitHub branch fallbacks intentionally use the
# actions/checkout "origin" remote; non-GitHub callers should pass explicit CATEGORY_* refs.

resolve_test_category_refs() {
  local repo_root="$1"
  local head_ref="${CATEGORY_HEAD_REF:-}"
  local base_ref="${CATEGORY_BASE_REF:-}"

  if [ -z "$head_ref" ]; then
    if [ -n "${GITHUB_HEAD_REF:-}" ]; then
      head_ref="origin/${GITHUB_HEAD_REF}"
    else
      head_ref="HEAD"
    fi
  fi

  if [ -z "$base_ref" ] || [[ "$base_ref" =~ ^0+$ ]]; then
    if [ -n "${GITHUB_BASE_REF:-}" ]; then
      base_ref="origin/${GITHUB_BASE_REF}"
    else
      base_ref="$(git -C "$repo_root" rev-parse --verify "${head_ref}^1^{commit}" 2>/dev/null || true)"
    fi
  fi

  CATEGORY_RESOLVED_HEAD_REF="$head_ref"
  CATEGORY_RESOLVED_BASE_REF="$base_ref"
}
