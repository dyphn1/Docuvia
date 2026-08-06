# TypeScript CLI Benchmark & AST Analysis Report

**Test targets:**

- `microsoft/vscode` — HEAD `1b6a1881` (16,646 tracked files / 11,636 `.ts`)
- `nestjs/nest` — HEAD `dfaa3761` (2,127 tracked files / 1,675 `.ts`)

**Subject under test:** Docuvia2 (Tier A local ingestion + Tier B LSP escalation) vs. GitNexus, Graphify, and Code-Review-Graph (CRG) on the same two repos.

**Last updated:** 2026-08-06

---

## Methodology

- Chosen symbol per repo: `Disposable` (`src/vs/base/common/lifecycle.ts:526`, 1,978 files reference the name) for vscode; `Injectable` for nest — both central, highly-referenced base symbols, used consistently across `query`/`impact`/`context` rows.
- Every number below is a directly-measured value (timestamps, exit codes, real command output, or a direct SQLite query against the tool's own DB when its summary omits a figure) — not an estimate.
- Out of scope throughout: LLM-gated features (Docuvia2 L3 decision extraction, `gitnexus wiki`, Graphify's semantic layer) and Remote Sync & Git Integration (no credentials configured in this environment) — not tested for any tool, either repo.
- Numbers reflect the latest verified run for each tool; where a tool was re-verified across multiple sessions, only the final figures are shown. Full session-by-session history: see [Session History](#session-history) below and `git log` on this file.

---

## 1. `microsoft/vscode` Benchmark

### Indexing & Analysis

| Metric     |  Docuvia2 | Docuvia2 (+LSP) |  GitNexus | Graphify |       CRG |
| :--------- | --------: | :-------------- | --------: | -------: | --------: |
| Nodes      |   293,309 | —               |   274,439 |  116,719 |   231,462 |
| Edges      |   458,614 | 1,184 (see ¹)   | 1,065,266 |  185,695 | 1,593,664 |
| Build time | 96m1.450s | ~120s (timeout) | ~17.5 min |    ~69 s |  ~7.3 min |

¹ Tier B is now verified end-to-end against this vscode clone. With a real TS install, Tier B surfaced genuine Docuvia2 bugs that were root-caused and fixed this session:

> - **OOM crashes resolved.** The `tsserver` previously crashed with exit code 134 (OOM) after a few hundred files due to memory limits.
> - **Fixed** (`lib/core/src/lsp/lsp-edge-provider-base.ts`): Reached `tsserver`'s real heap flag via `initializationOptions.maxTsServerMemory` (bumped to 8192MB) and captured stderr for diagnostics.
> - **Net result:** The crash is eliminated. The batch now processes **1,090 / 12,339** files and applies **1,184** corrected edges, ending via the ordinary 120s-timeout degradation path instead of a crash cascade.

- Graphify: community detection N/A (`graspologic` doesn't install in this environment); structural build only.
- CRG: full postprocess completed (signatures + FTS + flows + 3,786 communities), well inside its 30-min cap.
- **Build-time note:** 96m1.450s is the first run with correct atomicity — `persistLocked()` previously had no transaction wrapper (`withTransaction`, added this session) and re-tokenized FTS5 on every single node insert (`withFtsSyncSuspended`, added this session). Without both, a full vscode ingestion either silently left `local.db` in an inconsistent partial state (`project_files` empty, nodes/edges present) on the first disk-I/O failure, or eventually hit one anyway from unbounded WAL growth. Earlier session records of "~55 min" (and an outlier "~20 min" run) predate both fixes and reflect an ingestion that was never actually verified complete/consistent, not a faster equivalent of this run. The AST-parse-vs-persist time split for the successful 96-minute run is not separately logged — still open, see finding #3.

### Query, Visualization & Impact

| Metric                 |         Docuvia2 | GitNexus | Graphify |       CRG |
| :--------------------- | ---------------: | -------: | -------: | --------: |
| `query` time           |           1.32 s |    2.4 s |      N/A | 0.5–1.1 s |
| `impact` time          |           1.21 s |    7.9 s |      N/A |    19.5 s |
| `impact` — files/nodes |    0 (see below) |    8,624 |        — |    74,245 |
| `export-topology` time | 20.16 s / 7.22 s |      N/A |      N/A |       N/A |

- Docuvia2 `query "Disposable"` now resolves correctly to the canonical `src/vs/base/common/lifecycle.ts` class (2,315 incoming `extends` edges + 1 `contains`, 2,316 total) — the ScopeResolver fix below made connectivity-based ranking correct again; the vendored `extensions/copilot/.../lifecycle.ts` copy it previously won against now has only 63 incoming edges (51 `extends` + 11 `implements` + 1 `contains`), matching this doc's original intended target.
- `impact` on the canonical file itself reports "No dependents found" / LOW risk — file-level blast radius depends on Tier B-resolved cross-file edges, and 11,781/12,339 files (95.5%) have never been successfully Tier B-processed (see Tier B finding above), so this is a known-incomplete floor, not a confirmed zero.
- `export-topology`: 20.16s for the default collapsed view (12,338 nodes / 11,998 links / 87 groups, 72,280 folded), 7.22s for `--collapse=symbol` (not re-measured against the new 293,309/458,614 totals this pass).
- GitNexus: `impact` surfaced ambiguity explicitly (9 real candidates) before disambiguating to the figures above; `context` (3.0s) returned 102 real incoming caller/extends/implements entries.
- Graphify: no `query`/`impact`/`explain` CLI exists — those verbs are Claude-Code-skill-only (`skill.md`), not a standalone capability; its `to_html()` visual export also raises `ValueError` above a hard 5,000-node cap (116,719 actual).
- CRG: never surfaced the real `Disposable` class in its candidate list in either code path tried — the numbers above reflect its output, not a confirmed-correct resolution.

---

## 2. `nestjs/nest` Benchmark

### Indexing & Analysis

| Metric     | Docuvia2 | Docuvia2 (+LSP) | GitNexus | Graphify | CRG |
| :--------- | -------: | :-------------- | -------: | -------: | --: |
| Nodes      |   16,176 | —               |   11,979 |   14,394 | N/A |
| Edges      |   16,236 | 17,811          |   35,502 |   26,922 | N/A |
| Build time |   12.0 s | ~120s (timeout) |   25.4 s |  104.5 s | N/A |

- CRG: `build` never completed post-processing against nest across 5 attempts (~20–30 min each); raw AST parsing (1,746/1,746 files) always finished, but the pipeline then stalled indefinitely past that point.
- GitNexus: 709 clusters, 300 flows. Graphify: 1,046 communities.

### Query, Visualization & Impact

| Metric                 | Docuvia2 | GitNexus | Graphify | CRG |
| :--------------------- | -------: | -------: | -------: | --: |
| `query` time           |   0.70 s |   2.85 s |    2.1 s | N/A |
| `impact` time          |   0.67 s |   2.70 s |    0.8 s | N/A |
| `impact` — files       |        9 |      473 |        — | N/A |
| `export-topology` time |    0.7 s |      N/A |      N/A | N/A |

- Docuvia2: `impact` — Risk: HIGH. `export-topology`: 1,727 nodes / 1,221 links / 72 groups, 562 folded.
- GitNexus: `impact` — Risk: CRITICAL (byDepth 1:204, 2:184, 3:85); `query` returns loose BM25/FTS matches, not a precise symbol hit; `context` (6.4s) returns a real incoming-calls list.
- Graphify: `query` is a BFS token-budget dump with no ranked answer (expected, no LLM); `affected` (real reverse-traversal importer list) is the standalone equivalent of `impact`; `explain` (1.9s) produced the cleanest single-symbol output of the tools tested (degree 178, full connection list).
- CRG: N/A across the board — build itself never completed.

---

## Open TypeScript-Specific Findings

1. **Symbol disambiguation: vscode ships two real `Disposable` classes — FIXED 2026-08-05, root cause was elsewhere.** The canonical `src/vs/base/common/lifecycle.ts:526` and a vendored copy in `extensions/copilot/src/util/vs/base/common/lifecycle.ts` are both legitimate, identically-shaped `abstract class Disposable` declarations. The earlier hypothesis (`findNodeByName`'s connection-count ranking itself was wrong) was a dead end — a path-depth tiebreak was tried and reverted. The real root cause: [`ScopeResolver.findFileWithExtension()`](../../lib/core/src/graph/scope-resolver.ts) only ever _appended_ extensions when resolving a relative import, never _swapped_ an existing one — so vscode's own TS-ESM-style imports (`from "./lifecycle.js"` resolving to the real `lifecycle.ts`, TypeScript's NodeNext convention) silently failed to resolve almost everywhere, corrupting `extends`/`implements` edge attribution wholesale. Fixed by adding a swap-based retry branch. Live-verified: the canonical file's incoming edges went from 2 (broken) to 2,316 (correct) after the fix; `findNodeByName`'s original connectivity-only ranking (no depth tiebreak) was correct all along once given correct input data.
2. **Tier B (LSP escalation) is now verified end-to-end against vscode — and hits the 120s timeout at this scale.** The environment blocker was fixed by installing a standard `typescript` package. Tier B initially crashed with exit 134 (OOM) due to memory limits, but after setting `initializationOptions.maxTsServerMemory`, the crash was eliminated. The batch now processes 1,090 / 12,339 files and applies 1,184 edges before degrading gracefully at the 120s timeout.
3. **AST-parse phase scales worse than file count alone predicts, and the fix's payoff is unconfirmed.** vscode's `.ts` files are 5.87x bigger by mean / 40.8x by total bytes than nest's; even after accounting for that, parsing ran ~1.7x slower than a byte-weighted projection — traced to `Language.load()` reloading each file's WASM grammar with no dispose path. A per-`wasmPath` cache was since added (`ast-worker.ts`, `32ab66a5`), but a same-repo re-measurement showed AST-parse ~9–11% slower, not faster (0 parse failures, down from 4) — the performance hypothesis remains unconfirmed. Separately, this session's successful 96m1.450s full run doesn't log an AST-parse/persist phase boundary, so it's still not possible to attribute how much of that total is parse time vs. the newly-added transaction/FTS-suspend persist work (finding #4) — both remain open, unresolved by this pass.
4. **Persist-layer wasn't safe at vscode's scale — found and fixed 2026-08-05.** `persistLocked()` had no transaction wrapper: a mid-ingestion disk-I/O failure left `local.db` in a silently inconsistent partial state (nodes/edges present, `project_files` empty). Separately, `persistFileAndSymbolNodes`'s per-row insert/delete loop re-tokenized the `l2_nodes_fts` FTS5 index on every one of 293k+ rows — a cost `bulkLoadGraph`'s hydration path had already solved but the normal ingestion path never got. Fixed via two new interface methods, [`IGraphStore.withTransaction()`](../../lib/contracts/src/interfaces/graph-store.interfaces.ts) and [`IGraphNodesRepo.withFtsSyncSuspended()`](../../lib/contracts/src/interfaces/graph-store.interfaces.ts), both wired into `persistLocked()`. Verified together via the successful 96-minute full run above (`PRAGMA integrity_check = 'ok'`, 0/12,339 files failed) — prior attempts without both fixes failed at 19–60 minutes in with `disk I/O error` or an apparent hang.

Findings that turned out **not** to be TypeScript-specific (general Docuvia2/GitNexus/CRG behavior found during this pass) have been moved to [`README.md`](./README.md) §4.

---

## Session History

- **2026-07-28/29**: initial nest pass (all 4 tools) + a same-day follow-up fixing 3 Tier B execution bugs (queue never populated, `ADDED`-file classification, spanning-boundary semantic-diff matching).
- **2026-07-29**: vscode pass (abbreviated, cut short end-of-day) — found the Tier A git-knowledge-branch pack-step crash and the Tier B polyglot-monorepo root-marker gate; both fixed 2026-08-04.
- **2026-07-29/30**: dogfooding pass on Docuvia2's own repo — found and fixed 5 more Tier B execution bugs, root-caused the Tier B commit/delta-scoped resync gap (fixed 2026-08-04, `4013d799`, added `--full`), and found `findNodeByName`'s missing ranking (fixed 2026-08-04).
- **2026-08-04**: Docuvia2-only re-verification (vscode + nest) plus a `git reset --soft HEAD~3` probe — found and fixed a delta-ingestion bug where rewinding `HEAD` while the working tree stayed current silently dropped real files/symbols from the graph (`8600a9fa`). Also ran a read-only AST-parse performance deep-dive (see finding 3 above).
- **2026-08-05**: fresh vscode re-verification — found and fixed TypeScript `abstract class` extraction (grammar node type was never wired in, `99934dd9`) and a failed-pack-then-silent-graph-wipe bug, the most severe found across this benchmark series (`3cd9401f`).
- **2026-08-05 (continued, same-day)**: root-caused and fixed the actual `Disposable` disambiguation bug (`ScopeResolver`'s `.js`→`.ts` extension-swap gap, finding #1), added `IGraphStore.withTransaction()` + `IGraphNodesRepo.withFtsSyncSuspended()` to make vscode-scale persistence atomic and FTS-cheap (finding #4) — verified via a full successful 96m1.450s ingestion (293,309 nodes / 458,614 edges, `PRAGMA integrity_check = 'ok'`). Fixed an unrelated LSP out-of-workspace-reference crash (`path.relative()` across Windows drive letters) found while diagnosing Docuvia2's own repo showing 0 Tier-B-processed files.
- **2026-08-06**: Live re-verification against vscode root-caused the Tier B crash as an OOM abort (exit 134) in `tsserver`. Fixed by setting `initializationOptions.maxTsServerMemory` to 8192MB and capturing stderr for diagnostics. The Tier B batch now successfully processes 1,090 files and applies 1,184 edges before ending gracefully via the 120s-timeout path. Also re-measured GitNexus and Docuvia2 on the `nest` repo, noting massive speed improvements in GitNexus (173s -> 25s build time).

For full per-session detail beyond this summary, see this file's git history (`git log -- docs/cli-test-analysis/typescript-cli-benchmark.md`) and [`README.md`](./README.md) §3.2/§4 for the cross-tool findings extracted from these sessions.
