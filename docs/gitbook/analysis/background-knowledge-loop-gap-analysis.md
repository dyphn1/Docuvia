# Background Knowledge Loop — Gap Analysis (2026-07-16)

> **Product vision under review:** knowledge accumulation runs entirely in the background; developers
> accumulate knowledge without ever being interrupted.
>
> **Method:** every claim below was verified against actual source (GitNexus knowledge-graph queries
> over the refreshed index, then direct file reads), not against docs or assumptions. File:line
> references are to the working tree at commit `6cdb552`.

---

## 1. Verdict

The background loop's skeleton is already built. The product is **not** missing infrastructure — it
is missing **three wire connections** between components that all individually exist, plus a
strategy decision on update granularity. The loop today:

```
capture ──✂──> process ──> store ──> distribute ──> consume
  (AST only     (SQLite)   (git      (knowledge     (MCP/query/impact,
   at init,                 branch)    branch,        self-healing ✅)
   never again)                        manual sync)
                 L3 decisions ──✂──> (printed to console, never persisted)
```

## 2. What already works (source-verified)

| Capability                                         | Where                                                                                                                            | Status                                                                    |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Post-commit hook, fire-and-forget, non-blocking    | `lib/core/src/git/git-constants.ts:8-14`, installed by `lib/core/src/git/knowledge-git.service.ts:78-126`                        | ✅ Installed by `init`; marker-guarded; lock-protected (PLAT-006 pattern) |
| Git-native knowledge branch w/ source-sha stamping | `knowledge-git.service.ts:325-329` (`Docuvia-Source` trailer)                                                                    | ✅ Verified round-trip (see cross-product benchmark)                      |
| Cross-clone reconciliation w/ tree-adoption merge  | `knowledge-git.service.ts:167-263`                                                                                               | ✅ Idempotent, offline-safe                                               |
| Read-path self-healing hydration (STOR-002)        | `lib/ui-core/src/utils/ensure-hydrated.ts` — called by `query`/`impact`/`status`/`review`                                        | ✅ Clone → first read auto-hydrates                                       |
| Semantic incremental-diff engine                   | `lib/ast-core/src/detector/semantic-diff.ts` (`SemanticDiffDetector`, two-level pruning: `INTERNAL_LOGIC` vs `CONTRACT_CHANGED`) | ⚠️ **Tested, exported, zero production callers (dead code)**              |
| LLM decision extraction (`analyze <targetPath>`)   | `lib/ui-core/src/workflows/analyze/analyze-workflow.ts:100-212` via LLM-002 CLIProxyAPI bridge                                   | ⚠️ Works, but output is print-only                                        |
| L3 storage + remote push                           | `lib/schema/src/sqlite/repos/l3-nodes-repo.ts`; `sync` reads L3 and pushes                                                       | ⚠️ Nothing ever writes L3 locally                                         |

## 3. The three broken wires

### Wire 1 — the hook snapshots a stale graph (highest priority)

`SnapshotWorkflow` deliberately does not re-run AST parsing
(`lib/ui-core/src/workflows/snapshot/snapshot-workflow.ts:16-24`); AST parsing lives only in
`init` Phase 4 (`lib/ui-core/src/workflows/init/run-parse-and-persist.ts`). `analyze` without a
target is only a config scan. Net effect: **every commit re-publishes the day-one graph with a new
source stamp.** The hook's own comment ("Non-intrusively extracts AST deltas") describes the
intent, not the behavior.

The fix has its engine already written: wire `SemanticDiffDetector` into a delta-update path
(anchored on the `Docuvia-Source` trailer: last-ingested commit → HEAD), re-parse only affected
files through the existing `AstProcessingService` + `GraphPersister`, then snapshot. The
sha-comparison fast-path gives idempotency for free.

### Wire 2 — L3 decisions evaporate

`analyze <targetPath>` extraction results reach `ui.info()` only
(`artifacts/cli/src/commands/analyze.ts:80-86`). `l3-nodes-repo.ts` exists; `sync`'s push pipeline
exists; the persist step between them does not. Smallest of the three fixes.

