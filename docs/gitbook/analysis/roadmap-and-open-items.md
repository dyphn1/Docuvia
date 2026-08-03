# Roadmap & Open Items

> **Purpose:** this is the single place for everything **not yet decided or shipped**. Everything
> that _has_ shipped lives in its governing ADR — [PLAT-007](../adr/platform/PLAT-007-tiered-background-knowledge-evolution.md)
> for the tiered background loop (Tiers A/B/C + `doctor` reliability), [IMPT-002](../adr/impact/IMPT-002-lsp-for-absolute-quality.md)
> for the LSP tri-layer and language coverage — not here. This file replaces the scattered
> Gemini deep-dive reports and the Phase 1 planning/decision trail that used to live under
> `docs/gitbook/analysis/`; those are retired once their content is captured below or in an ADR.
>
> Items are ordered roughly by priority/dependency, not by date. When one of these gets decided,
> move the decision into its governing ADR (or a new one) and delete the row here.

## Phase 2 — Distribute (items 1-3 decided & shipped)

L3 distribution (storage shape + merge strategy) is decided and shipped — see
[Phase 2, Item 1 — L3 Distribution Strategy](phase2-l3-distribution.md) for the full contract
(`L3DIST-001`..`008`) and implementation record (2026-07-21).

`sync-knowledge` scheduling and the remote-sync auto-push question are both resolved (one shipped,
one explicitly parked) — see
[Phase 2, Items 1-2 — sync-knowledge Scheduling & Remote-Sync Auto-Push](phase2-sync-knowledge-scheduling.md)
for the full contract (`SKSCHED-001`..`006`) and implementation record (2026-07-21).

### 3. `sync` vs `sync-knowledge` naming

> **Shipped — decided and implemented 2026-07-28. `sync` renamed to `publish`;
> `sync-knowledge` unchanged. See [IFCE-005](../adr/interface/IFCE-005-rename-sync-to-publish.md)
> for the decision and the (deliberately narrow) scope boundary.**

## Phase 3 — Consume (mostly working, minor follow-ups)

### 4. Surface L3 "why" data in `review`/`impact` output

> **Shipped — implemented and committed by automated roadmap sweep on 2026-07-28 (`492e93ba`).**

`review`/`impact` now attach each impacted node's L3 decisions/context to its blast-radius
results, showing _why_ a symbol changed alongside _what_ changed — the differentiator vs.
GitNexus-class tools this item was tracking.

### 5. Richer `export-topology`

> **Shipped — implemented and committed by automated roadmap sweep on 2026-07-28 (`949a65d8`).**

Node/link JSON now carries L2 type, decision content/confidence/validity/source commits, and edge
commit-sha/diff-summary, so `export-topology`'s existing interactive HTML viewer (in place since
2026-07-12, see [`cross-product-cli-benchmark.md`](cross-product-cli-benchmark.md) action item 5's
correction) can render a richer topology without a second query round-trip.

## Known open technical items (small, tracked, unowned)

### 8. Race C — `query` (foreground read) vs. `analyze` (background write)

> **Shipped — implemented and committed by automated roadmap sweep on 2026-07-28 (`23aebb42`).**

This was the one scenario in the concurrency lock matrix below without a gating test (unlike
`analyze`+`snapshot`/`doctor`+`hydrate`, gated since Slice 2). `query-analyze-concurrency.test.ts`
now closes that gap directly — exercising real concurrent CLI processes and asserting well-formed,
non-torn output plus `local.db` integrity, rather than relying on WAL's non-blocking behavior as an
unverified given.

Reference — core workflow lock matrix (kept for context, not re-verified line-by-line against
every workflow; treat as a design reference, not a test oracle):

