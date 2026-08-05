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

> **Fixed 2026-08-04.** `initializeSession` (`lsp-edge-provider-base.ts`) sent a completely empty
> `capabilities: {}` on `initialize` — confirmed live against a real gopls v0.23.0 that without
> `textDocument.documentSymbol.hierarchicalDocumentSymbolSupport: true` declared, it answers
> `documentSymbol` with the flat `SymbolInformation` shape, whose `location.range.start` is a
> declaration's start (e.g. the `func` keyword) rather than its identifier's — every `references`
> lookup at that position fails with gopls's own `"no identifier found"`. Fixed by declaring the
> capability (base-class-level, one line, every language benefits). Reverified against the exact
> `gin` batch this item describes: **92/98 files processed, 804 corrected edges applied** (was
> 3/98, 0 edges) — the remaining 6 are the separate, already-documented build-tag/timeout gaps
> below, not this bug. `GRPH-006`'s `supportsQualifiedContainment` question (last paragraph below)
> is still open and unaffected by this fix.

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

**Status: fixed 2026-08-04** (see the note at the top of this item) — was: not fixed, silently
returning a 0-edge "success" rather than surfacing that nothing usable was extracted.

### 18. Git-knowledge-branch pack-step crash (`Error: write EOF`) on large repos

> **Fixed 2026-08-04.** Two independent bugs, one masking the other — full detail in
> [`go-cli-benchmark.md`](../../cli-test-analysis/go-cli-benchmark.md) §1.1's addendum. (1) The
> real failure: a symbol/file name colliding with a Windows-reserved device name (`Aux`, `con`,
> `nul`, ...) renders to a git tree path (`knowledge/.../Aux.md`) that `git fast-import` itself
> refuses (`fatal: invalid path`, git's own cross-platform `core.protectNTFS` guard, on by default
> on every OS) — real repro was moby's `pkg/progress.Aux` (Docker's `JSONMessage.Aux` field). (2)
> Why it crashed instead of failing cleanly: `runFastImport` (`fast-import.ts`) had an `"error"`
> listener on `child` but never on `child.stdin` — a distinct `EventEmitter`. When git aborted
> mid-stream, the in-flight stdin write failed and, unhandled, threw as an uncaught exception,
> crashing the whole process before git's real stderr message ever surfaced — which is why two
> separate benchmark passes (`vscode` and `moby`) saw only a bare pipe error with no visible cause.
> Fixed: `sanitizeSegment` (`snapshot-renderer.service.ts` + its mirrored copy in
> `l3-card-renderer.ts`) now mangles reserved-device-name segments; `runFastImport` now handles the
> `child.stdin` error gracefully so any future fast-import rejection surfaces as a normal
> `DocuviaError` instead of crashing. Reverified against this session's own leftover `moby`
> database (136,329 nodes / 157,139 edges) — packs successfully, no crash.
>
> First seen 2026-07-29 (TypeScript pass, `vscode`, 288,726 nodes) as follow-up work item 1; second
> reproduction 2026-08-03 (Go pass, `moby`, 136,329 nodes) is what finally supplied the real,
> reproducible trigger.

### 19. Go same-package, no-import cross-file `calls` edges are never persisted — `ScopeResolver.resolveCall()` has no Go-package-aware branch

Found 2026-08-04 while investigating a topology-collapse symptom flagged in the Go benchmark pass
(full detail: [`go-cli-benchmark.md`](../../cli-test-analysis/go-cli-benchmark.md) §1.5, summary in
[`README.md`](../../cli-test-analysis/README.md) §3.3 item 7): `moby`'s `export-topology
--collapse=auto` degenerating to `"Links: 1"` was suspected to be a topology-folding bug. A real
bug _was_ found and fixed there — [`topology-builder.service.ts`](../../../lib/core/src/topology/topology-builder.service.ts)'s
`buildCollapsed` resolved a link endpoint's owning file via a single-hop `containingFileId` lookup,
silently dropping the link for a 2+-level `CONTAINS` chain (e.g. `file → class → method`); `toFileId`
now walks the full ancestor chain, with a cycle guard, regression-tested — but that fix is defensive
correctness, not the cause of `moby`'s own number.

**Traced to** [`scope-resolver.ts`](../../../lib/core/src/graph/scope-resolver.ts):
`ScopeResolver.resolveCall()` only resolves (1) a same-file local, or (2) an explicitly-`import`ed
name via JS/TS-shaped module-path resolution (`resolveModulePath`) — no branch exists for Go's
idiomatic same-package, no-import cross-file call convention. Live-verified via real AST parsing +
persistence against a synthetic 2-file Go fixture (`a.go: func Foo(){}` / `b.go: func Bar(){
Foo() }`, no import): the AST layer correctly _extracts_ the `Bar → Foo` call site
(`sourceFunction: "Bar", targetFunction: "Foo"` in `buildParseResponse`'s output), but `resolveCall`
returns `null` and `linkSymbolReference()` never inserts the `calls` row into `node_links` at all.
Locked in as a permanent regression-documenting test:
`persist-ast-graph.unit.test.ts`'s `"KNOWN GAP: a same-package, no-import Go cross-file call is
never persisted as a 'calls' link"`.

