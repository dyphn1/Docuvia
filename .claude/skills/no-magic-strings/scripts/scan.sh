#!/usr/bin/env bash
# Finds candidate magic-string literals in tracked TypeScript source files.
#
# This is a *candidate finder*, not a linter: it cannot tell a constant
# definition site from a call-site usage (that requires reading the
# surrounding code). It exists to make the "git ls-files + grep" sweep in
# SKILL.md fast and repeatable across ~200+ files. Triage every hit by hand
# using the rules in SKILL.md before extracting anything.
#
# Usage:
#   scripts/scan.sh [path-prefix]
#
# Examples:
#   scripts/scan.sh                    # whole repo
#   scripts/scan.sh lib/core           # just one package
#   scripts/scan.sh artifacts/cli/src/commands

set -euo pipefail

PREFIX="${1:-.}"
cd "$(git rev-parse --show-toplevel)"

git ls-files -- "$PREFIX" \
  | grep -E '\.(ts|tsx)$' \
  | grep -vE '(^|/)(dist|coverage|node_modules)/' \
  | grep -vE '\.d\.ts$' \
  | grep -vE '\.(test|spec)\.ts$|\.unit\.test\.ts$' \
  | grep -vE '(^|/)constants/' \
  | while IFS= read -r file; do
      grep -nE '"[^"]{1,200}"|'\''[^'\'']{1,200}'\''|`[^`]{1,200}`' "$file" \
        | grep -vE '^[0-9]+:[[:space:]]*(import |export \* from|export \{[^}]*\} from)' \
        | grep -vE '^[0-9]+:[[:space:]]*\} from ["'\'']' \
        | grep -vE '^[0-9]+:[[:space:]]*(//|/\*|\*)' \
        | sed "s#^#${file}:#" \
        || true
    done
