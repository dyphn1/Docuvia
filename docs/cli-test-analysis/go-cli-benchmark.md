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

| Metric     |  Docuvia2 | Docuvia2 (+LSP) |  GitNexus |  Graphify |      CRG |
| :--------- | --------: | :-------------- | --------: | --------: | -------: |
| Nodes      |   136,329 | not re-run¹     |    32,736 |   168,479 |   18,309 |
| Edges      |   157,139 | not re-run¹     |   122,823 |   373,185 |  218,718 |
| Build time | ~22.1 min | —               | ~6.6 min² | ~19.6 min | ~9.7 min |

¹ Docuvia2's Tier B was not re-run against `moby`: the `gin` pass (§2) already reproduced a systemic, architecture-level LSP failure at full scale, and re-running the same (now-fixed, see [Open Findings](#open-go-specific-findings)) path against ~2,206 first-party files would only reconfirm the same result at greater cost — an explicit scoping decision, not a silent gap.
² GitNexus self-reported 209.6s; directly-measured wall-clock was 395.5s (~1.9x gap) — see [README §4.2](./README.md#42-gitnexus).

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

| Metric     | Docuvia2 | Docuvia2 (+LSP)        |  GitNexus | Graphify |    CRG |
| :--------- | -------: | :--------------------- | --------: | -------: | -----: |
| Nodes      |    1,609 | 1,609 (same graph)     |     2,705 |    1,735 |  1,607 |
| Edges      |    2,246 | 2,246 + 804 corrected¹ |     6,671 |    3,998 | 17,530 |
| Build time |   14.2 s | ~128 s (98-file batch) | ~4.6 min² |   19.1 s | 77.3 s |

¹ Tier B (LSP escalation): **92/98 files processed, 804 corrected edges applied** — current state after a base-class capability fix (`initializeSession` now declares `hierarchicalDocumentSymbolSupport: true`, fixed 2026-08-04; see [Session History](#session-history)). An earlier run, before the fix, processed only 3/98 files with 0 edges — gopls fell back to a flat symbol-range shape that made every `references` lookup land on the wrong position.
² GitNexus self-reported 132.9s; directly-measured wall-clock was 278.3s (~2.1x gap) — see [README §4.2](./README.md#42-gitnexus).

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
2. **Tier B's behavior on a repo `moby`'s size remains unconfirmed.** The capability fix that made Tier B viable for Go at all (see [Session History](#session-history)) was verified only against `gin`'s 98-file queue; it was deliberately not re-run against `moby` (table¹ above) since doing so would only reconfirm the same fix at greater cost, not learn anything new — but that also means Tier B has never actually been exercised against a Go codebase at real scale.

---

## Session History

- **2026-08-03**: both `gin` (fast pipeline validation) and `moby` (full run) benchmarked across all 4 tools, in isolated per-tool worktrees. Docuvia2's Tier B was exercised against `gin` (gopls prepped specifically for this pass) and found effectively non-functional (95/98 files failing).
- **2026-08-04**: root-caused and fixed the Tier B capability-negotiation bug (finding #2 above); root-caused and fixed a git-knowledge-branch pack-step crash on `moby` (same failure shape as the vscode pass — a Windows-reserved-device-name path segment plus an unhandled `child.stdin` error, see `typescript-cli-benchmark.md`) and a `maxBuffer` scale bug in `git ls-files -s` discovery; hardened `TopologyBuilderService`'s multi-hop containment resolution (a real but secondary fix, not the root cause of finding #1); live-verified `supportsQualifiedContainment` should stay `false` for Go against real gopls.

For full per-session detail, see this file's git history (`git log -- docs/cli-test-analysis/go-cli-benchmark.md`) and [`README.md`](./README.md) §3.3/§4 for the cross-tool findings extracted from these sessions.
