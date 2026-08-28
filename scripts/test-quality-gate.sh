#!/usr/bin/env bash
# test-quality-gate.sh — Quantified test quality gate for CI
#
# Counts weak assertion patterns that pass even when code is wrong.
# Fails the build when the count exceeds the allowed baseline.
#
# Exit codes:
#   0 — quality gate passed
#   1 — quality gate failed (too many weak assertions)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# ─── Weak assertion patterns ────────────────────────────────────────────
# P0: toBeDefined/Undefined without verifying content — data can be wrong
# P1: toBeTruthy/Falsy — coerces to boolean, loses type info
# P2: toBeGreaterThan(0) — only proves positive, not the actual value

WEAK_PATTERNS="toBeDefined\(\)|toBeUndefined\(\)|toBeTruthy\(\)|toBeFalsy\(\)|toBeGreaterThan\(0\)"

# ─── Prefer rg (ripgrep) when available; fall back to grep ──────────────
if command -v rg >/dev/null 2>&1; then
  SEARCH_CMD=(rg --no-heading -n --type ts -g '*.test.ts')
  REGEX_FLAG=(-e)
else
  SEARCH_CMD=(grep -rn --include='*.test.ts')
  REGEX_FLAG=(-E)
fi

# ─── Count weak assertions across all test files ────────────────────────
# Both rg and grep return exit code 1 when there are no matches. Under
# set -euo pipefail this would abort the script before awk can print 0,
# so we append || true to swallow the non-zero exit.
WEAK_COUNT=$("${SEARCH_CMD[@]}" "${REGEX_FLAG[@]}" "$WEAK_PATTERNS" "$REPO_ROOT" 2>/dev/null \
  | awk -F: '{count[$1]++} END {total=0; for(f in count) total+=count[f]; print total}' || true)
WEAK_COUNT=${WEAK_COUNT:-0}

# ─── Count total assertions (approximate: expect( calls) ────────────────
TOTAL_ASSERTIONS=$("${SEARCH_CMD[@]}" "${REGEX_FLAG[@]}" "expect\(" "$REPO_ROOT" 2>/dev/null \
  | awk -F: '{count[$1]++} END {total=0; for(f in count) total+=count[f]; print total}' || true)
TOTAL_ASSERTIONS=${TOTAL_ASSERTIONS:-0}

# ─── Compute ratio ──────────────────────────────────────────────────────
if [ "$TOTAL_ASSERTIONS" -gt 0 ]; then
  RATIO=$(awk "BEGIN {printf \"%.1f\", $WEAK_COUNT * 100 / $TOTAL_ASSERTIONS}")
else
  RATIO="0.0"
fi

# ─── Per-file breakdown (top 10 offenders) ─────────────────────────────
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║              TEST QUALITY GATE                              ║"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║  Weak assertions:     $WEAK_COUNT / $TOTAL_ASSERTIONS total (${RATIO}%)"
echo "║  Threshold:           220 (must decrease, never increase)"
echo "╠══════════════════════════════════════════════════════════════╣"
echo "║  Top offenders (weak assertion count per file):"
"${SEARCH_CMD[@]}" "${REGEX_FLAG[@]}" "$WEAK_PATTERNS" "$REPO_ROOT" 2>/dev/null \
  | awk -F: '{count[$1]++} END {for(f in count) print count[f]":"f}' \
  | sort -t: -k1 -rn \
  | head -15 \
  | while IFS=: read -r count file; do
      printf "║    %4s  %s\n" "$count" "${file#$REPO_ROOT/}"
    done || true
echo "╠══════════════════════════════════════════════════════════════╣"

# ─── Threshold check ────────────────────────────────────────────────────
THRESHOLD=220

if [ "$WEAK_COUNT" -le "$THRESHOLD" ]; then
  echo "║  ✅ PASSED — $WEAK_COUNT weak assertions (≤ $THRESHOLD)"
  echo "╚══════════════════════════════════════════════════════════════╝"
  exit 0
else
  echo "║  ❌ FAILED — $WEAK_COUNT weak assertions (>$THRESHOLD)"
  echo "║"
  echo "║  To fix: replace weak assertions with content-verifying ones:"
  echo "║    toBeDefined()    → toEqual(expectedValue)"
  echo "║    toBeUndefined()  → not.toHaveProperty('key') or toBeNull()"
  echo "║    toBeTruthy()     → toBe(true) or toEqual(expected)"
  echo "║    toBeFalsy()      → toBe(false) or toBeNull()"
  echo "║    toBeGreaterThan(0) → toBe(n) or toHaveLength(n)"
  echo "║"
  echo "║  Run: grep -rn \"$WEAK_PATTERNS\" --include='*.test.ts' to find them"
  echo "╚══════════════════════════════════════════════════════════════╝"
  exit 1
fi
