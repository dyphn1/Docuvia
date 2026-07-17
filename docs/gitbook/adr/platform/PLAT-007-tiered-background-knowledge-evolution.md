---
id: PLAT-007
title: Tiered Background Knowledge Evolution (per-commit AST delta, batched LSP, queued LLM)
status: accepted (Fully Verified - 2026-07-17)
date: 2026-07-16
domains: [platform, graph, impact, llm, storage]
supersedes: []
superseded_by: []
---

# Tiered Background Knowledge Evolution

## Context

Two accepted ADRs make promises the code does not yet keep:

- [PLAT-004](PLAT-004-zero-interruption-invisible-indexing.md) mandates that the post-commit hook
  "triggers a background process that performs a **delta update** (only analyzing the changed
  files) and flushes the result to the knowledge branch via `snapshot`." In reality the hook runs
  `docuvia snapshot` only, and `SnapshotWorkflow` deliberately re-renders SQLite without any
  re-parsing — AST ingestion happens exactly once, at `init`. Every commit re-publishes the
  day-one graph under a fresh `Docuvia-Source` stamp.
- [IMPT-003](../impact/IMPT-002-lsp-for-absolute-quality.md) mandates the AST + LSP + LLM
  tri-layer, with LSP escalation as "the core quality engine." `escalateToLsp` is a documented
  no-op.

Meanwhile the components needed to keep those promises already exist unwired:
`SemanticDiffDetector` (`lib/ast-core/src/detector/semantic-diff.ts`) is a tested, exported
tree-sitter incremental-diff engine with two-level pruning (`INTERNAL_LOGIC` = blast radius 0,
`CONTRACT_CHANGED` = trigger diffusion) and **zero production callers**; `analyze <targetPath>`'s
LLM decision extraction works, and in the 2026-07-16 (Slice 1 - Wire 2)實作中，已落實 L3 的持久化與 Upsert 去重（Content-Hash 碰撞去重 + 增加 occurrence_count，保存完整 provenance 例如 extraction_model 與 source_files），不再是原有的 print-only 狀態。Full inventory with file:line evidence:
[Background Knowledge Loop — Gap Analysis](../../analysis/background-knowledge-loop-gap-analysis.md).

The open question is not _whether_ to run in the background (PLAT-004 settled that) but **what
runs at which trigger**, because the three layers have wildly different costs:

| Layer                       | Cost shape                                              | Evidence (2026-07-16, ~450-file workspace)                                                                             |
| --------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| AST delta re-parse          | ∝ diff size; sub-second for a typical 3–5-file commit   | Docuvia2 full-init AST pass is already competitive                                                                     |
| LSP full-project escalation | minutes; ∝ project size                                 | ~3 min per IMPT-003's own estimate; competitor full indexes run 5 min (GitNexus incremental) to 40 min (Graphify full) |
| LLM L3 extraction           | dollars (remote) or slow tokens (local); ∝ content sent | Graphify's semantic layer: ~$0.09/run on this repo                                                                     |

Running all three on every commit is not economical and would violate PLAT-004's "feels like
nothing happened" bar. Running none of them (the status quo) ships an empty promise.

## Decision

**Adopt a three-tier trigger architecture: each layer of IMPT-003's tri-layer runs at the cheapest
trigger that still keeps its promise.**

### Command surface: converge into `analyze`, no new command

Ingestion ("bring the knowledge graph up to date with the source") already has a command:
`analyze`. Its modes converge as options rather than as new commands (owner decision, 2026-07-16 —
command count must not grow when the user-facing essence is the same):

