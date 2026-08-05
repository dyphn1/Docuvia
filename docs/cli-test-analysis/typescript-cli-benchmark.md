# TypeScript CLI Benchmark & AST Analysis Report

**Test targets:**

- `microsoft/vscode` — HEAD `1b6a1881` (16,646 tracked files / 11,636 `.ts`)
- `nestjs/nest` — HEAD `dfaa3761` (2,127 tracked files / 1,675 `.ts`)

**Subject under test:** Docuvia2 (Tier A local ingestion + Tier B LSP escalation) vs. GitNexus, Graphify, and Code-Review-Graph (CRG) on the same two repos.

**Last updated:** 2026-08-05

---

## Methodology

- Chosen symbol per repo: `Disposable` (`src/vs/base/common/lifecycle.ts:526`, 1,978 files reference the name) for vscode; `Injectable` for nest — both central, highly-referenced base symbols, used consistently across `query`/`impact`/`context` rows.
- Every number below is a directly-measured value (timestamps, exit codes, real command output, or a direct SQLite query against the tool's own DB when its summary omits a figure) — not an estimate.
- Out of scope throughout: LLM-gated features (Docuvia2 L3 decision extraction, `gitnexus wiki`, Graphify's semantic layer) and Remote Sync & Git Integration (no credentials configured in this environment) — not tested for any tool, either repo.
- Numbers reflect the latest verified run for each tool; where a tool was re-verified across multiple sessions, only the final figures are shown. Full session-by-session history: see [Session History](#session-history) below and `git log` on this file.

---

## 1. `microsoft/vscode` Benchmark

### Indexing & Analysis

| Metric     | Docuvia2 | Docuvia2 (+LSP) |  GitNexus | Graphify |       CRG |
| :--------- | -------: | :-------------- | --------: | -------: | --------: |
| Nodes      |  293,307 | —               |   274,439 |  116,719 |   231,462 |
| Edges      |  381,206 | —               | 1,065,266 |  185,695 | 1,593,664 |
| Build time |  ~55 min | untested¹       | ~17.5 min |    ~69 s |  ~7.3 min |

¹ Tier B was never verified end-to-end on this vscode clone: `typescript-language-server` failed its initialize handshake because this benchmark clone's own `node_modules`/`typescript` were never installed (all 8 configured languages failed for various reasons; only 4/12,338 files attempted, 0 edges applied). See [Open TypeScript-Specific Findings](#open-typescript-specific-findings).

- Graphify: community detection N/A (`graspologic` doesn't install in this environment); structural build only.
- CRG: full postprocess completed (signatures + FTS + flows + 3,786 communities), well inside its 30-min cap.
- Build-time variance: an earlier same-config Docuvia2 run on this repo completed in ~20 min instead of ~55 min with no code change — environment variance noted, not further investigated.

### Query, Visualization & Impact

| Metric                 |         Docuvia2 | GitNexus | Graphify |       CRG |
| :--------------------- | ---------------: | -------: | -------: | --------: |
| `query` time           |           2.41 s |    2.4 s |      N/A | 0.5–1.1 s |
| `impact` time          |           2.19 s |    7.9 s |      N/A |    19.5 s |
| `impact` — files/nodes |            2,617 |    8,624 |        — |    74,245 |
| `export-topology` time | 20.16 s / 7.22 s |      N/A |      N/A |       N/A |

- Docuvia2 `query`/`impact` resolved `Disposable` correctly (2,616 real `<incoming extends>` edges) — but to a legitimate vendored copy of the class, not the canonical one this benchmark targeted; see [Open TypeScript-Specific Findings](#open-typescript-specific-findings).
- `export-topology`: 20.16s for the default collapsed view (12,338 nodes / 11,998 links / 87 groups, 72,280 folded), 7.22s for `--collapse=symbol` (293,307 / 381,206, matches the raw graph).
- GitNexus: `impact` surfaced ambiguity explicitly (9 real candidates) before disambiguating to the figures above; `context` (3.0s) returned 102 real incoming caller/extends/implements entries.
- Graphify: no `query`/`impact`/`explain` CLI exists — those verbs are Claude-Code-skill-only (`skill.md`), not a standalone capability; its `to_html()` visual export also raises `ValueError` above a hard 5,000-node cap (116,719 actual).
- CRG: never surfaced the real `Disposable` class in its candidate list in either code path tried — the numbers above reflect its output, not a confirmed-correct resolution.

---

## 2. `nestjs/nest` Benchmark

### Indexing & Analysis

| Metric     | Docuvia2 | Docuvia2 (+LSP)    | GitNexus | Graphify | CRG |
| :--------- | -------: | :----------------- | -------: | -------: | --: |
| Nodes      |   16,159 | —                  |   11,979 |   14,394 | N/A |
| Edges      |   18,158 | —                  |   35,501 |   26,922 | N/A |
| Build time |   27.5 s | ~2 s (queue drain) |  173.6 s |  104.5 s | N/A |

- CRG: `build` never completed post-processing against nest across 5 attempts (~20–30 min each); raw AST parsing (1,746/1,746 files) always finished, but the pipeline then stalled indefinitely past that point.
- GitNexus: 709 clusters, 300 flows. Graphify: 1,046 communities.

### Query, Visualization & Impact

| Metric                 | Docuvia2 | GitNexus | Graphify | CRG |
| :--------------------- | -------: | -------: | -------: | --: |
| `query` time           |  0.656 s |    9.0 s |    2.1 s | N/A |
| `impact` time          |  0.668 s |    5.5 s |    0.8 s | N/A |
| `impact` — files       |        9 |      473 |        — | N/A |
| `export-topology` time |    0.7 s |      N/A |      N/A | N/A |

- Docuvia2: `impact` — Risk: HIGH. `export-topology`: 1,727 nodes / 1,221 links / 72 groups, 562 folded.
- GitNexus: `impact` — Risk: CRITICAL (byDepth 1:204, 2:184, 3:85); `query` returns loose BM25/FTS matches, not a precise symbol hit; `context` (6.4s) returns a real incoming-calls list.
- Graphify: `query` is a BFS token-budget dump with no ranked answer (expected, no LLM); `affected` (real reverse-traversal importer list) is the standalone equivalent of `impact`; `explain` (1.9s) produced the cleanest single-symbol output of the tools tested (degree 178, full connection list).
- CRG: N/A across the board — build itself never completed.

---

## Open TypeScript-Specific Findings

1. **Symbol disambiguation: vscode ships two real `Disposable` classes.** The canonical `src/vs/base/common/lifecycle.ts:526` and a vendored copy in `extensions/copilot/src/util/vs/base/common/lifecycle.ts` are both legitimate, identically-shaped `abstract class Disposable` declarations. `findNodeByName`'s ranking (by connection count, de-prioritizing test files) resolves to the vendored copy — a real, high-connectivity candidate, just not the one this benchmark has tracked since §1. Needs dedicated cross-file disambiguation, not just ranking.
2. **Tier B (LSP escalation) has never been verified end-to-end against vscode.** This benchmark clone's own `node_modules`/`typescript` were never installed, so `typescript-language-server` failed its initialize handshake on every attempted file (4/12,338 attempted, 0 corrected edges). Tier B's actual behavior at vscode's scale remains genuinely untested, not confirmed-working.
3. **AST-parse phase scales worse than file count alone predicts, and the fix's payoff is unconfirmed.** vscode's `.ts` files are 5.87x bigger by mean / 40.8x by total bytes than nest's; even after accounting for that, parsing ran ~1.7x slower than a byte-weighted projection — traced to `Language.load()` reloading each file's WASM grammar with no dispose path. A per-`wasmPath` cache was since added (`ast-worker.ts`, `32ab66a5`), but a same-repo re-measurement showed AST-parse ~9–11% slower, not faster (0 parse failures, down from 4) — the performance hypothesis remains unconfirmed.

Findings that turned out **not** to be TypeScript-specific (general Docuvia2/GitNexus/CRG behavior found during this pass) have been moved to [`README.md`](./README.md) §4.

---

## Session History

- **2026-07-28/29**: initial nest pass (all 4 tools) + a same-day follow-up fixing 3 Tier B execution bugs (queue never populated, `ADDED`-file classification, spanning-boundary semantic-diff matching).
- **2026-07-29**: vscode pass (abbreviated, cut short end-of-day) — found the Tier A git-knowledge-branch pack-step crash and the Tier B polyglot-monorepo root-marker gate; both fixed 2026-08-04.
- **2026-07-29/30**: dogfooding pass on Docuvia2's own repo — found and fixed 5 more Tier B execution bugs, root-caused the Tier B commit/delta-scoped resync gap (fixed 2026-08-04, `4013d799`, added `--full`), and found `findNodeByName`'s missing ranking (fixed 2026-08-04).
- **2026-08-04**: Docuvia2-only re-verification (vscode + nest) plus a `git reset --soft HEAD~3` probe — found and fixed a delta-ingestion bug where rewinding `HEAD` while the working tree stayed current silently dropped real files/symbols from the graph (`8600a9fa`). Also ran a read-only AST-parse performance deep-dive (see finding 3 above).
- **2026-08-05**: fresh vscode re-verification — found and fixed TypeScript `abstract class` extraction (grammar node type was never wired in, `99934dd9`) and a failed-pack-then-silent-graph-wipe bug, the most severe found across this benchmark series (`3cd9401f`).

For full per-session detail beyond this summary, see this file's git history (`git log -- docs/cli-test-analysis/typescript-cli-benchmark.md`) and [`README.md`](./README.md) §3.2/§4 for the cross-tool findings extracted from these sessions.
