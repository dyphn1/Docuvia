# Phase 1 — Decision Integration & Implementation Handoff (2026-07-16)

> **Inputs integrated:** [Background Knowledge Loop — Gap Analysis](background-knowledge-loop-gap-analysis.md)
> (2026-07-16), [Cross-Product CLI Benchmark](cross-product-cli-benchmark.md) (2026-07-13, live-verified),
> and [PLAT-007 — Tiered Background Knowledge Evolution](../adr/platform/PLAT-007-tiered-background-knowledge-evolution.md)
> (accepted 2026-07-16).
>
> **Method:** every load-bearing claim from the input reports was re-verified against the working
> tree today before deciding. This report is the final integration; implementation is dispatched
> from §5.

---

## 1. Reconciliation of the two analyses

The two reports describe the same product at different dates and different altitudes. Integrated:

| Claim                                          | Benchmark (7/13) | Gap analysis (7/16)                  | Verified today (working tree)                                                                                             |
| ---------------------------------------------- | ---------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `dist/cli.js` unbootable (duplicated shebang)  | ❌ blocking bug  | not mentioned                        | **Fixed** — `artifacts/cli/tsup.config.ts` no longer injects a shebang banner (only the `createRequire` banner remains)   |
| AST worker crash-loops on `encoding.js` import | ❌ blocking bug  | init Phase 4 works                   | **Fixed** — `lib/core/src/ast/ast-worker.ts` inlines the constants instead of importing `../constants/encoding.js`        |
| Graph is empty / `analyze` produces 0 nodes    | ❌               | Wire 1: hook snapshots a stale graph | **Still true as designed** — no-arg `analyze` is config-scan-only (`analyze-workflow.ts:75-98`); ingestion only at `init` |
| L3 decisions evaporate (print-only)            | not tested       | Wire 2                               | **Still true** — `analyze.ts:80-91` prints; `L3NodesRepo` is deliberately read-only (`l3-nodes-repo.ts:9-14`)             |
| snapshot/hydrate git plumbing works            | ✅ verified      | ✅                                   | unchanged                                                                                                                 |

**Conclusion:** the benchmark's two blocking bugs are already fixed; its remaining Docuvia2
action items (non-interactive `init`, `uninstall` confirmation) are real but orthogonal to
Phase 1 and stay on the watchlist. The gap analysis's three-wire framing plus PLAT-007's tier
decisions are the authoritative Phase 1 scope. **Nothing found today contradicts PLAT-007 —
it stands as accepted.**

## 2. Integrated decision — what Phase 1 implements, in order

PLAT-007's ordering is confirmed as the best solution; no competing alternative from either
report survives (full re-index per commit, new `update` command, `snapshot --evolve`, resident
daemon — all already rejected in the ADR with reasons that still hold):

1. **Slice 1 — Wire 2: L3 persistence** (dispatched now, §5). Smallest, fully independent,
   the owner's standing top concern, and unblocks `sync`'s existing push pipeline.
2. **Slice 2 — Tier A**: `analyze` auto mode (sha fast-path + `SemanticDiffDetector` delta
   re-parse) + hook flip from `snapshot` to `analyze`. **Gated** by the `analyze`+`snapshot`
   and `doctor`+`hydrate` concurrency tests (still open per `docs/cli-test-analysis/README.md`
   status table).
3. **Slice 3 — Tier B**: real `escalateToLsp` (spawn-per-batch), one-snapshot-per-batch,
   pre-push + commit-cap triggers.
4. **Slice 4 — Tier C**: budgeted async LLM queue, local endpoint default via LLM-002 bridge.
5. **Slice 5 — Reliability**: `doctor` detects "hook present but docuvia not resolvable" and
   LLM endpoint reachability.

### Resolution of PLAT-007's one open sub-decision (idle-timer mechanism)

**Decision: pre-push + commit-cap only for Phase 1; no idle timer.** Of the three options the
ADR left open (OS scheduled task / piggyback-on-next-run / pre-push-only conservative default),
the conservative default wins for Phase 1: an OS scheduled task is a per-repo, cross-platform
registration surface (a daemon-manager in disguise — the exact shape this repo rejects), and
piggyback-on-next-run adds latency jitter without guaranteeing freshness. The commit cap is
already mandatory per PLAT-007's own risk note, so Tier B liveness is bounded without a timer.
Revisit an idle mechanism only if real usage shows batches waiting too long — same
"measured pain first" rule the ADR applies to warm LSP instances.

