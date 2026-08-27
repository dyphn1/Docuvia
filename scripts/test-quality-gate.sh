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

# ─── Count weak assertions across all test files ────────────────────────
WEAK_COUNT=$(rg -c "$WEAK_PATTERNS" --type ts -g "*.test.ts" "$REPO_ROOT" 2>/dev/null \
  | awk -F: '{sum+=$2} END {print sum+0}')

# ─── Count total assertions (approximate: expect( calls) ────────────────
TOTAL_ASSERTIONS=$(rg -c "expect\(" --type ts -g "*.test.ts" "$REPO_ROOT" 2>/dev/null \
  | awk -F: '{sum+=$2} END {print sum+0}')

# ─── Compute ratio ──────────────────────────────────────────────────────
if [ "$TOTAL_ASSERTIONS" -gt 0 ]; then
  RATIO=$(echo "scale=1; $WEAK_COUNT * 100 / $TOTAL_ASSERTIONS" | bc)
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
rg -c "$WEAK_PATTERNS" --type ts -g "*.test.ts" "$REPO_ROOT" 2>/dev/null \
  | sort -t: -k2 -rn \
  | head -15 \
  | while IFS=: read -r file count; do
      printf "║    %4s  %s\n" "$count" "${file#$REPO_ROOT/}"
    done
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
  echo "║  Run: rg -n '$WEAK_PATTERNS' --type ts -g '*.test.ts' to find them"
  echo "╚══════════════════════════════════════════════════════════════╝"
  exit 1
fi
