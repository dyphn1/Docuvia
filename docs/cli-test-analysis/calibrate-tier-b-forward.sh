#!/usr/bin/env bash
#
# Live Tier B (LSP) forward-resolution calibration harness -- issue #11 plan A, Slice 3.
#
# Turns the live throughput/parity numbers in `typescript-cli-benchmark.md` §3 (previously
# gathered ad hoc, one shell command per metric) into a single reproducible invocation that:
#   1. Optionally starts from a clean Tier-A-only baseline (`--reset`, which backs up then
#      removes the target repo's `.docuvia/local.db`).
#   2. Runs the Tier A ingestion so the `ast_call_sites` seed table is populated.
#   3. Runs a Tier B LSP batch under the forward resolution path
#      (`--escalate-to-lsp --full --lsp-timeout=0`), capturing wall-clock.
#   4. Reports the metrics the benchmark doc tables: files Tier B-processed, total edges, and
#      `ast_call_sites` seeds, read straight from the target repo's `.docuvia/local.db` via
#      `sqlite3` (node_links = the graph's edge sink, project_files.last_tier_b_processed_at =
#      the processed-file marker used by `--full` restaging).
#
# Usage:
#   calibrate-tier-b-forward.sh <repoRoot> [--reset] [--processes=N] [--label=my-run]
#
# Output is a single pipe-delimited row on stdout, so multiple runs can be appended to a log
# and compared:
#
#   label | files_in_queue | seeds_ast_call_sites | files_tier_b_processed | total_edges | wall_ms
#
# Self-skips (emits a `skip` row) rather than failing when the CLI or the target repo's own
# `node_modules` cannot resolve `typescript-language-server`; a non-`--reset` run works against
# `<repoRoot>`'s current `.docuvia` state and never mutates it.

# Missing harness dependencies are fail-closed (they produce no measurements worth using).
command -v sqlite3 >/dev/null 2>&1 || { echo "sqlite3 required" >&2; exit 2; }

REPO="${1:?usage: calibrate-tier-b-forward.sh <repo> [--reset] [--processes=N] [--label] ...}"
shift

DOCUVIA_BIN="${DOCUVIA_BIN:-$(dirname "$0")/../../../node_modules/.bin/docuvia}"

RESET=0
PROCESSES=1
LABEL="$(basename "$REPO")"

for arg in "$@"; do
  case "$arg" in
    --reset) RESET=1 ;;
    --processes=*) PROCESSES="${arg#*=}" ;;
    --label=*) LABEL="${arg#*=}" ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done

# --- Self-skip guard: the CLI + the target repo's LSP shim must both be usable. ------------
if [[ ! -x "$DOCUVIA_BIN" ]]; then
  echo "${LABEL}|skip|cli-unresolved|0|0|0|0"; exit 0
fi
if [[ ! -x "$REPO/node_modules/.bin/typescript-language-server" ]] \
   && [[ ! -f "$REPO/node_modules/typescript/package.json" ]]; then
  echo "${LABEL}|skip|typescript-language-server-unresolved|0|0|0|0"; exit 0
fi

DB="$REPO/.docuvia/local.db"
if [[ "$RESET" -eq 1 && -f "$DB" ]]; then
  cp "$DB" "$DB.calib-backup-$(date +%Y%m%d%H%M%S)"
  rm -f "$DB" "$DB-shm"
fi

sqlite_q() { sqlite3 "$DB" "$1" 2>/dev/null || echo 0; }

start_ms=$(date +%s000)

# Phase 1: Tier A ingestion (idempotent; fast no-op when HEAD has not moved). Ensures the
# `ast_call_sites` seed table and the queue are populated for the LSP pass.
( cd "$REPO" && "$DOCUVIA_BIN" analyze ) >/tmp/docuvia-calib-tierA.log 2>&1 || true

seed_count=$(sqlite_q "SELECT count(*) FROM ast_call_sites;")
queue=$(sqlite_q "SELECT count(*) FROM project_files;")

# Phase 2: Tier B forward LSP batch, uncapped (an indefinitely-running batch is the only
# apples-to-apples shape vs. the 120s-capped reverse baselines -- the doc's §3 twin-run logic).
if [[ "$PROCESSES" != "1" ]]; then
  ( cd "$REPO" && "$DOCUVIA_BIN" analyze --escalate-to-lsp --full --lsp-timeout=0 \
      "--lsp-processes=${PROCESSES}" ) >/tmp/docuvia-calib-tierB.log 2>&1 || true
else
  ( cd "$REPO" && "$DOCUVIA_BIN" analyze --escalate-to-lsp --full --lsp-timeout=0 ) \
      >/tmp/docuvia-calib-tierB.log 2>&1 || true
fi

files_processed=$(sqlite_q "SELECT count(*) FROM project_files WHERE last_tier_b_processed_at IS NOT NULL;")
total_edges=$(sqlite_q "SELECT count(*) FROM node_links;")

end_ms=$(date +%s000)
wall_ms=$((end_ms - start_ms))

echo "${LABEL}|${queue}|${seed_count}|${files_processed}|${total_edges}|${wall_ms}"