#!/usr/bin/env bash
# test-quality-gate.sh — Quantified test quality gate for CI
#
# Axis 2 counts weak assertions that pass even when code is wrong.
# Axis 1 delegates to the #263 functional-category ratchet after Axis 2 passes.
#
# Exit codes:
#   0 — quality gates passed
#   1 — a quality gate failed

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# ─── Weak assertion patterns ────────────────────────────────────────────
# P0: toBeDefined/Undefined without verifying content — data can be wrong
# P1: toBeTruthy/Falsy — coerces to boolean, loses type info
# P2: toBeGreaterThan(0) — only proves positive, not the actual value

WEAK_PATTERNS="toBeDefined\(\)|toBeUndefined\(\)|toBeTruthy\(\)|toBeFalsy\(\)|toBeGreaterThan\(0\)"

# ─── Prefer rg (ripgrep) when available; fall back to grep ──────────────
# `-c` (count mode) prints one "path:count" line per matching file, which is what both the
# totals and the per-file breakdown below need.
if command -v rg >/dev/null 2>&1; then
  SEARCH_CMD=(rg -c --type ts -g '*.test.ts')
  REGEX_FLAG=(-e)
else
  SEARCH_CMD=(grep -rc --include='*.test.ts')
  REGEX_FLAG=(-E)
fi

# ─── Sum the counts out of "path:count" lines ────────────────────────────
# On Windows, `path` itself can contain a colon (the drive letter), so the count is always read
# from the LAST field rather than assuming the first colon separates path and count.
sum_counts() {
  awk -F: '{ n = $NF; if (n ~ /^[0-9]+$/) total += n } END { print total + 0 }'
}

# ─── Count weak assertions across all test files ────────────────────────
# Both rg and grep return exit code 1 when there are no matches. Under
# set -euo pipefail this would abort the script before we can report 0,
# so we append || true to swallow the non-zero exit.
WEAK_COUNT=$("${SEARCH_CMD[@]}" "${REGEX_FLAG[@]}" "$WEAK_PATTERNS" "$REPO_ROOT" 2>/dev/null \
  | sum_counts || true)
WEAK_COUNT=${WEAK_COUNT:-0}

# ─── Count total assertions (approximate: expect( calls) ────────────────
TOTAL_ASSERTIONS=$("${SEARCH_CMD[@]}" "${REGEX_FLAG[@]}" "expect\(" "$REPO_ROOT" 2>/dev/null \
  | sum_counts || true)
TOTAL_ASSERTIONS=${TOTAL_ASSERTIONS:-0}

# ─── Compute ratio ──────────────────────────────────────────────────────
if [ "$TOTAL_ASSERTIONS" -gt 0 ]; then
  RATIO=$(awk "BEGIN {printf \"%.1f\", $WEAK_COUNT * 100 / $TOTAL_ASSERTIONS}")
else
  RATIO="0.0"
fi

# ─── Per-file breakdown (top 15 offenders) ─────────────────────────────
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║              TEST QUALITY GATE — AXIS 2                     ║"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║  Weak assertions:     $WEAK_COUNT / $TOTAL_ASSERTIONS total (${RATIO}%)"
echo "║  Threshold:           220 (static ceiling — lower it as the count drops)"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║  Top offenders (weak assertion count per file):"
"${SEARCH_CMD[@]}" "${REGEX_FLAG[@]}" "$WEAK_PATTERNS" "$REPO_ROOT" 2>/dev/null \
  | awk -F: '{
      n = $NF;
      if (n !~ /^[0-9]+$/) next;
      file = $0;
      sub(/:[0-9]+$/, "", file);
      print n":"file;
    }' \
  | sort -t: -k1 -rn \
  | head -15 \
  | while IFS=: read -r count file; do
      printf "║    %4s  %s\n" "$count" "${file#$REPO_ROOT/}"
    done || true
echo "╠══════════════════════════════════════════════════════════════╣"

# ─── Axis 2 threshold check ─────────────────────────────────────────────
THRESHOLD=220

if [ "$WEAK_COUNT" -gt "$THRESHOLD" ]; then
  echo "║  ❌ FAILED — $WEAK_COUNT weak assertions (>$THRESHOLD)"
  echo "║"
  echo "║  To fix: replace weak assertions with content-verifying ones:"
  echo "║    toBeDefined()      → toEqual(expectedValue)"
  echo "║    toBeUndefined()    → not.toHaveProperty('key') or toBeNull()"
  echo "║    toBeTruthy()       → toBe(true) or toEqual(expected)"
  echo "║    toBeFalsy()        → toBe(false) or toBeNull()"
  echo "║    toBeGreaterThan(0) → toBe(n) or toHaveLength(n)"
  echo "╚══════════════════════════════════════════════════════════════╝"
  exit 1
fi

echo "║  ✅ PASSED — $WEAK_COUNT weak assertions (≤ $THRESHOLD)"
echo "╚══════════════════════════════════════════════════════════════╝"
echo

# ─── Axis 1 category coverage ratchet (#263) ───────────────────────────
# Recompute base and HEAD every run; never trust the historical FAIL_COUNT=203 claim as a static
# baseline. The ratchet allows existing debt to remain temporarily but rejects any increase.
bash "$REPO_ROOT/scripts/test-category-ratchet.sh"