| Workflow           | DB Lock                  | Knowledge Branch Lock  | Notes                             |
| ------------------ | ------------------------ | ---------------------- | --------------------------------- |
| `init`             | 🔴 WriteLock (IMMEDIATE) | ❌ none                | migrations uninterrupted          |
| `analyze` (Tier A) | 🔴 WriteLock (IMMEDIATE) | ❌ none                | incremental L2/L3 write, no git   |
| `snapshot`         | 🟢 ReadLock (shared)     | 🔴 KnowledgeBranchLock | protects temp dir & branch writes |
| `sync-knowledge`   | ❌ none                  | 🔴 KnowledgeBranchLock | push/pull knowledge branch        |
| `hydrate`          | 🔴 WriteLock (IMMEDIATE) | ❌ none                | batch L2 rebuild                  |
| `doctor`           | 🟢 ReadLock (shared)     | ❌ none                | read-only                         |

### 9. Embedded in-process LLM model

Deferred, not built. Both Tier B's edge-resolution provider seam and Tier C's endpoint decision
(PLAT-007) name this as a future option, never scheduled. **Concrete, measured re-entry trigger**
(not speculative): (a) Tier B degradation JSONL lines show LSP-absent/timeout on ≥25% of batches
over a sustained real-usage window, or (b) Tier C's daily budget is measurably exhausted by
routine extraction volume such that per-file compensation through the CLIProxyAPI bridge is
demonstrably unaffordable. Neither number exists yet — this stays parked until one does.

### 10. `tierBQueue` staleness/eviction policy

Deferred — the "infinitely growing backlog" premise is overstated (the queue is already deduped by
file and bounded by repo file count). The one cheap addition already shipped: queue size is logged
in Tier B's JSONL batch-summary line, so a future eviction decision (if ever needed) will be
data-driven rather than speculative.

