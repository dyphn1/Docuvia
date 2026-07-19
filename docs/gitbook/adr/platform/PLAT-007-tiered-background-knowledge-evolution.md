---
id: PLAT-007
title: Tiered Background Knowledge Evolution (per-commit AST delta, batched LSP, queued LLM)
status: accepted — fully implemented (Slices 1-5 complete, 2026-07-19)
date: 2026-07-16
domains: [platform, graph, impact, llm, storage]
supersedes: []
superseded_by: []
---

# Tiered Background Knowledge Evolution

## Context

Two accepted ADRs made promises the code did not yet keep, as of 2026-07-16:

- [PLAT-004](PLAT-004-zero-interruption-invisible-indexing.md) mandates that the post-commit hook
  "triggers a background process that performs a **delta update** (only analyzing the changed
  files) and flushes the result to the knowledge branch via `snapshot`." In reality the hook ran
  `docuvia snapshot` only, and `SnapshotWorkflow` deliberately re-rendered SQLite without any
  re-parsing — AST ingestion happened exactly once, at `init`. Every commit re-published the
  day-one graph under a fresh `Docuvia-Source` stamp.
- [IMPT-002](../impact/IMPT-002-lsp-for-absolute-quality.md) mandates the AST + LSP + LLM
  tri-layer, with LSP escalation as "the core quality engine." `escalateToLsp` was a documented
  no-op when this ADR was written.

Meanwhile the components needed to keep those promises already existed unwired:
`SemanticDiffDetector` (`lib/ast-core/src/detector/semantic-diff.ts`) was a tested, exported
tree-sitter incremental-diff engine with two-level pruning (`INTERNAL_LOGIC` = blast radius 0,
`CONTRACT_CHANGED` = trigger diffusion) with zero production callers, and `analyze <targetPath>`'s
LLM decision extraction worked but only printed to the console — decisions were never persisted.

The open question was not _whether_ to run in the background (PLAT-004 settled that) but **what
runs at which trigger**, because the three layers have wildly different costs:

| Layer                       | Cost shape                                              | Evidence (2026-07-16, ~450-file workspace)                                                                                                                                                             |
| --------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AST delta re-parse          | ∝ diff size; sub-second for a typical 3–5-file commit   | Docuvia2 full-init AST pass is already competitive                                                                                                                                                     |
| LSP full-project escalation | seconds–minutes; ∝ project size                         | a real batch measured 2026-07-18 processed 135 files (30% of this ~450-file workspace) in 17.5s (§8, below) — competitor full indexes still run 5 min (GitNexus incremental) to 40 min (Graphify full) |
| LLM L3 extraction           | dollars (remote) or slow tokens (local); ∝ content sent | Graphify's semantic layer: ~$0.09/run on this repo                                                                                                                                                     |

Running all three on every commit is not economical and would violate PLAT-004's "feels like
nothing happened" bar. Running none of them (the status quo at the time) shipped an empty promise.

## Decision

**Adopt a three-tier trigger architecture: each layer of the tri-layer runs at the cheapest
trigger that still keeps its promise.** All three tiers, plus a reliability layer for `doctor`,
are implemented and shipped as of 2026-07-19.

### Command surface: converge into `analyze`, no new command

Ingestion ("bring the knowledge graph up to date with the source") has one command: `analyze`.
Its modes converge as options rather than as new commands (owner decision, 2026-07-16 — command
count must not grow when the user-facing essence is the same):