| Invocation                          | Behavior                                                                                                                                                                                                                               |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docuvia analyze`                   | **Auto mode**: full ingestion when no graph exists; sha fast-path + semantic delta otherwise (Tier A). _Breaking change_: replaces the old no-arg config-scan-only behavior (the scan becomes a step of full ingestion, as in `init`). |
| `docuvia analyze <targetPath>`      | Focused LLM decision extraction (existing, unchanged).                                                                                                                                                                                 |
| `docuvia analyze --escalate-to-lsp` | Tier B quality pass — the flag IMPT-003 itself names as "the core quality engine".                                                                                                                                                     |

The convergence test used (and its boundary): converge when the user would describe both actions
with the same sentence; keep separate commands when the sentences differ. `git checkout` is the
cautionary precedent — it merged two different user sentences (switch branches / discard changes)
because the _implementation_ was shared, and git later had to split it into `switch`/`restore`.
Hence delta/full/LSP modes converge into `analyze` (one sentence: "update the graph from my
code"), while `snapshot` (render/pack) stays a separate command with a different essence — Tier B
is the _composition_ `analyze --escalate-to-lsp && snapshot`, orchestrated by the thin scheduler,
not a mode of either command.

### Tier A — every commit: AST delta only (deterministic, sub-second)

The post-commit hook changes to call `docuvia analyze` (auto mode) instead of `snapshot`:

1. **Sha fast-path**: read the last-ingested source commit (the `Docuvia-Source` trailer written by
   `KnowledgeGitService.buildSnapshotCommitMessage`, plus a `docuvia_meta` key for the last
   _ingested_ — not just snapshotted — sha). If it equals HEAD, exit immediately. This is the
   idempotency fast-path the cli-test-analysis flagged as missing.
2. Diff last-ingested sha → HEAD, feed changed files to `SemanticDiffDetector` to find affected
   semantic nodes and their pruning level.
3. Re-parse only affected files through the existing `AstProcessingService` + `GraphPersister`
   (the same components `init` Phase 4 uses); update L2 rows for those files.
4. Record pruning levels: any `CONTRACT_CHANGED` node enqueues its file for Tier B.
5. Fire-and-forget, marker-guarded, lock-protected — same discipline the hook already has
   (PLAT-006 pattern). Never blocks `git commit`.

`snapshot` remains a pure render-and-pack command (its current, correct scope). Tier A does not
snapshot on every commit — see Tier B.

### Tier B — debounced batch: LSP escalation + snapshot

Triggered by whichever comes first (defaults; tunable via config):

- **Idle timer**: no new commit for ~5 minutes after a Tier A run that produced changes, or
- **Pre-push**: about to share code, so share knowledge too, or
- **Commit cap**: ≥ N (default 20) commits accumulated since the last batch.

The batch:

1. Runs LSP escalation (implementing `escalateToLsp` for real) **only over the accumulated
   `CONTRACT_CHANGED` queue** — cross-file dependency resolution, precise references — and writes
   the corrected edges to the graph. A queue with only `INTERNAL_LOGIC` changes skips LSP entirely.
2. Renders and packs **one** snapshot onto the knowledge branch, covering the whole batch. This
   amends PLAT-004's "flushes via snapshot [per commit]" wording: per-commit L2 freshness is kept
   in `local.db` (Tier A), while the git-visible knowledge branch advances once per batch —
   resolving the knowledge-branch growth concern without a separate squash mechanism.

**LSP orchestration model: spawn-per-batch.** A headless LSP instance is started for the batch and
torn down afterward. No resident daemon — consistent with this repo's repeated rejections of
daemons (IFCE-002 boundaries, PLAT-006's no-IPC stance, legacy ADR-027's hook-driven shape).
Revisit a warm instance only if measured batch latency becomes a real complaint.

### Tier C — async queue with budget: LLM L3 extraction

1. **Persist first (independent, ships first):** `analyze <targetPath>` extraction results are
   written to `l3_nodes` instead of print-only, with provenance columns: source file(s),
   `commitSha`, extraction model, confidence, content hash (dedup via the same content-hash
   pattern `sync-state.json` uses). `validity_status` starts at the GRPH-002 "pending
   verification" phase. This fixes the evaporating-L3 wire regardless of the rest of this ADR.
2. Tier A/B enqueue L3 extraction candidates: commit messages + `CONTRACT_CHANGED` symbols. A
   background queue consumes them under an explicit budget (per-day call/token caps; queue simply
   waits when exhausted).
3. **Local LLM as the default tier, remote opt-in.** LLM-002's CLIProxyAPI bridge speaks
   OpenAI-shaped endpoints; a locally served model (Ollama / llama.cpp server) is just another
   base URL. **Docuvia does not manage the local model's process lifecycle** — the user supplies a
   running endpoint; `doctor` reports reachability. This keeps the no-daemon stance and makes
   background extraction zero-marginal-cost by default.

### Reliability requirements (all tiers)

- The hook's `npx --no-install docuvia` silently no-ops when docuvia is not installed in the repo.
  `doctor` MUST detect "hook present but docuvia not resolvable" and say so — invisible failure is
  unacceptable in a background-first product.
- Every tier writes JSONL run logs (`.docuvia/logs/analyze.log` etc.) like every other command;
  failures never surface to the committing developer, only to `doctor` and the logs.
- Tier boundaries hold under concurrency: `analyze`'s delta mode takes the knowledge-branch lock
  for its persist step; batch snapshot reuses the existing lock. The `doctor`+`hydrate` and
  `analyze`+`snapshot` concurrency pairs flagged open in `docs/cli-test-analysis/` must be covered
  by tests before the hook flips from `snapshot` to `analyze`.

## Consequences

**Easier:**

- PLAT-004's promise becomes true with per-commit cost proportional to the diff, not the repo —
  the tool stays invisible at AI-agent commit velocity.
- IMPT-003's quality mandate gets a costed home (LSP runs where minutes are acceptable) instead of
  an all-or-nothing flag that stayed a no-op.
- Knowledge-branch growth is bounded by batch cadence, not commit cadence, without a separate
  squash/GC design.
- The L3 pipeline (extract → store → `sync` push) closes end-to-end; `sync` stops pushing from an
  always-empty table.

**Harder / risks:**

- Three triggers (hook, idle timer, pre-push) and a queue are more moving parts than one hook.
  Mitigation: all of them funnel into compositions of the same two idempotent, manually-invokable
  commands (`analyze` and `snapshot`) — the scheduler is thin.
- `analyze` no-arg changes meaning (config scan → auto ingestion). Accepted: the old behavior was
  a fast no-op that produced zero graph rows (flagged as misleading in the cross-product
  benchmark), and folding it into ingestion removes a command-surface oddity. Existing tests and
  the user guide must be updated in the same change.
- The idle timer needs a scheduling mechanism without a daemon (options: OS-level scheduled task
  registered per-repo, a check piggybacked on the next `update` run, or pre-push-only as the
  conservative default). **This is the one genuinely open sub-decision left for implementation
  design.**
- Delta correctness debt: renames, file deletions, and cross-file effects invisible to a
  file-local AST diff will drift until the next LSP batch corrects them. Accepted: Tier B exists
  precisely to be the quality backstop, per IMPT-003's quality-first ordering.
- A user who never pushes and never idles (constant committing) delays Tier B indefinitely until
  the commit cap catches it — the cap is therefore mandatory, not optional.

## Rejected alternatives

- **A new `docuvia update` command** (this ADR's own first draft) — rejected by the owner
  (2026-07-16): command count must not grow when the essence ("update the graph from my code")
  already has a command; modes converge as options on `analyze`, matching IMPT-003's own
  flag-not-command framing of `--escalate-to-lsp`.
- **`snapshot --evolve`** — overloads a second essence (ingestion) onto a render/pack command;
  the `git checkout` → `switch`/`restore` split is the precedent for why same-implementation is
  the wrong convergence test.
- **Full re-index per commit** — violates the invisibility bar; cost ∝ repo size.
- **Per-commit snapshot (status quo shape)** — publishes stale/duplicate graph states and bloats
  the knowledge branch at commit cadence.
- **Resident indexing daemon / warm LSP** — rejected consistently across ADR-027, PLAT-006, and
  IFCE-002's repo-scoped boundary stance; spawn-per-batch is chosen until measurement says
  otherwise.
- **Docuvia-managed local LLM lifecycle** — starting/stopping model server processes puts a
  daemon-manager inside a CLI and drags in cross-platform process supervision; user-supplied
  endpoint + `doctor` reachability check achieves the goal with none of that surface.

> **Implementation Status (Slice 1 - Fully Resolved — 2026-07-17)**: Tier C L3 persistence has been fully implemented in Slice 1. Extraction decisions are successfully written to SQLite and serialized by upserting into the `l3_nodes` table, with full provenance columns (such as `extraction_model` and `source_files`) preserved and verified. Entries are correctly deduped by content hash, ensuring a robust, leak-free L3 pipeline mapping.