**Blast radius wider than the topology view alone**: since these edges are never written to the
graph in the first place (not folded away by any downstream heuristic — never persisted to begin
with), this also thins out `query`/`impact` results for Go same-package calls, anywhere Go code
calls a sibling-file, same-package function/method without an explicit import. `moby`'s
`export-topology --collapse=auto` `"Links: 1"` symptom is expected to still reproduce essentially
unchanged for this reason — not re-tested this pass, no updated number claimed.

**Status: not fixed.** Needs a Go-package-aware resolution branch in `ScopeResolver` (e.g.
same-directory/same-`package`-declaration siblings) — its own future pass, not scoped here.

### 20. TypeScript `abstract class` declarations were never extracted into the knowledge graph

> **Fixed 2026-08-05.** `export abstract class Foo {}` parses as tree-sitter's own distinct
> `abstract_class_declaration` grammar node — not a modifier flag on `class_declaration` — and
> [`typescriptConfig`](../../../lib/plugins-ast/src/languages/typescript.ts)'s `classes` fallback
> array and compiled `queries.classes` string enumerated only `class_declaration`/
> `interface_declaration`/`enum_declaration`/`type_alias_declaration`; `abstract_class_declaration`
> was referenced nowhere else in the codebase. Every `export abstract class` in any TS/TSX file, in
> any repo Docuvia2 indexes, was silently missing from the knowledge graph entirely — not
> mis-ranked, not folded away, never a node. Confirmed live: direct SQLite inspection of a
> freshly-built `vscode` `local.db` showed zero node named `Disposable` for
> `src/vs/base/common/lifecycle.ts`, even though every other class in that file (123 nodes total)
> extracted correctly. Fixed by adding `ABSTRACT_CLASS_DECLARATION: "abstract_class_declaration"`
> ([`tree-sitter-node-types.ts:17`](../../../lib/plugins-ast/src/constants/tree-sitter-node-types.ts))
> and wiring it into both the `classes` fallback array and the compiled query in
> [`typescript.ts`](../../../lib/plugins-ast/src/languages/typescript.ts), mirroring
> `CLASS_DECLARATION`'s existing pattern. New regression test in
> [`ast-worker.fixture.unit.test.ts:485-519`](../../../lib/core/src/ast/ast-worker.fixture.unit.test.ts),
> verified via actual revert-and-rerun by both the implementer and, independently, `task-verifier`.
> Retroactively reframes every prior "`Disposable` resolves to the wrong node" finding in
> `typescript-cli-benchmark.md` (its §1/§4/§6.2) — the real class was never a resolution candidate
> to begin with, so that doc's already-shipped `findNodeByName` ranking fix (its §5.4) alone could
> never have found it. Only TypeScript was fixed/verified this pass — whether other languages'
> own `abstract class` grammar shapes share an analogous gap is unverified, flagged as a candidate
> follow-up, not assumed broken.

Found 2026-08-05 during a `vscode` re-verification pass — full detail in
[`typescript-cli-benchmark.md`](../../cli-test-analysis/typescript-cli-benchmark.md) §8.1, summary
in [`README.md`](../../cli-test-analysis/README.md) §3.2 item 6.

**Status: fixed 2026-08-05** (see the note at the top of this item) — was: not fixed, every
`abstract class` in any TypeScript repo silently absent from the graph with no error or warning.

### 21. Failed git-knowledge-branch pack + the very next ordinary read command silently destroys the whole local graph