| Invocation                          | Behavior                                                                                                                                                                                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docuvia analyze`                   | **Auto mode**: full ingestion when no graph exists; sha fast-path + semantic delta otherwise (Tier A). _Breaking change_: replaced the old no-arg config-scan-only behavior (the scan became a step of full ingestion, as in `init`). |
| `docuvia analyze <targetPath>`      | Focused LLM decision extraction (existing, unchanged), persisted to `l3_nodes` since Slice 1.                                                                                                                                         |
| `docuvia analyze --escalate-to-lsp` | Tier B quality pass — the flag IMPT-002 names as "the core quality engine".                                                                                                                                                           |

The convergence test used (and its boundary): converge when the user would describe both actions
with the same sentence; keep separate commands when the sentences differ. `git checkout` is the
cautionary precedent — it merged two different user sentences (switch branches / discard changes)
because the _implementation_ was shared, and git later had to split it into `switch`/`restore`.
Hence delta/full/LSP modes converge into `analyze` (one sentence: "update the graph from my
code"), while `snapshot` (render/pack) stays a separate command with a different essence — Tier B
is the _composition_ `analyze --escalate-to-lsp && snapshot`, orchestrated by a thin scheduler,
not a mode of either command.

### Tier A — every commit: AST delta only (deterministic, sub-second)

The post-commit hook calls `docuvia analyze` (auto mode) instead of `snapshot`:

1. **Sha fast-path**: read the last-ingested source commit (a `docuvia_meta` key,
   `lastIngestedSourceSha`, distinct from the `Docuvia-Source` snapshot trailer). If it equals
   HEAD, exit immediately (`analyze.delta.noop` JSONL line) — this is the idempotency fast-path,
   checked first. Key absent (pre-existing workspace): fall back to the newest `Docuvia-Source`
   trailer on the knowledge branch, else full re-ingest once.
2. Diff `lastIngestedSourceSha → HEAD` (name-status), filtered by the same discovery
   ignore/oversize rules `init` uses. Added/modified files are re-parsed through the existing
   `AstProcessingService` + `GraphPersister` (per-file replace: delete the file's L2 rows, then
   persist the fresh parse); deleted files drop their rows; renames are delete+add.
3. `SemanticDiffDetector` runs on each changed file (old content via `git show`, new from HEAD,
   hunk ranges from the diff) **solely to classify pruning level** — changed files are re-parsed
   regardless, so the detector's role in Tier A is classification, not parse-avoidance. Any
   `CONTRACT_CHANGED` node enqueues its file into `tierBQueue` (a `docuvia_meta` JSON array of
   `{file, commitSha}`, deduped by file).
4. Fire-and-forget, marker-guarded, lock-protected (knowledge-branch lock for the persist step) —
   same discipline the hook already had (PLAT-006 pattern). Never blocks `git commit`. **Tier A is
   structurally forbidden from starting LSP or LLM work** — the commit hook stays AST-only by
   construction, not by a runtime check.

`snapshot` remains a pure render-and-pack command. Tier A does not snapshot on every commit —
see Tier B for the one-snapshot-per-batch policy.

### Tier B — LSP escalation batch (`--escalate-to-lsp`)

Triggered by **pre-push + a commit cap only — no idle timer in Phase 1** (the idle-timer
mechanism this ADR originally left open was resolved 2026-07-17: an OS scheduled task is a
daemon-manager in disguise, the exact shape this repo rejects; piggyback-on-next-run adds latency
jitter without guaranteeing freshness; pre-push + commit-cap needs no scheduler at all).

**Edge resolution: a provider seam.** `escalateToLsp` runs behind an
`IEdgeResolutionProvider` interface, not a hardcoded LSP call:

- **Provider 1 (shipped): spawn-per-batch headless `typescript-language-server`.** Resolved
  project-locally (`node_modules/.bin`, then `npx --no-install`), config-overridable via
  `DOCUVIA_LSP_BINARY`/`DOCUVIA_LSP_ARGS`/`DOCUVIA_LSP_TIMEOUT_MS`, never bundled with Docuvia.
  No resident daemon — consistent with this repo's repeated rejections of daemons (IFCE-002
  boundaries, PLAT-006's no-IPC stance, legacy ADR-027's hook-driven shape). Revisit a warm
  instance only if measured batch latency becomes a real complaint.
- **Provider 2 (documented seam, not built): small-model compensation.** A 1B-class local model
  could analyze files LSP can't reach in 100–200ms each. If both providers are ever enabled in
  parallel, results merge by provenance: LSP edges are authoritative, LLM edges carry
  `source='llm-inferred'` + confidence, LSP wins conflicts. No re-entry has been triggered yet
  (see the roadmap doc for the measured re-entry condition).
- **Honest degradation, always:** LSP absent / unready / timed out → AST-level edges stay as they
  are, a JSONL event records why, exit 0, `doctor` explains the reason. Statically inventing edges
  to paper over the gap is prohibited.

**Pre-flight gate, tiered by trigger point:**

- Commit hook (Tier A): never starts LSP — the gate doesn't even run there (see above).
- Push stage (Tier B batch): heavy work is allowed; the trigger point is what makes the cost
  acceptable (the user's own pre-push validation is typically already heavier than this batch).
- `init` / manual `analyze --escalate-to-lsp`: the gate is mandatory and interactive — detect
  environment readiness (`node_modules`, tsconfig, LSP binary resolvable) and let the user choose
  (`--fallback-ast` skips the confirmation). Background paths never prompt; they degrade and log.

**Language scope: TS/JS first, behind per-language dispatch.** Queue consumption dispatches by
language through a plugin-shaped dispatch table, never a hardcoded TS check. Non-TS/JS entries
skip LSP with a JSONL log line and stay at AST precision. See
[IMPT-002's Language Support Matrix](../impact/IMPT-002-lsp-for-absolute-quality.md#language-support-matrix-added-2026-07-19)
for the full per-language table — this is the canonical source for language coverage, kept in
one place rather than duplicated per-ADR.

**What "corrected edges" means:** for each queued file, LSP references/definitions run over its
symbols to write cross-file symbol-level `calls` edges between existing L2 nodes (`node_key`
identity). Incoming edges dropped by Tier A's per-file replace are repaired by re-attaching via
`node_key` (the deterministic identity survives the replace), so unchanged callers re-link without
re-parsing dependents — this is the backstop for the "edge drift" window Tier A accepts.

**Commit-cap: cumulative changed bytes, not raw commit count** (revised 2026-07-19 from the
original raw-commit-count design — see Consequences). A `docuvia_meta` running total
(`tierBChangedBytes`) accumulates `Buffer.byteLength` for every file Tier A's delta ingestion
actually parses (already past the discoverable/oversize filters, so docs and binaries are
excluded for free). Cap check at hook time compares the total against `DEFAULT_TIER_B_COMMIT_CAP_BYTES`
(512,000 bytes, tunable via `DOCUVIA_TIER_B_COMMIT_CAP`). Reset to 0 alongside `lastTierBBatchSha`
once a batch fully succeeds. `analyze` logs a one-line, non-blocking nudge the moment the cap is
exceeded (mid-workflow, while the user could still act); `doctor`'s `tier_b_commit_cap`
diagnostic reports the same condition passively as a backup for anyone who doesn't read logs.

**Queue consumption:** drain-all per batch; the queue clears **only after a successful
snapshot** (stage-then-finalize — a batch interrupted mid-LSP leaves the queue intact and
re-runnable). Entries whose file no longer exists in the working tree are dropped at consumption
with a log line. A per-file LSP failure keeps that entry for the next batch and lets the rest of
the batch proceed; the batch still snapshots what succeeded.

**Batch = one snapshot.** `analyze --escalate-to-lsp && snapshot`, orchestrated by the pre-push
hook (reusing the post-commit hook's marker + lock + legacy-upgrade pattern). Runs
**synchronously with a generous initial timeout** — explicitly tentative; the owner's own
pre-push validation is typically already heavier than this batch, so async execution is a later
UX optimization to evaluate against measured JSONL timings, not a Phase 1 requirement.

### Tier C — async queue with budget: LLM L3 extraction

1. **Persistence (Slice 1, ships independently of the rest of this tier):** `analyze <targetPath>`
   extraction results are written to `l3_nodes` with full provenance (source file(s), `commitSha`,
   extraction model, confidence, content hash). Dedup is a content-hash upsert: on a hash match,
   bump `occurrence_count` and `last_verified_at` rather than inserting a duplicate row.
   `validity_status` starts at the GRPH-002 "pending verification" phase.
2. **Queue/budget storage** follows the `docuvia_meta` precedent Tier B set — no new table:
   `tierCQueue` (JSON array, deduped by target — commit sha or `node_key` — same
   stage-then-finalize discipline as Tier B) and `tierCBudget` (`{"date", "calls", "tokens"}`,
   lazily reset on first dispatch after the UTC date rolls over — a daemonless equivalent of "reset
   at midnight").
3. **Consumption** folds into the same pre-push composition Tier B uses — no new command. The
   escalation pass also drains `tierCQueue` within budget and a strict per-run wall-clock cap;
   leftovers stay queued, cleared only after a successful persist (stage-then-finalize). Budget
   exhausted, system load high, or the bridge unreachable → skip with a JSONL line, exit 0 — the
   same honest-degradation contract Tier B uses.
4. **Commit semantic filter**, applied at enqueue (not consumption) so junk never occupies queue
   space: drop conventional-commit types in `{chore, style, ci, build, docs, test}`
   (config-overridable); drop subjects matching `/^(wip|fixup!|squash!|typo|lint|format|merge branch)/i`;
   drop subjects under ~10 characters after stripping any type prefix. Deliberately dumb and a
   pure function — no LLM pre-classification (spending budget to save budget is self-defeating).
5. **Request-side throttling:** concurrency 1 (reuses the PLAT-006 single-flight lock pattern,
   held for the dispatch window), the daily budget above, and a one-shot
   `os.loadavg()[0] / os.cpus().length > 0.8` check before dispatch (no polling loop). Ships as a
   documented no-op on Windows (`os.loadavg()` returns zeros there) until real contention is
   reported on a platform where it can be observed.
6. **Local LLM as the intended default tier, remote opt-in — but a single integration surface.**
   **All Tier C traffic goes through the LLM-002 CLIProxyAPI bridge; no other endpoint
   integrations are considered** (a locally-served model is just another base URL behind that
   bridge). Docuvia never manages the model process's lifecycle — the user supplies a running
   endpoint; `doctor` reports reachability (`ILlmClient.checkAvailability()`, added in Slice 5).
   An **embedded in-process model stays a documented seam, not built** — see the roadmap doc for
   the measured re-entry condition.

### Reliability (Slice 5, `doctor`)

- **`uninstall` actively removes both git hooks** (post-commit and pre-push) it installed, via
  `IKnowledgeGitService.removePostCommitHook`/`removePrePushHook`, rather than leaving a hook that
  still fires and silently no-ops (`npx --no-install`'s failure mode) after uninstall.
- **`impact --escalate-to-lsp` flag removed entirely** (CLI flag, workflow option, and its
  `MemoryKeys` plumbing) rather than kept as a documented no-op — `impact` already reads whatever
  edges Tier B has resolved into the graph regardless of any flag.
- **Commit-cap: nudge at commit time (Tier A) + `doctor` as a passive backup** (both, not
  either/or) — the nudge fires when the user could still act on it; `doctor` catches anyone who
  doesn't read console output or logs.
- **Legacy/duplicate hook blocks: reported by default, repaired only on request.** `doctor` never
  silently mutates a hook file the user may have hand-edited; `doctor --fix` performs the rewrite
  only when explicitly asked, converging into the existing `doctor` command rather than a new one.
- **`doctor` diagnostics added:** `git_hook` (absent / duplicate-block / legacy-only / resolvable),
  `tier_b_commit_cap` (passive nudge backup), `llm_reachability` (Tier C bridge reachability via
  `ILlmClient.checkAvailability()`), `lsp_binary` (reuses Tier B's own pre-flight gate,
  `IEdgeResolutionProvider.checkAvailability()`; TS/JS-scoped, matching Tier B's language
  boundary).

### Reliability requirements (all tiers, general)

- The hook's `npx --no-install docuvia` silently no-ops when docuvia is not installed in the repo
  — `doctor`'s `git_hook` diagnostic (above) detects "hook present but docuvia not resolvable".
- Every tier writes JSONL run logs (`.docuvia/logs/analyze.log` etc.) like every other command;
  failures never surface to the committing developer, only to `doctor` and the logs.
- Tier boundaries hold under concurrency: `analyze`'s delta mode takes the knowledge-branch lock
  for its persist step; batch snapshot reuses the existing lock. The `doctor`+`hydrate` and
  `analyze`+`snapshot` concurrency pairs are covered by regression tests (shipped in Slice 2).

## Consequences

**Easier:**

- PLAT-004's promise is now true with per-commit cost proportional to the diff, not the repo —
  the tool stays invisible at AI-agent commit velocity.
- IMPT-002's quality mandate has a costed home (LSP runs where minutes are acceptable) instead of
  an all-or-nothing flag that stayed a no-op.
- Knowledge-branch growth is bounded by batch cadence, not commit cadence, without a separate
  squash/GC design.
- The L3 pipeline (extract → store → `sync` push) closes end-to-end; `sync` no longer pushes from
  an always-empty table.

**Harder / risks (accepted):**

- Three triggers (hook, pre-push, commit cap) and two queues are more moving parts than one hook.
  Mitigation: all of them funnel into compositions of the same two idempotent, manually-invokable
  commands (`analyze` and `snapshot`) — the scheduler is thin.
- `analyze` no-arg changed meaning (config scan → auto ingestion) — a deliberate breaking change,
  since the old behavior was a fast no-op that produced zero graph rows.
- Delta correctness debt: cross-file effects invisible to a file-local AST diff drift until the
  next LSP batch corrects them. Accepted: Tier B exists precisely to be the quality backstop.
- A user who never pushes and never triggers the byte-size cap delays Tier B indefinitely — this
  is why the cap is mandatory, not optional, and why it was revised from a raw commit count (which
  a single large refactor commit could evade entirely) to cumulative changed bytes (2026-07-19;
  the blast-radius half of the original replacement proposal was rejected as too expensive for a
  hot path — see the roadmap doc).
- **A real Windows spawn bug** (`LspJsonRpcClient.start`'s `spawn()` call had no `shell: true`
  handling for `.cmd`/`.bat` binaries) meant Tier B silently degraded to AST-only on every batch,
  on every Windows machine, for the whole of Slice 3's life — found via a dogfooding validation
  run 2026-07-18, fixed same day. Post-fix: a real batch processed 135/135 queued files, applied
  287 edges, 0 failures — the first time Tier B completed successfully in this project's history.
- `git worktree` is not currently a usable environment for Docuvia (`IGitProvider.acquireKnowledgeLock`
  assumes `<cwd>/.git` is a directory; in a worktree it's a file) — found during the same
  validation run, not fixed (out of scope for a validation pass; tracked in the roadmap doc).

## Rejected alternatives

- **A new `docuvia update` command** (this ADR's own first draft) — rejected by the owner
  (2026-07-16): command count must not grow when the essence ("update the graph from my code")
  already has a command; modes converge as options on `analyze`, matching IMPT-002's own
  flag-not-command framing of `--escalate-to-lsp`.
- **`snapshot --evolve`** — overloads a second essence (ingestion) onto a render/pack command;
  the `git checkout` → `switch`/`restore` split is the precedent for why same-implementation is
  the wrong convergence test.
- **Full re-index per commit** — violates the invisibility bar; cost ∝ repo size.
- **Per-commit snapshot (status quo shape)** — publishes stale/duplicate graph states and bloats
  the knowledge branch at commit cadence.
- **Resident indexing daemon / warm LSP / OS-scheduled idle timer** — rejected consistently across
  ADR-027, PLAT-006, and IFCE-002's repo-scoped boundary stance; a scheduled task is a
  daemon-manager in disguise. Spawn-per-batch + pre-push/commit-cap triggers are chosen until
  measurement says otherwise.
- **Docuvia-managed local LLM lifecycle** — starting/stopping model server processes puts a
  daemon-manager inside a CLI and drags in cross-platform process supervision; user-supplied
  endpoint + `doctor` reachability check achieves the goal with none of that surface.
- **Self-built static scope-resolution pipeline** (bypassing LSP with hand-guessed cross-file
  calls) — considered during Slice 3 planning and overruled: during active development the code
  is compiled hundreds of times, so bypassing the real LSP to avoid a build dependency is wasteful
  re-invention. LSP stays the precision engine; honest AST-level degradation covers the
  build-not-ready case.
- **Composite "Semantic Drift Ratio" commit-cap** (diff size + impact-analysis blast radius +
  commit-count multiplier, replacing the plain commit-cap) — the blast-radius component was
  rejected (expensive per-commit impact analysis, a new 15%-threshold tunable with no measured
  need); the diff/blob-size component was reopened and adopted on its own (see the commit-cap
  description above).
- **Docker-compose historical-replay E2E harness** — disproportionate infrastructure for
  validating Tier B's hit-rate; a throwaway `git clone` + replay script substituted, and actually
  ran (2026-07-18), finding the Windows spawn bug above.
- **Recursive contract-diffusion re-seeding** (re-running LSP escalation when a referencer of a
  changed contract is itself a contract, diffusing until fully converged) — a simpler one-pass
  design shipped instead (find references once per queued file); re-open only if a real
  cross-contract-chain drift case is observed.

## Implementation status

All five slices are implemented, tested, and committed (2026-07-16 through 2026-07-19):

- **Slice 1 — L3 persistence**: `analyze <targetPath>` writes to `l3_nodes` with full provenance
  and content-hash dedup.
- **Slice 2 — Tier A**: `analyze` auto mode (sha fast-path + `SemanticDiffDetector` delta
  re-parse) + hook flip from `snapshot` to `analyze`, gated by the `analyze`+`snapshot` and
  `doctor`+`hydrate` concurrency regression tests.
- **Slice 3 — Tier B**: real `escalateToLsp` (spawn-per-batch `typescript-language-server`),
  one-snapshot-per-batch, pre-push + commit-cap triggers. Validated end-to-end against this
  project's own history (2026-07-18), including the Windows spawn-bug fix above.
- **Slice 4 — Tier C**: budgeted async LLM queue, commit semantic filter, request-side
  throttling, folded into the Tier B pre-push composition.
- **Slice 5 — Reliability**: all `doctor` checks above shipped; `uninstall` hook removal shipped;
  `impact --escalate-to-lsp` removed.
- **Post-Slice-5 (2026-07-19)**: commit-cap trigger revised from raw commit count to cumulative
  changed bytes (see Consequences).

Full monorepo build and test suite green after every slice. Open follow-on items (perf
optimizations, the embedded-LLM-model seam, the worktree incompatibility, Phase 2/3 design work)
are tracked in
[Roadmap & Open Items](../../analysis/roadmap-and-open-items.md), not in this ADR — this document
describes what shipped, not what's still under discussion.
