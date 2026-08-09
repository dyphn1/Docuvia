# Go (Golang) CLI Benchmark & AST Analysis Report

**Test targets:**

- `moby/moby` — HEAD `c5b8ce9274` (13,121 tracked files / 10,546 `.go`: 2,206 first-party + 8,340 vendored)
- `gin-gonic/gin` — HEAD `73726dc6` (130 tracked files / 98 `.go`, no vendoring)

**Subject under test:** Docuvia2 (Tier A local ingestion + Tier B LSP escalation via `gopls`) vs. GitNexus, Graphify, and Code-Review-Graph (CRG) on the same two repos.

**Last updated:** 2026-08-04

---

## Methodology

- Chosen symbol per repo: `Container` (`daemon/container/container.go:70`) for moby — deliberately also a naming-collision stress test (`type Container struct` is declared 6 times across the tree, 5 in `vendor/`, and the bare label collides with dozens of unrelated symbols); `Context` (`context.go:61`) for gin — gin's central, most-referenced struct.
- All four tools were built fresh from an isolated `git worktree` per tool rather than the primary dev checkouts, so each tests its actual current local source instead of a possibly-stale globally-installed package.
- `gin` ran first as a fast pipeline-validation pass before committing to `moby`'s much longer run; both are reported below in target-project order (`moby` first).
- Out of scope: LLM-gated features (Docuvia2 L3 extraction, `graphify label` community naming, GitNexus/CRG wiki generation) and Remote Sync & Git Integration (no credentials configured) — not tested for any tool, either repo.
- Findings that turned out **not** to be Go-specific (general GitNexus/Graphify/CRG behavior) have been moved to [`README.md`](./README.md) §4.

---

## 1. `moby/moby` Benchmark

### Indexing & Analysis

| Metric     | Docuvia2 | Docuvia2 (+LSP)        | GitNexus  | Graphify  |   CRG    |
| :--------- | :------- | :--------------------- | :-------- | :-------- | :------: |
| Nodes      | 136,333¹ | 136,333 (same)         | 32,736    | 168,479   |  18,309  |
| Edges      | 192,878¹ | 310,998 (185,230 LSP)⁴ | 122,823   | 373,185   | 218,718  |
| Build time | 61.9 s¹  | multi-batch³           | ~6.6 min² | ~19.6 min | ~9.7 min |

