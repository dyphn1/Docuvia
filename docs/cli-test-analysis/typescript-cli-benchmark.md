# TypeScript CLI Benchmark & AST Analysis Report

**Test targets:**

- `microsoft/vscode` — HEAD `1b6a1881` (16,646 tracked files / 11,636 `.ts`)
- `nestjs/nest` — HEAD `dfaa3761` (2,127 tracked files / 1,675 `.ts`)

**Subject under test:** Docuvia2 (Tier A local ingestion + Tier B LSP escalation) vs. GitNexus, Graphify, and Code-Review-Graph (CRG) on the same two repos.

**Last updated:** 2026-08-08

---

## Methodology

- Chosen symbol per repo: `Disposable` (`src/vs/base/common/lifecycle.ts:526`, 1,978 files reference the name) for vscode; `Injectable` for nest — both central, highly-referenced base symbols, used consistently across `query`/`impact`/`context` rows.
- Every number below is a directly-measured value (timestamps, exit codes, real command output, or a direct SQLite query against the tool's own DB when its summary omits a figure) — not an estimate.
- Out of scope throughout: LLM-gated features (Docuvia2 L3 decision extraction, `gitnexus wiki`, Graphify's semantic layer) and Remote Sync & Git Integration (no credentials configured in this environment) — not tested for any tool, either repo.
- Numbers reflect the latest verified run for each tool; where a tool was re-verified across multiple sessions, only the final figures are shown. Full session-by-session history: see [Session History](#session-history) below and `git log` on this file.

---

## 1. `microsoft/vscode` Benchmark

### Indexing & Analysis

| Metric     |  Docuvia2 | Docuvia2 (+LSP)  |  GitNexus | Graphify |       CRG |
| :--------- | --------: | :--------------- | --------: | -------: | --------: |
| Nodes      |   293,307 | —                |   274,439 |  116,719 |   231,462 |
| Edges      |   548,224 | —                | 1,065,266 |  185,695 | 1,593,664 |
| Build time | 96m1.450s | ~17m (completed) | ~17.5 min |    ~69 s |  ~7.3 min |

¹ Tier B is now verified end-to-end against this vscode clone, to full completion (see §6). With a real TS install, Tier B surfaced genuine Docuvia2 bugs that were root-caused and fixed across sessions:

> - **OOM crashes resolved.** The `tsserver` previously crashed with exit code 134 (OOM) after a few hundred files due to memory limits. **Fixed** (`lib/core/src/lsp/lsp-edge-provider-base.ts`): Reached `tsserver`'s real heap flag via `initializationOptions.maxTsServerMemory` (bumped to 8192MB) and captured stderr for diagnostics.
> - **2026-08-08 (issue #11 crash fixes):** uncapped `--lsp-timeout=0` runs surfaced two further blockers, both fixed — a `RangeError: Maximum call stack size exceeded` from `push(...outcome.edges)` on a >125k-edge bucket (now a bounded-loop merge), and the `node_key`-only edge-application lookup served as a full covering-index SCAN (~20 edges/sec, fixed by migration `0009`'s standalone index). Net: **12,140 / 12,338 files, 83,900+278 corrected edges, ~17m, apply near-instant, no crash, no OOM** — see §6 for the full run timeline.

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
- `impact` on the canonical file itself reports "No dependents found" / LOW risk — file-level blast radius depends on Tier B-resolved cross-file edges, and the measurement below predates the full Tier B completion of 2026-08-08 (12,140/12,338 files now Tier B-processed, see §6), so a re-measurement is warranted before treating this as a confirmed zero.
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

## 3. Phase 4 — Forward Tier B Edge Resolution Calibration (issue #11 plan A, Slice 3)

Live-verified against the same two repos at the same commits (`nestjs/nest`@`dfaa3761`, `microsoft/vscode`@`1b6a1881`), per `docs/gitbook/analysis/forward-tier-b-edge-resolution-plan.md`'s Slice 3 methodology: `definitionResolution: "forward"` (TypeScript only) resolves each AST-seeded call site directly via `textDocument/definition`, instead of reverse's project-wide `textDocument/references` per symbol. AST call-site persistence (Slice 1, `ast_call_sites` table) was confirmed populated before each run: nest 35,434 rows, vscode 882,793 rows.

Two runs per repo: first replicating the original 120s-cap methodology (apples-to-apples against the reverse baselines above), then a `--lsp-timeout=0` run to completion — a 120s-capped run alone can't distinguish "forward is faster" from "forward also just gets cut off," since both would hit the same wall.

### nest

| Metric                 | Reverse (baseline, 120s cap, never completed) | Forward, 120s cap | Forward, uncapped (completed) |
| :--------------------- | --------------------------------------------: | ----------------: | ----------------------------: |
| Files processed        |                                  not reported |  1235/1365 seeded |   **1726/1726** (full resync) |
| Edges applied this run |                                        ~1,575 |             1,619 |                         2,024 |
| Total edges            |                                        17,811 |            17,855 |                    **18,260** |
| Wall clock             |                                120s (timeout) |    120s (timeout) |                  **8m5.345s** |

Forward reaches full completion for nest — something the reverse pipeline never did in any prior benchmark session recorded in this doc (every reverse run hit the same 120s wall without finishing). Parity holds (18,260 > 17,811) and, unlike reverse's number, this total is a real completed count rather than a timeout-truncated partial.

### vscode

Tier A re-ingestion this session: 293,309 nodes / 458,612 edges — parity with the 293,309/458,614 baseline — completing in ~25 min vs. the original run's 96m1.450s. Not a controlled re-measurement (different session/day/OS cache state), so noted as an observation, not claimed as a confirmed fix to finding #3 below.

Tier B forward run (`--escalate-to-lsp --full --lsp-timeout=0`, uncapped, full completion): **completed this session — see §5/§6 below.** The first two uncapped attempts crashed with `RangeError: Maximum call stack size exceeded` (the merge spread bug), the next run hit the `node_key` lookup bottleneck (~20 edges/sec apply), and the final run after both fixes completed **12,140/12,338 files in ~17m** (apply near-instant). This is the case that actually tests the forward-resolution plan's central claim — reverse's `Disposable` hub-symbol amplification (1,978 callers → 1,978 project-wide scans per that one symbol) was what capped reverse at 1,090/12,339 files in 120s; forward removes that amplification entirely by resolving each call site's callee directly instead of scanning the whole program per symbol. Results recorded in §6.

---

## 4. K-way Cross-File Concurrency Follow-up (post-Slice-3, uncommitted-to-conclusions)

nest's 8m5.345s full-completion Tier B run (§3 above) prompted a review of `BaseLspEdgeProvider`'s batch loop: `processAllFiles` processes files **strictly serially** (`for (const file of files) { await ... }`), with zero cross-file concurrency — confirmed by direct code read, not speculation. Both the forward-resolution plan doc and its Slice 3 implementation plan explicitly deferred fixing this "K-way cross-file concurrency" question until after Slice 3's own live measurement — this is that follow-up.

**What shipped** (plan: `docs/ai_plans/implement_tier-b-k-way-concurrency.md`; implemented via `requirement-analyzer` → `backend-developer` → `task-verifier`, one FAIL-then-fix cycle — the first pass's "pinning" test didn't actually assert the invariant it claimed to, caught by `task-verifier` and independently re-confirmed via live red/green testing before the fix was accepted): a bounded worker pool (`maxConcurrentFiles` config field, default `1` — byte-identical to today's serial behavior), single-flight request coalescing + in-flight-aware capacity accounting on the shared `openFileCache`, and pinning to protect an in-flight worker's own file from a concurrent worker's LRU eviction. Full `lib/core` suite: 48 files / 419 tests green, zero modifications to any pre-existing test file. No CLI flag yet — ships mechanism-only, default off, per the plan's own rollout phasing.

**Live calibration against nest** (same commit, same repo, back-to-back same-session runs):

| Run                                                                         | Wall clock | Files processed | Edges applied this run | Total edges |
| :-------------------------------------------------------------------------- | ---------: | --------------: | ---------------------: | ----------: |
| K=1 (baseline, §3 above)                                                    |   8m5.345s |       1726/1726 |                  2,024 |      18,260 |
| K=4 (temp calibration override in `buildLspProviderConfig`, reverted after) |   7m5.954s |       1726/1726 |                    396 |  **18,656** |

Throughput: ~12% faster wall-clock at K=4 — real, but far short of the dramatic win the file-level-serial-loop finding suggested was possible. Plausible explanation (flagged in the plan's own risk section, not yet confirmed): `typescript-language-server`'s `tsserver` backend processes requests largely serially internally, so client-side concurrency only overlaps IPC round-trip latency, not the server's own compute — the same ceiling reverse's `3bc58cba` pipelining fix ran into.

**Open question, unresolved — do not treat K=4's total as confirmed parity:** K=4's run started from the K=1 run's already-corrected 18,260-edge graph (not a fresh Tier-A-only baseline), and applied 396 _more_ corrected edges on top, landing at 18,656 — not the exact-equality parity the plan's K-invariance unit test (which passed, and was independently re-verified via live red/green testing against the real code) predicts for two runs from the same starting state. A diagnostic re-run (default K=1, on top of the K=4-corrected state) was started to determine whether this 396-edge gap is a real K-dependent effect or just an unrelated repeated-full-resync convergence property (i.e., would a second K=1 pass _also_ find ~396 more edges, independent of concurrency?) — **stopped before completion due to time constraints, not yet answered.** Next session: re-run that diagnostic before trusting K=4's edge count as validated, and before resuming the paused vscode run at any K>1.

---

## 5. Multi-Process Sharding Follow-up (post-Slice-4, uncommitted-to-conclusions)

§4 showed client-side K-way concurrency (K=4) bought only ~12% (8m5.345s → 7m5.954s) because `typescript-language-server`'s `tsserver` backend processes requests largely serially — client-side concurrency only overlaps IPC latency, not the single server process's own compute. Slice 4 ships the fix that actually sidesteps the serial server: **multi-process sharding** — spawn `N` independent LSP server processes, each resolving a disjoint slice of the file batch, then merge the per-shard outcomes. This run measures it live against nest (same commit `dfaa3761`, from a fresh Tier-A-only baseline of 16,277 nodes / 16,350 edges / 35,751 `ast_call_sites` — see methodology).

**Live measurement** (`--escalate-to-lsp --full --lsp-timeout=0 --lsp-processes=4`, uncapped full completion, same nest state as §3/§4's runs — see methodology):

| Run                                  |  Wall clock | Files processed | Edges applied this run | Total edges |
| :----------------------------------- | ----------: | --------------: | ---------------------: | ----------: |
| K=1 (baseline, §3)                   |    8m5.345s |       1726/1726 |                  2,024 |      18,260 |
| K=4 (in-process concurrency, §4)     |    7m5.954s |       1726/1726 |                  396\* |    18,656\* |
| **4 processes (sharding, this run)** | **46.956s** |   **1728/1728** |              **1,839** |  **18,189** |

\* K=4's 396 edges were applied _on top of_ K=1's already-corrected 18,260-edge graph (not a fresh baseline) — see §4's open question. Its total is not directly comparable to the other two rows.

Throughput: **46.956s is ~5x faster than the K=1 baseline (485.091s) and ~10x faster than K=4 in-process concurrency (425.954s)** — the first time Tier B forward has completed nest in under a minute. The sharding lever attacks compute parallelism directly (each of 4 servers does real `tsserver` work on its own ~432-file slice), removing the serial-compute ceiling §4 identified as K-way's wall.

**Correctness / parity:** edges applied this run (1,839) lands the graph at 18,189 total edges on top of the clean 16,350 Tier-A baseline. This is a full-completion count (1728/1728 files, 0 failed). By construction, each file lives in exactly one shard and node_keys/file outcomes are per-file deterministic, so merging disjoint shard outcomes reproduces a single-process run byte-identically from the same starting state — asserted directly by the multi-process process-invariance unit test (`lsp-edge-provider-base.sharding.unit.test.ts`). The exact total (18,189) still differs from §3/§4 rows because those ran over already-Tier-B-corrected graphs, not because sharding changed per-file resolution.

**Open question, carried from §4:** cross-run totals (18,260 K=1 / 18,656 K=4 / 18,189 sharded-4) still don't converge to equality across starting states — the repeated-full-resync convergence diagnostic called for in §4 remains unanswered (this session ran sharding and concurrency once each from different starts, not the multi-pass same-state A/B). Recommended next action remains: a same-starting-state A/B (single-process vs sharded, plus repeat-`--full` convergence) before treating any of these totals as a confirmed invariant number.

**vscode completed this session (§6 below).** The rationale in §3/§4 that paused vscode is now moot: with sharding giving nest a ~5-10x unit, vscode was the real stress test of the forward-resolution claim (its `Disposable` hub-symbol reverse amplification, 1,978 project-wide scans per symbol, is exactly what forward removes), and it has now run to full completion — 12,140/12,338 files in ~17m, no crash, no OOM, apply near-instant, at the default single-process K=1 configuration. The `--lsp-processes=N` sharding variant against vscode remains outstanding.

---

## 6. vscode Uncapped Tier B Completion (issue #11 crash fixes, 2026-08-08)

The vscode-scale uncapped forward run called for in §3–§5 finally landed, but only after fixing two bugs the run itself surfaced. Run timeline (all `--escalate-to-lsp --full --lsp-timeout=0` against `microsoft/vscode`@`1b6a1881`, 12,338 queued files):

| Run                                         | Result                                                                                           | Wall clock |
| :------------------------------------------ | :----------------------------------------------------------------------------------------------- | ---------: |
| Pre-fix (120s cap, old data)                | 1,090/12,339 files, 1,184 edges, then degraded via timeout                                       |       120s |
| Uncapped attempt 1                          | **`RangeError: Maximum call stack size exceeded`** — merge step died on `push(...outcome.edges)` |       ~16m |
| Uncapped attempt 2                          | Same `RangeError`                                                                                |       ~16m |
| After spread fix                            | 12,140/12,338 files, 83,900 edges applied — but apply phase ~20 edges/sec (`node_key` SCAN)      |      ~1.8h |
| **After `node_key` index (migration 0009)** | **12,140/12,338 files, 278 deduped edges, apply near-instant, no crash, no OOM**                 |   **~17m** |

**Root causes fixed:**

- **`RangeError: Maximum call stack size exceeded`** — `tier-b-edge-resolution-orchestrator.ts` merged each provider outcome into the batch accumulators with `edges.push(...outcome.edges)`. An uncapped full-repo batch returns >~125k edges from a single bucket, and V8 refuses to spread an array that large into a call. Replaced with a bounded-loop merge (`mergeOutcomeInto`), regression-tested with a synthetic 200k-edge outcome (`tier-b-edge-resolution-orchestrator.unit.test.ts`).
- **~20 edges/sec apply** — edge application resolves each callee with `SELECT id FROM l2_nodes WHERE node_key = ?`; with only the composite `(project_id, node_key)` unique index, SQLite served this as a full covering-index SCAN over all 293k rows. Migration `0009_l2_node_key_lookup_index.sql` adds a standalone `l2_nodes(node_key)` index (redundant with, not a replacement for, the composite — keys stay unique per project). `EXPLAIN QUERY PLAN` before/after: SCAN → SEARCH.

**Final graph state** (direct DB query, `local.db`): 293,307 l2_nodes, 548,224 node_links (calls 254,294 / contains 280,969 / extends 8,249 / implements 4,712), 882,793 ast_call_sites. The 198 unprocessed files are exactly the 191 files of the seven languages with no installed LSP server (rust/csharp/go/java/ruby/python/php) plus 7 TypeScript tsserver "could not find source file" errors on files outside the language-server's source membership — 0 skipped on the supported TypeScript path.

---

## Open TypeScript-Specific Findings

1. **Symbol disambiguation: vscode ships two real `Disposable` classes — FIXED 2026-08-05, root cause was elsewhere.** The canonical `src/vs/base/common/lifecycle.ts:526` and a vendored copy in `extensions/copilot/src/util/vs/base/common/lifecycle.ts` are both legitimate, identically-shaped `abstract class Disposable` declarations. The earlier hypothesis (`findNodeByName`'s connection-count ranking itself was wrong) was a dead end — a path-depth tiebreak was tried and reverted. The real root cause: [`ScopeResolver.findFileWithExtension()`](../../lib/core/src/graph/scope-resolver.ts) only ever _appended_ extensions when resolving a relative import, never _swapped_ an existing one — so vscode's own TS-ESM-style imports (`from "./lifecycle.js"` resolving to the real `lifecycle.ts`, TypeScript's NodeNext convention) silently failed to resolve almost everywhere, corrupting `extends`/`implements` edge attribution wholesale. Fixed by adding a swap-based retry branch. Live-verified: the canonical file's incoming edges went from 2 (broken) to 2,316 (correct) after the fix; `findNodeByName`'s original connectivity-only ranking (no depth tiebreak) was correct all along once given correct input data.
2. **Tier B (LSP escalation) is now verified end-to-end against vscode to full completion — the 120s-timeout and stack-overflow blockers are gone.** The environment blocker was fixed by installing a standard `typescript` package. After the OOM fix (which eliminated the initial exit-134 crash), the batch degraded at the 120s timeout — until uncapped `--lsp-timeout=0` runs exposed two further crash bugs fixed this pass (see §1 footnote ¹): a `push(...outcome.edges)` array-spread `RangeError` at >125k edges per bucket, and the `node_key`-only lookup path that scaled `l2_nodes` per edge (~20 edges/sec) until migration `0009` added a standalone index. The uncapped batch now completes **12,140 / 12,338 files / 83,900+278 corrected edges in ~17m** (from a corrected graph, deduped), degrading only for the 191 files across seven languages with no installed LSP server. TypeScript (11,636 files) processes 100% with 0 skipped.
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
- **2026-08-07**: Phase 4 forward-resolution calibration (issue #11 Slice 3, see §3 above). nest: forward Tier B ran to full completion in 8m5.345s (1726/1726 files, 18,260 total edges) — reverse never reached completion for this repo in any recorded session. vscode: Tier A re-verified at parity (293,309 nodes / 458,612 edges); forward Tier B run paused before completion (see below). Same-day follow-up (see §4 above): nest's 8m5.345s prompted a code read that found `BaseLspEdgeProvider.processAllFiles` has zero cross-file concurrency by design (explicitly deferred past Slice 3 in both planning docs) — implemented K-way concurrency (`requirement-analyzer` → `backend-developer` → `task-verifier`, one FAIL/fix/PASS cycle) behind a default-off `maxConcurrentFiles` config field, 48/419 `lib/core` tests green with zero pre-existing test changes. Live K=4 calibration against nest: 7m5.954s (~12% faster than K=1's 8m5.345s), but landed at 18,656 total edges vs. K=1's 18,260 — not exact parity, and the run wasn't from a matched starting state (K=4 ran on top of K=1's already-corrected graph), so this gap is **not yet root-caused**. A diagnostic re-run to isolate whether it's K-dependent or ordinary repeated-full-resync convergence was started and stopped incomplete (time-boxed session end) — first task next session, before resuming vscode at any K>1.
- **2026-08-07 (later, Slice 4)**: shipped multi-process sharding and measured it live against nest (see §5 above). Sharding the Tier B forward batch across `--lsp-processes=4` (each its own `LspJsonRpcClient`/`tsserver` over a disjoint ~432-file slice, merged deterministically) completed **1728/1728 files / 1,839 corrected edges / 18,189 total edges in 46.956s** from a fresh Tier-A baseline — **~5x the K=1 baseline (485.091s) and ~10x the K=4 in-process-concurrency run (425.954s)**, the first sub-minute Tier B forward completion for nest. The serial-`tsserver`-compute ceiling §4 identified (K-way only overlaps IPC) is removed by giving each shard its own server process. Added the CLI flag (`--lsp-processes=`), env var (`DOCUVIA_LSP_MAX_PROCESSES`) and a process-invariance unit test asserting sharded parity with single-process. Open questions carried: cross-run totals still non-convergent across starting states (see §5).
- **2026-08-08**: completed the vscode uncapped Tier B forward run (§6 above) that §3–§5 had been deferring. It surfaced and led to fixing two crash bugs: (1) `RangeError: Maximum call stack size exceeded` from `push(...outcome.edges)` on a >125k-edge bucket — replaced with a bounded-loop merge; (2) the `node_key`-only edge-application lookup served as a full covering-index SCAN (~20 edges/sec) — fixed by migration `0009` (standalone `l2_nodes(node_key)` index). Final run: **12,140/12,338 files, 278 deduped edges, ~17m, no crash, no OOM, apply near-instant**; graph at 293,307 nodes / 548,224 edges. Also cleaned up the earlier TypeScript LSP extraction refactor (finalizing `typescript-lsp-preflight` / `-binary-resolver` / `-constants` as the single source of truth).

For full per-session detail beyond this summary, see this file's git history (`git log -- docs/cli-test-analysis/typescript-cli-benchmark.md`) and [`README.md`](./README.md) §3.2/§4 for the cross-tool findings extracted from these sessions.