> **Fixed 2026-08-05.** The single most severe bug found across this entire benchmark series —
> worse than item 18's crash above (at least a crash is visible) and worse than
> [`typescript-cli-benchmark.md`](../../cli-test-analysis/typescript-cli-benchmark.md) §6.3's
> already-fixed backward-`HEAD` delta-ingestion bug (which needed a deliberate `git reset --soft`):
> this one needs nothing unusual at all — an ordinary `init` on a large repo, one environmental
> hiccup in a best-effort background step, then one ordinary `status` call, and the entire graph is
> gone with no warning. Fixed via a 3-layer guard that respects the existing "git branch is the
> durable source of truth, `local.db` is an ephemeral rebuildable cache" architecture
> ([STOR-001](../adr/storage/STOR-001-git-branch-source-of-truth.md)/
> [STOR-002](../adr/storage/STOR-002-sqlite-ephemeral-query-engine.md)) rather than contradicting
> it: (1) a same-workspace "pending knowledge-branch write" meta flag
> (`META_KEY_KNOWLEDGE_PACK_PENDING`,
> [`git-constants.ts:118`](../../../lib/core/src/git/git-constants.ts)) set/cleared around the pack
> call ([`pack-current-graph.ts:52,58`](../../../lib/ui-core/src/workflows/snapshot/pack-current-graph.ts)),
> checked by `hydrate()`'s new `checkDestructiveRebuildGuard`
> ([`hydration.service.ts:215`](../../../lib/core/src/git/hydration.service.ts)) before rebuilding;
> (2) a magnitude-based catastrophic-shrink guard inside the same method as a cause-agnostic safety
> net (refuses when incoming data would represent a drastic drop from current, above a node-count
> floor); (3) `markSynced()` reordered to run _after_, not before, the pack attempt in both
> [`init-workflow.ts:174`](../../../lib/ui-core/src/workflows/init/init-workflow.ts) and
> [`run-full-ingestion.ts:112`](../../../lib/ui-core/src/workflows/analyze/run-full-ingestion.ts) —
> a second, independent contributing bug found while building this fix, where even a _successful_
> pack could leave the next read command seeing a false staleness mismatch; plus (4) a new `docuvia
hydrate --force`/`-f` escape hatch ([`cli.ts:173-175`](../../../artifacts/cli/src/cli.ts)) for when
> a destructive rebuild is genuinely wanted. A related bug surfaced while building this fix's own
> real-repo integration test: `SnapshotWorkflow` opened its store `readonly: true`, which would have
> thrown the moment the new pending-flag write tried to run during a real `snapshot` — fixed
> alongside (`readonly: false`, renamed `openStoreForSnapshot`,
> [`snapshot-workflow.ts:39-44`](../../../lib/ui-core/src/workflows/snapshot/snapshot-workflow.ts)),
> verified safe against both existing concurrency-gate integration tests
> (`analyze-snapshot-concurrency.test.ts`, `doctor-hydrate-concurrency.test.ts`).

Found 2026-08-05 during a `vscode` re-verification pass — full detail in
[`typescript-cli-benchmark.md`](../../cli-test-analysis/typescript-cli-benchmark.md) §8.2, summary
in [`README.md`](../../cli-test-analysis/README.md) §3.2 item 6: `docuvia init` against `vscode`
succeeded — Tier A ingestion completed, `local.db` had 292,770 L2 nodes / 379,776 edges (confirmed
via direct SQLite query) — but the git-knowledge-branch pack step at the end of `init` failed
(`git fast-import` exited with Windows `STATUS_DLL_INIT_FAILED`/`0xC0000142`, plausibly
environmental, not confirmed root-caused further); `init` still reported success (the pack failure
is designed to be non-fatal). Running two completely ordinary read commands afterward — `docuvia
status`, `docuvia query "Disposable"` — silently wiped `local.db` back to 0 nodes / 0 edges,
confirmed via direct SQLite query before and after.

**Traced to** every read-path command calling `ensureHydrated()`
([`ensure-hydrated.ts:20`](../../../lib/ui-core/src/utils/ensure-hydrated.ts)), which calls
`HydrationService.isStale()`
([`hydration.service.ts:238`](../../../lib/core/src/git/hydration.service.ts)) — a bare sha
comparison between `local.db`'s recorded last-synced knowledge-branch tip and the branch's actual
current tip. Since the pack failed, the branch never advanced, so this read as "stale," triggering
`hydrate()` — explicitly documented in-code as "rebuild-not-upsert, per STOR-002" — which reads
whatever the (unchanged, pre-pack-attempt) git branch has and unconditionally replaced `local.db`'s
graph tables via `bulkLoadGraph()`. Since that branch had zero committed graph data for this
workspace (the only pack attempt failed), the "rebuild" replaced 292,770 real nodes with 0.