¹ Fresh Tier-A re-ingest 2026-08-09 (see [Session History](#session-history)) after deleting the stale `docuvia-knowledge` snapshot branch to defeat stale-cache hydration: **136,333 nodes / 192,878 edges (67,108 calls / 125,769 contains) / 61.9 s wall-clock from a pristine DB**, vs. the 2026-08-04 snapshot of **136,329 / 157,139 / ~22.1 min**. The node delta (+4) and edge delta (+35,739) reflect AST-pipeline improvements between the two runs (GRPH-006 containment/key work landed in `persist-ast-graph`); the build-time drop (22.1 min → 61.9 s) additionally reflects the omission of the git-history ingestion step the 2026-08-04 figure included — same-build, different-baseline, so treat the build-time drop as a partial/hardware-bound comparison, not 1:1. 8 oversized generated files (`.pb.go`, `zerrors_windows.go`, etc.) were skipped by the size gate.
² GitNexus self-reported 209.6s; directly-measured wall-clock was 395.5s — see [README §4.2](./README.md#42-gitnexus).
³ Docuvia2's Tier B ran on this same DB via 7 batched `analyze --escalate-to-lsp` invocations (each capped at the `--lsp-timeout` deadline), vs. the single 120s batch shown for `gin` (§2). Throughput behavior, tracked separately in #11 — not a correctness property.
⁴ **8,905/10,562 files processed (84.3%), 185,230 calls + 125,769 contains + 1 extends persisted** (`main` + `fix/go-method-edge-keys` PR #21). The 1,657 unprocessed files are macOS-unloadable (linux/windows build-tag, `_test`-only, or `ssd.py`-style paths) — gopls returns `no package metadata` for them; a 7th batch added 0 edges. Since the permanent-failure re-try fix (PR #24, issue #22 split 1) these are classified `retryable: false` and dropped from the re-queued `failedEntries` (stamped `markTierBProcessed`), so no future batch burns its budget re-attempting them (see §2 footnote ¹ and [Session History](#session-history)).

- CRG: vendor-excluded by default (2,340 files parsed vs. 10,546 total `.go` files) — see [README §4.4](./README.md#44-code-review-graph-crg).
- Graphify: 168,479 nodes includes vendored code (10,717/11,516 code files scanned).

### Query, Visualization & Impact

| Metric                 |      Docuvia2 | GitNexus | Graphify |     CRG |
| :--------------------- | ------------: | -------: | -------: | ------: |
| `query` time           |         1.7 s |    4.4 s |   16.8 s |  0.6 s³ |
| `impact` time          |         1.1 s |    4.7 s |   1.4 s⁴ |   1.0 s |
| `impact` — files/nodes |             1 |      142 |      12+ |   9,174 |
| `export-topology` time | 8.7 s / 5.7 s |      N/A |   4.2 s⁵ | 25.7 s⁶ |

³ Bare-label `query` returned 20 candidates without the real match among them; the qualified re-run (0.6s) found 7 real callers — see [README §4.4](./README.md#44-code-review-graph-crg).
⁴ Graphify's `affected` on the exact node ID, not the bare label (bare-label resolution mismatched across commands — see [README §4.3](./README.md#43-graphify)).
⁵ `graphify tree` → 6.30 MB HTML.
⁶ CRG `visualize` → HTML export.

- Docuvia2 `query`/`impact` resolved `Container` correctly to the real struct, single unambiguous module — but with no `<incoming>`/`<outgoing>` edges (same Tier-B-scoped thinness the TypeScript pass root-caused).
- `export-topology`: 8.7s for the default collapsed view (10,562 nodes, **Links: 1** — see [Open Findings](#open-go-specific-findings) #1), 5.7s for `--collapse=symbol` (full 136,329/157,139, matches raw).
- GitNexus: Risk HIGH.
- Graphify: `query`/`explain` each resolved the bare label `"Container"` to a different wrong node (neither the real struct) — see [README §4.3](./README.md#43-graphify).

---

## 2. `gin-gonic/gin` Benchmark

### Indexing & Analysis

| Metric     | Docuvia2 | Docuvia2 (+LSP)          |  GitNexus | Graphify |    CRG |
| :--------- | -------: | :----------------------- | --------: | -------: | -----: |
| Nodes      |   1,609³ | 1,609 (same graph)       |     2,705 |    1,735 |  1,607 |
| Edges      |    2,246 | 2,246 + 2,780 corrected¹ |     6,671 |    3,998 | 17,530 |
| Build time |   14.2 s | ~128 s (98-file batch)   | ~4.6 min² |   19.1 s | 77.3 s |

¹ Tier B (LSP escalation): **93/98 files processed, 2,780 corrected edges applied** — re-run 2026-08-09 with the receiver-method node_key fix (PR #21), up from 804 corrected edges in the 2026-08-04 run after the base-class capability fix; the +1,976 delta is exactly the receiver-method edges that were previously silently dropped for landing on mismatched keys. The 5 unprocessed files (`context_appengine.go`, `binding_nomsgpack.go`, `codec/json/{go_json,jsoniter,sonic}.go`) are **permanently failed** on macOS (build-tag `no package metadata`) — since the permanent-failure re-try fix (PR #24, issue #22 split 1) they are classified `retryable: false`, dropped from `tierBBatchPending.remainingQueue` (re-run measured `remainingQueue: []`), and stamped `markTierBProcessed` instead of being re-attempted on every batch. See [Session History](#session-history).
² GitNexus self-reported 132.9s; directly-measured wall-clock was 278.3s (~2.1x gap) — see [README §4.2](./README.md#42-gitnexus).
³ Fresh Tier-A re-ingest 2026-08-09 against a pristine DB (stale `docuvia-knowledge` snapshot branch deleted): **1,609 nodes** re-confirmed — matches the 2026-08-04 figure. The pre-LSP edge column retains the 2026-08-04 number because the fresh run's receiver-method-edge gains all landed on the +LSP side (footnote ¹); the Tier-A-only edge count was not separately re-measured this session.

- Graphify: 117 communities. CRG: 144 communities (full postprocess including `igraph`/Leiden — see [README §4.4](./README.md#44-code-review-graph-crg)).
- Tier B's `supportsQualifiedContainment` stays `false` for Go — verified live against gopls v0.23.0 (2026-08-04): gopls doesn't nest a receiver method under its struct in `documentSymbol`, and reports the struct's own kind as `Struct` (23) not `Class` (5). Confirmed-correct current state, not a bug.

### Query, Visualization & Impact

| Metric                 | Docuvia2 | GitNexus | Graphify |    CRG |
| :--------------------- | -------: | -------: | -------: | -----: |
| `query` time           |    1.3 s |    6.0 s |    1.7 s | 1.3 s¹ |
| `impact` time          |    1.2 s |    6.0 s |   1.4 s² |  1.6 s |
| `impact` — files/nodes |        1 |        6 |        — |    150 |
| `export-topology` time |    1.3 s |      N/A |   1.4 s³ | 2.2 s⁴ |

¹ Bare-label `query` returns 20 ambiguous candidates; qualified re-run (1.3s) → 7 real callers.
² Graphify's `explain` (not `affected` — bare-label `affected` fails on this repo too, see [README §4.3](./README.md#43-graphify)); degree 154.
³ `graphify tree` → 109.6 KB HTML. ⁴ CRG `visualize` → HTML export.

- Docuvia2 `query`: resolves correctly to `context.go`, but `<l2_module>` has no incoming/outgoing edges — same Tier-B-scoped thinness noted for `moby` above. `impact`: Risk MEDIUM.
- GitNexus: Risk HIGH; needs `-r gin` once more than one repo is in its global registry.

---

## Open Go-Specific Findings

1. **Go same-package, no-import cross-file calls are never persisted to the graph at all.** `ScopeResolver.resolveCall()` ([`scope-resolver.ts`](../../lib/core/src/graph/scope-resolver.ts)) only handles same-file locals or explicitly-`import`ed names — a JS/TS-shaped module-resolution model. Live-verified against a synthetic 2-file Go fixture (`a.go: func Foo(){}` / `b.go: func Bar(){ Foo() }`, no import — idiomatic same-package Go): the AST layer correctly extracts the `Bar → Foo` call site, but `resolveCall` returns `null`, so the `calls` edge is never written to `node_links`. This is the actual driver of `moby`'s `export-topology` `Links: 1` degeneracy above — not a topology-folding bug (a real single-hop `containingFileId` bug in `TopologyBuilderService` was found and fixed alongside this investigation, but it wasn't the cause here). Since these edges are never persisted in the first place, this also thins out `query`/`impact` results for any Go same-package call — a materially bigger, higher-blast-radius gap than the topology view alone. Regression-documented (`persist-ast-graph.unit.test.ts`, `"KNOWN GAP: ..."`), tracked as [`roadmap-and-open-items.md` item 19](../gitbook/analysis/roadmap-and-open-items.md). **Not fixed.**
2. **Tier B's behavior on a repo `moby`'s size — CONFIRMED on 2026-08-09 (resolved).** The capability fix plus the receiver-method node_key alignment (defined on [PR #21](https://github.com/dyphn1/Docuvia/pull/21)), verified live: **8,905/10,562 files processed (84.3%), 185,230 cross-file `calls` edges applied**, receiver-method edges (`RouterGroup.GET`-style `file#Recv.Method` keys) confirmed landing in `node_links`. The remaining 1,657 files return `no package metadata` from gopls on macOS (linux/windows build-tags, `_test` files, and `.py`), confirmed by a 7th batch that produced 0 corrected edges — a platform residue, not a graph bug. As of the permanent-failure retry fix (PR #23, from [issue #22](https://github.com/dyphn1/Docuvia/issues/22)), those `no package metadata` files are classified `retryable: false` and dropped from the re-queued `failedEntries` (stamped `markTierBProcessed` instead), so a re-run batch no longer burns time on them — see Session History.

---

## Session History

- **2026-08-03**: both `gin` (fast pipeline validation) and `moby` (full run) benchmarked across all 4 tools, in isolated per-tool worktrees. Docuvia2's Tier B was exercised against `gin` (gopls prepped specifically for this pass) and found effectively non-functional (95/98 files failing).
- **2026-08-04**: root-caused and fixed the Tier B capability-negotiation bug (finding #2 above); root-caused and fixed a git-knowledge-branch pack-step crash on `moby` (same failure shape as the vscode pass — a Windows-reserved-device-name path segment plus an unhandled `child.stdin` error, see `typescript-cli-benchmark.md`) and a `maxBuffer` scale bug in `git ls-files -s` discovery; hardened `TopologyBuilderService`'s multi-hop containment resolution (a real but secondary fix, not the root cause of finding #1); live-verified `supportsQualifiedContainment` should stay `false` for Go against real gopls.
- **2026-08-09**: fixed the receiver-method node_key misalignment (gopls names `documentSymbol` methods `(Recv).Method` but Tier A keys them `Recv.Method`; Tier B was emitting `file#(Recv).Method`, so `findNodeIdByNodeKey` never matched and every cross-file Go method edge was silently dropped). Added `normalizeSymbolName` per-language hook to `LspLanguageConfig` + `normalizeGoSymbolName` (PR #21, both based on `fix/11`). Re-ran both targets with a fresh build: `gin` now applies **2,780 corrected edges** (vs. 804 pre-fix — the gap is exactly the previously-dropped method edges) and `moby` had its Tier B run **for the first time at full scale** (8,905/10,562 files, 310,998 total links including 185,230 calls) — closing the gap that was finding #2. macOS build-tag residue (linux/windows/`_test`/`.py` files) is the only remainder: gopls returns `no package metadata` for those on macOS, and a re-run batch produces 0 additional edges.
- **2026-08-09 (Tier A re-verification)**: goal was a fresh Tier-A re-ingest of `moby` to confirm the 2026-08-04 figure wasn't stale. First attempts were **masked by stale-cache hydration**: `docuvia init`/`analyze` re-hydrated the old graph from the hidden `docuvia-knowledge` snapshot branch (any `init` pack re-creates the branch), returning a full 136k-node graph in ~2 s without parsing — the earlier "already up to date" no-op and the surrogate 136,329-node DB were both this branch, not a fresh run. Deleting `refs/heads/docuvia-knowledge` + `.docuvia/` before `init` forced a real parse: **136,333 nodes / 192,878 edges (67,108 calls / 125,769 contains / 1 extends) / 61.9 s wall-clock**, vs. the 2026-08-04 snapshot's **136,329 / 157,139 / ~22.1 min**. Node delta (+4), edge delta (+35,739), and the build-time drop (22.1 min → 61.9 s) reflect AST-pipeline improvements (`persist-ast-graph`, GRPH-006 containment/key work) plus the old figure's inclusion of git-history ingestion — treat build-time as same-build-different-baseline. `gin`'s fresh Tier A re-confirmed **1,609 nodes** exactly. Method: `git branch -D docuvia-knowledge && rm -rf .docuvia && /usr/bin/time docuvia init`.
- **2026-08-09 (permanent-failure re-try fix)**: from [issue #22](https://github.com/dyphn1/Docuvia/issues/22)'s batch-timeout analysis — `moby`'s 7th batch burned its full 20-min budget for **0 new edges** because the 1,657 macOS-unloadable files (`no package metadata`) were re-queued on every batch forever (`run-tier-b-batch.ts` staged every non-`filesProcessed` file back into `tierBBatchPending.remainingQueue`, with no per-file failure accounting). Fixed by classifying per-file LSP failures: `retryable: false` (a definitive error like `no package metadata`; the LSP server will never load that file) vs. retryable (whole-batch timeout cut the file's turn short, or it was never reached before the deadline). Permanent failures are now **dropped from the re-queued `failedEntries` and stamped via `markTierBProcessed`** (treated as Tier-B-tried, so `doctor`'s coverage counts stop reporting them as "never attempted"), and the batch summary/JSONL logs report `filesFailedPermanent` separately from retryable `filesFailed`. Re-verified live on `gin` (98 `.go` files): **93 processed / 2,780 corrected edges / 5 permanently failed** (`context_appengine.go`, `binding_nomsgpack.go`, `codec/json/{go_json,jsoniter,sonic}.go`), with `tierBBatchPending.remainingQueue` coming back **empty** — the 5 `no package metadata` files no longer re-queue for the next batch. All 1,272 unit/integration tests green. See PR #23.

For full per-session detail, see this file's git history (`git log -- docs/cli-test-analysis/go-cli-benchmark.md`) and [`README.md`](./README.md) §3.3/§4 for the cross-tool findings extracted from these sessions.