### Wire 3 — distribution is manual by explicit (and reasonable) design

`sync-knowledge` is deliberately not auto-wired (network op —
`lib/ui-core/src/workflows/sync-knowledge/sync-knowledge-workflow.ts:16-21`), but its own comment
blesses "a scheduled task or CI step" as the follow-up. It is already idempotent and offline-safe.

### Reliability footnote

The hook runs `npx --no-install docuvia` — if docuvia is not in the repo's `node_modules`, the hook
**silently does nothing**. For a background-first product this is an invisible failure mode;
`doctor` should check "hook present but docuvia not executable".

## 4. Cost observations & the tri-layer revival (owner input, 2026-07-16)

Measured on this workspace (Docuvia2, ~450 files):

| Operation                                                        | Wall time                             |
| ---------------------------------------------------------------- | ------------------------------------- |
| GitNexus incremental re-index (3 changed / 16 added files)       | ~5 min (257s measured)                |
| Graphify full build (AST + LLM semantic)                         | ~40 min (owner-measured)              |
| Full LSP pass over a large project (per IMPT-003's own estimate) | ~3 min                                |
| Docuvia2 `init` full AST pass                                    | competitive — "not slow" vs the above |

Implications the owner wants factored into Phase 1:

1. **Competitor index times dwarf a full LSP run.** The abandoned-in-practice
   **AST + LSP + LLM tri-layer** ([IMPT-003](../adr/impact/IMPT-002-lsp-for-absolute-quality.md),
   status: accepted, currently a documented no-op via `escalateToLsp`) is affordable and should be
   brought back into the plan — extended with an **embedded local LLM** option so background L3
   extraction has a zero-marginal-cost path (LLM-002's CLIProxyAPI bridge covers remote providers;
   local inference is the missing tier).
2. **Per-commit full work is not economical.** The open design question is _what runs at which
   trigger_, not _whether_ to run in background. Working hypothesis — tier by cost:
   - **Every commit:** AST delta only (`SemanticDiffDetector` on changed files — sub-second for a
     typical commit), plus the sha fast-path skip.
   - **Debounced / batch (idle timer, N commits, or pre-push):** LSP escalation for cross-file
     diffusion, triggered only when the delta contains `CONTRACT_CHANGED` nodes.
   - **Async queue with budget:** LLM L3 extraction (local model by default, remote opt-in),
     fed by commit messages + contract-changed symbols.
3. **L3 not being recorded (Wire 2) is a standing top concern.**

## 5. Phase 1 review — decisions (settled 2026-07-16, accepted in PLAT-007)

The owner agreed to the tiered-trigger hypothesis and accepted
[PLAT-007 — Tiered Background Knowledge Evolution](../adr/platform/PLAT-007-tiered-background-knowledge-evolution.md)
(status: **accepted**, 2026-07-16):

1. **Trigger & debounce policy** — ✅ three tiers: per-commit AST delta (sha fast-path +
   `SemanticDiffDetector`), debounced LSP batch (idle timer / pre-push / commit cap, whichever
   first), budgeted async LLM queue.
2. **Command surface** — ✅ no new command (owner: converge same-essence modes as options, like
   the `git checkout` → `switch`/`restore` lesson in reverse): `analyze` becomes the single
   ingestion command — no-arg auto mode (full first time, delta after), `<targetPath>` LLM
   extraction, `--escalate-to-lsp` for the batch tier; the hook calls plain `docuvia analyze`;
   `snapshot` stays pure render-and-pack and moves to the batch tier (also resolves
   knowledge-branch growth).
3. **LSP orchestration model** — ✅ spawn-per-batch headless LSP, no resident daemon; revisit warm
   instance only on measured pain.
4. **Local LLM integration** — ✅ user-supplied OpenAI-shaped endpoint through the LLM-002 bridge;
   docuvia does not manage the model process; `doctor` checks reachability.
5. **Knowledge-branch growth policy** — ✅ folded into tier B (one snapshot per batch); no separate
   squash/GC design needed.
6. **L3 schema for provenance** — ✅ persist `analyze <targetPath>` results to `l3_nodes` with
   source files, `commitSha`, model, confidence, content hash; ships first, independently.

**Remaining open sub-decision** (flagged in PLAT-007's Consequences): the idle-timer mechanism
without a daemon — OS scheduled task vs. piggyback-on-next-run vs. pre-push-only conservative
default.

## 6. Vision roadmap — the full loop (START HERE next session)

PLAT-007 deliberately covers only the **capture/process** side of the loop. This section is the
vision-level map so nothing outside the ADR's scope gets lost. Work top-to-bottom.

### Phase 0 — background readiness (✅ done, 2026-07-14/15)

Locks (PLAT-006, sync-state), `process.exitCode` fixes, JSONL run logs, regression tests — the
prerequisites for unattended concurrent processes. Residual open items live in
`docs/cli-test-analysis/README.md` and are absorbed into Phase 1's test requirements below.

### Phase 1 — capture & process (decided: PLAT-007, accepted 2026-07-16) — implementation order

1. **Wire 2 first: L3 persistence** — `analyze <targetPath>` results into `l3_nodes` with
   provenance (files, commitSha, model, confidence, content hash; GRPH-002 validity phase).
   Smallest, independent, unblocks the `sync` push pipeline immediately.
2. **Tier A: `analyze` auto mode + hook switch** — sha fast-path, `SemanticDiffDetector` wiring,
   delta re-parse via existing `AstProcessingService`/`GraphPersister`; the
   `analyze`+`snapshot` / `doctor`+`hydrate` concurrency tests (cli-test-analysis open items)
   gate the hook flip.
3. **Tier B: LSP escalation batch** — implement `escalateToLsp` (spawn-per-batch), batch
   snapshot, trigger plumbing (pre-push + commit cap; idle-timer mechanism is the one open
   sub-decision).
4. **Tier C: LLM queue** — budgeted async queue, local-endpoint default via LLM-002 bridge.
5. **Reliability**: `doctor` checks for "hook present but docuvia not resolvable" and LLM
   endpoint reachability.

### Phase 2 — distribute (not yet designed)

- `sync-knowledge` scheduling: CI step and/or pre-push wiring (its own code comment already
  blesses this). Small ADR or an amendment; decide together with Tier B's pre-push trigger so
  the two don't double-fetch.
- Remote `sync` (L3 → server) story: today it needs manual projectId/PAT; decide whether the
  background loop ever pushes to the remote API automatically or that stays explicit.

### Phase 3 — consume (mostly working; grow after Phase 1 lands)

- Read-path self-healing hydration already works (STOR-002). Once Tier A ships, `query`/`impact`/
  `review`/`export-topology`/MCP all stop serving a stale day-one graph — no work needed beyond
  verifying.
- Later: surface L3 "why" data in `review`/`impact` output (the differentiator vs GitNexus-class
  tools), richer `export-topology` once the graph is non-empty.

### Watchlist — known loose ends that don't belong to any phase yet

From the workflows-vs-ADR audit (`docs/gitbook/workflows/README.md`) and this review:

- `--global` flag still live in `init`/`uninstall` despite IFCE-002 saying it was removed.
- MCP's `docuvia_init` tool bypasses PLAT-006's command lock.
- `sync` vs `sync-knowledge` naming confusion — candidate for the owner's command-convergence
  principle (user-sentence test) in a future IFCE ADR.
- STOR-002's "no hydration code exists" note is stale (hydration subsystem exists in full).
- Remaining low-severity coverage gaps in `docs/cli-test-analysis/README.md`'s status table.

## 7. Stale docs noticed during this review

- `docs/gitbook/adr/llm/README.md` still says "no LLM invocation paths" — stale since LLM-002's
  `analyze <targetPath>` landed (also flagged in `docs/gitbook/workflows/README.md`).
- The tri-layer ADR file is named `IMPT-002-lsp-for-absolute-quality.md` but its frontmatter id is
  `IMPT-003` — one of the two should be corrected when the ADR is next touched.