Verified: new integration test
([`hydrate-pack-failure-data-loss-guard.integration.test.ts`](../../../artifacts/cli/test/integration/hydrate-pack-failure-data-loss-guard.integration.test.ts))
using a real temp git repo/`GraphStore`/`GitLocalProvider` reproduces the exact bug mechanics and
asserts node count is preserved. Independently re-verified by `task-verifier`, which also
independently confirmed the guard is load-bearing (bypassing it via the sanctioned `force: true`
path reproduced the original 100%-data-loss failure exactly). Full workspace: 160 test files / 1167
tests passing. One non-blocking gap noted by `task-verifier`: the CLI-level `--force` flag itself
and the "refused" message path have no dedicated test (the underlying logic is tested one layer
down) — worth a follow-up.

**Status: fixed 2026-08-05** (see the note at the top of this item) — was: not fixed, an ordinary
`init` + one background-step environmental hiccup + one ordinary read command could silently
destroy an entire local knowledge graph with no warning surfaced to the user.

### 22. `docuvia query`'s keyword search can't substitute for Read/Grep/Glob during exploratory work

> **Shipped — 2026-08-05.** `query`/`impact` results now carry a `matchType: "exact" | "keyword" |
"neighbor"` field, surfaced as `match_type="..."` in `--format=prompt` XML and a human-readable
> hint in CLI output (`lib/contracts/src/interfaces/query.interfaces.ts`,
> `lib/core/src/query/query.service.ts`, `artifacts/cli/src/commands/query.ts`). AGENTS.md/CLAUDE.md/
> `.github/copilot-instructions.md` (and their shared `docuvia init` template,
> `artifacts/cli/src/constants/init-templates.ts`) gained a 4th fallback trigger: a non-`exact`
> match_type on what should be a well-known symbol/file. Live-reconfirmed against the original 5
> comparison-table cases: `queryCommand` → `match_type="exact"`; `"query command"` → still the same
> wrong single hit, now visibly `match_type="keyword"`; `"cli commands list"` → `match_type="keyword"`;
> `docuvia-api` → `match_type="exact"`. The underlying matching algorithm itself is unchanged (still
> can't find `query.ts` from a concept phrase) — the fix makes the _confidence_ of a wrong/incomplete
> result visible so the fallback policy can catch it, not the matching itself smarter.

Exact symbol name lookups work well (return a real call graph, better than grep for that case).
AGENTS.md's "Docuvia-First Development Workflow (Mandatory)" section already documents three
fallback-to-Grep/Glob/Read triggers (empty or `tier_b_status="unprocessed"` result; exact source
text/formatting/diff needed; a dependency `impact` can't detect), and an empty-result failure mode
(free-text/comment search, a naming-style mismatch) correctly trips that policy. The surviving gap
is narrower: a concept-phrase query and a directory-style enumeration request each return a
non-empty, not-flagged-unprocessed result that is nonetheless wrong or incomplete — neither
condition trips any of the three documented triggers, so an agent following the current policy to
the letter would trust a wrong/incomplete answer as final rather than falling back. Full detail:
`docs/cli-test-analysis/docuvia-self-verification-2026-08-05.md`.

### 23. No first-class visibility into Tier B coverage breadth — `doctor` gives false confidence

> **Shipped — 2026-08-05.** `docuvia status` and `docuvia doctor` both now report Tier B coverage as
> a first-class metric (`lib/ui-core/src/workflows/status/status-workflow.ts`,
> `lib/ui-core/src/workflows/doctor/doctor-workflow.ts`'s new `tier_b_coverage` diagnostic, `FAIL`
> below a 50% threshold via `DEFAULT_TIER_B_COVERAGE_FAIL_THRESHOLD`). Live-verified against this
> repo's real database: `status`/`doctor`/`query`'s independent unprocessed-note all agreed exactly
> (74/484 processed, 15.3%) at verification time — `doctor`'s overall pass count correctly dropped to
> reflect the real gap instead of staying all-green. The underlying backlog itself is unchanged
> (still gated by the existing, correct-as-documented commit-cap throttle, item 15) — this fix is
> visibility only, not a change to how fast Tier B actually drains.

410 of 484 tracked files (84.7%) in Docuvia2's own repo have never been Tier B-processed (confirmed
via a note embedded in `query` output, reproduced across two unrelated queries) — down from 422/484
at initial test time, confirmed to move after a real `docuvia analyze --escalate-to-lsp` batch run
in the same session, i.e. a real, large, moving-but-slow backlog, not a stuck counter. `doctor`'s
`tier_b_commit_cap` check is hardcoded to always report `PASS` (see item 15 — that design decision
is correct on its own terms) but neither it nor anything else surfaces the actual "% of repo ever
Tier-B processed" figure as a first-class metric; it's only discoverable as an incidental note
inside individual `query` responses with zero incoming edges. Full detail:
`docs/cli-test-analysis/docuvia-self-verification-2026-08-05.md`.

### 24. Tier C's queue is permanently head-of-line-blocked by two always-first, always-failing items

> **Shipped — 2026-08-05, two fixes.** (1) `lib/ui-core/src/workflows/analyze/run-tier-c-drain.ts`/
> `tier-c-queue.ts`: a permanently-failing queue item is now evicted after
> `DEFAULT_TIER_C_MAX_ITEM_FAILURES` (3) consecutive failures instead of blocking every item behind
> it forever. (2) The actual root cause of every prior failure, found live-verifying fix (1):
> `lib/llm-api/src/fetch-llm-client.ts` built the chat-completions URL as
> `baseUrl + "/v1/chat/completions"` unconditionally, doubling to `.../v1/v1/chat/completions` (404)
> whenever `baseUrl` already ended in `/v1` — this environment's real
> `AI_DOCUVIA_INTEGRATIONS_OPENAI_BASE_URL=https://openrouter.ai/api/v1` always did, so 100% of Tier
> C LLM calls had failed since this repo's inception, misclassified as `bridge-unreachable`. New
> `buildCompletionsUrl()` strips a trailing `/v1` before appending the path. Live-verified: `docuvia
status`'s `L3 Decisions` moved from 0 (this repo's entire history) to a real positive count for the
> first time, confirmed via `.docuvia/logs/analyze.log`'s `analyze.tierC.item_success` events, across
> multiple real `docuvia analyze --escalate-to-lsp` runs.