## 3. Slice 1 (Wire 2) — integration-level design decisions

Verified against schema `0001_init.sql:92-113` and contracts. Three gaps the ADR's one-line
spec didn't resolve, decided here:

### 3a. Schema: two additive columns, one new migration

`l3_nodes` already has `commit_hash`, `source_commits`, `confidence`, `content_hash` (indexed),
`validity_status` (default `'pending'` — already the GRPH-002 phase PLAT-007 asks for), and
`source`. Missing vs. PLAT-007's provenance list: the **extraction model** and the **source
file list**. Decision: new migration `0004_l3_provenance.sql` adding two nullable columns —
`extraction_model TEXT`, `source_files TEXT` (JSON array of workspace-relative paths). Additive
`ALTER TABLE ... ADD COLUMN` only; no table rebuild, no backfill (pre-existing rows keep NULL).

### 3b. Anchoring: resolve `l2_node_id` via `node_key`, never invent graph nodes

`l3_nodes.l2_node_id` is `NOT NULL`, but `analyze <targetPath>` decisions are extracted from a
file **or directory** target. Decision — resolve in this order:

1. Exact match: L2 node whose `node_key` (STOR-005 deterministic `<file_path>` /
   `<file_path>#<symbol>` identity) equals the workspace-relative target path.
2. Directory target / no exact match: the file-level L2 node of the **first collected source
   file** that has one (the extraction already knows its file list from `collectSourceFiles`).
3. No L2 node at all (graph empty — `init` never ran ingestion): **persist nothing, warn
   clearly** ("run `docuvia init` first — decisions need a graph to attach to"), exit 0, and
   still print the decisions. Rationale: inventing synthetic L2 anchor nodes pollutes the graph
   Tier A is about to make real, and relaxing `NOT NULL` in SQLite means a table rebuild — both
   worse than an honest precondition. Tier A (Slice 2) makes this branch rare.

### 3c. Dedup: content-hash upsert, occurrence bump

`content_hash` = sha256 over `nodeType + "\n" + title + "\n" + content` (normalized). On hash
match for the same project: bump `occurrence_count`, refresh `last_verified_at`, append the
current commit to `source_commits` if new — do **not** insert a duplicate row. This mirrors the
`sync-state.json` content-hash pattern PLAT-007 names, and the `l3_nodes_content_hash_idx`
index already exists for it. New rows: `commit_hash` = HEAD sha at extraction time,
`source_commits` = `[HEAD]`, `source` = `'analyze'`, `ai_generated` = 1,
`validity_status` = `'pending'` (column default).

### 3d. Surfaces touched

- `IL3NodesRepo` (contracts) + `L3NodesRepo` (schema): add the write/upsert method; delete the
  "deliberately no write methods" comment whose reason expires with this change. FTS triggers
  on `l3_nodes` already keep `l3_nodes_fts` in sync — no extra FTS work.
- `AnalyzeWorkflow.executeDecisionExtraction`: after parsing decisions, resolve anchor + persist
  through the repo (graph store opened the same way other workflows do), append a
  `analyze.focused.persisted` JSONL log line with counts.
- `analyze.ts` CLI: report "N persisted, M deduplicated" after the existing per-decision output.
- Tests: unit tests for the upsert (new/dup/occurrence bump), anchor resolution (file / directory
  / empty-graph), and a workflow-level test that a mocked LLM response lands as `l3_nodes` rows
  with full provenance. `insertL3NodeFixture` (graph-store integration test helper) can retire
  in favor of the real write path where it makes tests clearer.

**Acceptance for Slice 1:** `pnpm run build` + full test suite green; `analyze <targetPath>`
twice on the same target yields rows once with `occurrence_count` bumped, not duplicated;
`export-topology`/`sync` read paths see the rows without modification.

## 4. Watchlist (unchanged, carried forward)

Benchmark items not in Phase 1 scope: non-interactive `init` flag, `uninstall` global-config
confirmation, borrow-visualization ideas. Gap-analysis watchlist items (stale `--global` flag,
MCP `docuvia_init` lock bypass, `sync`/`sync-knowledge` naming, stale STOR-002/LLM-README
notes) remain parked for Phase 2+ or doc passes.

## 5. Handoff

Slice 1 is dispatched to a Sonnet-class implementation agent with this report as the spec
(§3 is the contract; the implementer has latitude on code placement, none on the decisions).
Slices 2–5 follow sequentially, each gated by verification of the previous; Slice 2 additionally
requires the two open concurrency tests before the hook flips.