> **Rechecked 2026-07-28** — `filesQueued` is still emitted on every `analyze.tier_b.summary` JSONL
> line (`run-tier-b-batch.ts`'s `finalizeBatch`). No growth signal has shown up in it; policy stays
> deferred, no code change warranted.

### 11. Hydrate-then-delta optimization

> **Shipped — implemented and committed by automated roadmap sweep on 2026-07-28 (`f2f44d30`).**

An empty `local.db` next to an already-populated knowledge branch no longer triggers a full
re-parse of HEAD. It now resolves the hydration commit and its paired `Docuvia-Source` sha first
and delta-ingests from there, falling back to the original full-ingestion path whenever either half
of that pairing can't be resolved.

### 13. Dirty-index hash edge

Delta ingestion takes blob hashes from the git index but reads content at `headSha`; a dirty index
can mismatch the `files` dedup table. Confirmed harmless today (Tier B never calls the same code
path — `collectFilesToParse` is Tier A only), but worth rechecking if either tier's design changes.

> **Rechecked 2026-07-28** — `collectFilesToParse` (`run-delta-ingestion.ts`) still has exactly one
> call site (Tier A's delta ingestion); `listTrackedFilesWithBlobHash` still hashes off the git
> index while content comes from `headSha`, so the mismatch is real but still unreachable from
> Tier B. Neither tier's design has changed since the original note — still harmless, no code
> change.

### 14. `getChangedFilesSince` asymmetry footgun

No-arg mode merges in untracked files; an explicit `baseRef` (even `"HEAD"`) does not. Documented
and pinned by integration tests today, but an easy trap for a future call site that doesn't know
the asymmetry exists.

> **Rechecked 2026-07-28** — the `if (!baseRef && !toRef)` branch in `getChangedFilesSince`
> (`git-local-provider.ts`) and its regression test ("single-ref legacy mode ... regression guard"
> in `git-local-provider.integration.test.ts`) are both still in place, and no new call sites have
> been added since. The asymmetry is intentional design, not a bug — documented + tested is its
> correct terminal state, nothing to fix.

### 15. Degraded batch still advances `lastTierBBatchSha`

A fully-degraded Tier B batch (LSP absent) still seeds/advances the commit-cap baseline at the
next snapshot, even though its queued entries stay unprocessed. Harmless today (pre-push runs
regardless of the cap), but interacts with any future "rebuild the queue from `lastTierBBatchSha`"
recovery story.

> **Rechecked 2026-07-28** — confirmed still true and still harmless: `isTierBCommitCapExceeded`
> (now driven by the `tierBChangedBytes` accumulator, §9m item 1) only feeds two advisory surfaces
> — `analyze`'s one-line nudge and `doctor`'s always-`PASS` diagnostic message — neither `publish`
> nor any other workflow gates on it. A degraded batch's `finalizePendingTierBBatch` still
> unconditionally zeroes the accumulator, but with nothing blocking on the cap this stays
> informational-only drift, no code change.

### 16. Tier B "file exists" check is working-tree, not HEAD

Implemented as an exists-in-working-tree check rather than exists-at-HEAD, since the LSP session
reads live files off disk. Consistent with item 13 above; not a bug, just worth remembering if
Tier B ever operates against something other than the live working tree.

> **Rechecked 2026-07-28** — still exactly as documented: `dispatchQueue` in `run-tier-b-batch.ts`
> checks `fs.existsSync` against the working tree, with the assumption already spelled out in its
> own doc comment. No change needed.

### 17. Go Tier B (LSP escalation) is effectively non-functional — `references` resolution fails near-universally against gopls

Found 2026-08-03 during the Go CLI benchmark pass (full detail:
[`go-cli-benchmark.md`](../../cli-test-analysis/go-cli-benchmark.md) §3.1/§1.2, summary in
[`README.md`](../../cli-test-analysis/README.md) §3.3 item 1). `docuvia analyze --escalate-to-lsp`
against `gin-gonic/gin` — with `doctor` confirming `lsp_binary_go: PASS` (gopls resolved and
reachable) — processed its 98-file Tier B queue and failed **95 of them**: 2 timed out during
gopls's initial workspace load, and ~93 returned gopls's own `"no identifier found"` error within
milliseconds of each other. Only 3/98 files processed, 0 corrected edges applied — the batch ran
for ~128s and produced strictly nothing.

**Traced to** [`lsp-edge-provider-base.ts:663-669`](../../../lib/core/src/lsp/lsp-edge-provider-base.ts):
`textDocument/references` is requested at `symbol.selectionRange.start`, where `symbol` comes from
`textDocument/documentSymbol`'s response for the file. The near-universal, near-instant, identical
error text across almost every symbol in almost every file (not a handful of edge cases) points at
a systemic position/response-shape mismatch specific to how gopls's Go `documentSymbol` responses
are structured or interpreted here — **not yet root-caused past this point.** Next step: log gopls's
raw `documentSymbol` response for one real `gin` file and diff it against what
`containsPosition`/`symbol.selectionRange` in the base provider expect.

Distinct from item 16 above and from the pre-existing `GRPH-006` `supportsQualifiedContainment`
gap on `GoLspEdgeProvider` (which never even became observable in this run — this bug sits upstream
of it, since `references` fails before containment shape would matter). Every other language's Tier
B provider shares the same `lsp-edge-provider-base.ts` code path, so this may be Go-specific (gopls
response shape) or may be a latent bug other languages happen not to trigger — not yet determined
which.

**Status: not fixed.** Flagged for a dedicated follow-up session — do not treat Go Tier B results as
meaningful until this is resolved; today it silently returns a 0-edge "success" rather than
surfacing that nothing usable was extracted.

## Rejected / considered-and-closed (kept for context, do not re-litigate without new evidence)

- **Self-built static scope-resolution pipeline** (bypass LSP with hand-guessed cross-file calls)
  — overruled; see PLAT-007's Rejected alternatives.
- **Composite "Semantic Drift Ratio" commit-cap** (blast-radius half) — rejected as an expensive
  hot-path addition with no measured need; the diff/blob-size half was adopted separately (now
  shipped in PLAT-007's Tier B commit-cap).
- **Docker-compose historical-replay E2E harness** — rejected as disproportionate; a throwaway
  `git clone` + replay script substituted and actually found the Windows LSP spawn bug.
- **Recursive contract-diffusion re-seeding** — a simpler one-pass design shipped instead; re-open
  only on a real observed cross-contract-chain drift case.