Root-caused via `.docuvia/logs/analyze.log`, not yet fixed: Tier C's queue holds 673 real candidates
(growing from 662 the previous day), but every `analyze --escalate-to-lsp` run attempts the queue in
a fixed order and the same two items are always first — one fails `no-anchor` (target
`a489345b87c15611bfbe8062d0f74d35b6dc6753`, its changed files have no matching L2 node), the other
fails `bridge-unreachable` (target `240f96ee1648e2b81033951f149b77920faaf5ce`) — reproduced
identically across two `analyze` runs 18 hours apart, so deterministic, not a transient outage. In
[`run-tier-c-drain.ts`](../../../lib/ui-core/src/workflows/analyze/run-tier-c-drain.ts), a
`bridge-unreachable` outcome makes `handleTierCItemOutcome` stop the whole drain loop (`return
outcome.reason === TierCFailReasons.BRIDGE_UNREACHABLE`), and `removeTierCQueueEntries` (dequeue)
only ever runs on the `outcome.success` branch — a failed item is never removed from the queue. The
combination is a permanent head-of-line block: the loop stops at 2/20 items attempted, the failing
item is never dequeued, so it re-fails identically and blocks the same way on every future run, and
the other 671+ queued candidates behind it can never be reached regardless of queue growth or run
count — fully explaining `docuvia status`'s 0 L3 decisions despite a reachable, correctly-configured
LLM endpoint. Full detail: `docs/cli-test-analysis/docuvia-self-verification-2026-08-05.md`.

### 25. Follow-up from item 22: `query`'s actual keyword/FTS matching quality is still unimproved

Item 22's fix (`matchType`) only makes an agent able to _tell_ a match is low-confidence — it does
not make the match itself better. `docuvia query "query command"` still resolves to the wrong file
(`artifacts/cli/src/utils/init-command-lock.ts` instead of `artifacts/cli/src/commands/query.ts`),
now correctly labeled `match_type="keyword"` instead of looking as confident as an exact hit, but
still wrong. `lib/core/src/query/query.service.ts`'s FTS ranking (`store.fts.searchL2Nodes`/
`searchL3Nodes`) has no synonym/token-expansion step and no fallback strategy when the top FTS hit
scores far below an exact match would — a concept phrase composed of common words (e.g. "query",
"command") can outrank the actual target file if the target's own indexed name/description happens
to share fewer of those tokens than an unrelated file does. Two other numeric thresholds introduced
alongside items 23/24 are similarly unvalidated placeholders, each already flagged inline where they
live rather than needing a separate item here:
`DEFAULT_TIER_B_COVERAGE_FAIL_THRESHOLD` (`git-constants.ts`, 0.5) and
`DEFAULT_TIER_C_MAX_ITEM_FAILURES` (`git-constants.ts`, 3) — both have a doc comment noting they're
untuned, re-tune if real usage shows either is off. Not scheduled; no measured pain trigger exists
yet for any of the three (the concrete re-entry-trigger pattern items 9/17 already use) — parking
here rather than speculatively redesigning the ranking algorithm now.

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
