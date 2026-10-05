# GRPH-008 Phase 3: Q1 named-import proof audit

Run against branch `docs/559-grph-008-tiered-call-resolution`, source snapshot `eadea32705660a0f2eb0cc07607ea7f474175bd2` (885 source files). This audit covers the strict Q1 direct named-function-import slice only. It does not change `ScopeResolver`, promote a calibration result, or skip Tier B.

## Phase 3 gap audit

| Requirement                                             | Status                                                  | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Portable, source-scoped call-site identity              | Done                                                    | SHA-256 over workspace path, content hash, zero-based UTF-16 position, callee kind and name; `lib/contracts/src/graph/call-site-identity.ts:20`.                                                                                                                                                                                                                                                                                                                                                                       |
| `call_site_resolutions`, `_candidates`, `_observations` | Done                                                    | Normalized current rows, alternatives and append-only history; `lib/schema/src/sqlite/migrations/0013_call_site_resolutions.sql:5`, `:43`, `:55`. Dependency rows are in migration `0014_call_site_resolution_dependencies.sql:1`.                                                                                                                                                                                                                                                                                     |
| Resolution class separate from verification status      | Done                                                    | Distinct `CallSiteResolutionClasses` and `CallSiteVerificationStatuses`; `lib/contracts/src/interfaces/graph-store.interfaces.ts:646`, `:703`. Proven rows have no confidence and remain unverified until Tier B.                                                                                                                                                                                                                                                                                                      |
| Single-candidate proof boundary                         | Partial                                                 | Direct Q1 declarations require one indexed call site, a complete TS/JS named-function inventory, one target file, one function export and one direct declaration; `lib/core/src/semantic/call-resolution-strict-proof.ts:187`, `:363`. The generic candidate pipeline is not complete for every Phase 3 call shape.                                                                                                                                                                                                    |
| Q1                                                      | Partial; direct named function imports implemented here | Relative imports and the already-supported configured `@/* -> ./src/*` mapping can prove a unique direct function export. `.js/.mjs/.cjs` source substitutions and unique directory indexes are covered. Default/namespace/wildcard imports, re-exports, workspace packages, escapes and ambiguous paths abstain. See `call-resolution-strict-proof.ts:207`, `:403`, `:594`.                                                                                                                                           |
| Q2 re-export tracing                                    | Missing                                                 | Q1 explicitly abstains on re-export evidence at `call-resolution-strict-proof.ts:304`; no `(file, symbol)` traversal, cycle, depth-16 or export-star implementation exists yet.                                                                                                                                                                                                                                                                                                                                        |
| Q3                                                      | Partial                                                 | Existing bounded `this.member()` direct-owner proof (`single-candidate-this-v1`), not the full list of declared receiver forms; `call-resolution-strict-proof.ts:562`.                                                                                                                                                                                                                                                                                                                                                 |
| Transactional caller-file calls projection              | Done for persisted per-site rows                        | `replaceForFile` writes current resolutions, ScopeResolver projection callers, and the collapsed caller-file projection in one transaction; `lib/schema/src/sqlite/repos/call-site-resolutions-repo.ts:105`, `:1015`, `lib/schema/src/sqlite/migrations/0016_call_site_projection_callers.sql:1`. Graph persistence calls it inside its transaction at `lib/core/src/graph/persist-ast-graph.ts:569`. The resolution record keeps the exact enclosing caller; the calls edge keeps ScopeResolver's caller attribution. |
| Dependency fingerprint invalidation                     | Partial                                                 | Q1 records caller and target hashes, plus the config hash when a configured mapping was consulted; `call-resolution-strict-proof.ts:403`. The repo marks dependent rows stale and rebuilds affected projections transactionally at `call-site-resolutions-repo.ts:427`, but no source-change workflow invokes it yet (currently exercised by repo/integration tests, e.g. `call-resolution-graph-persister.integration.test.ts:267`).                                                                                  |
| Exit-gate tests                                         | Partial                                                 | Q1 positive, negative, collision, truncation, abstention, module-path ambiguity, and delete/reparse cases exist. Q2 cycle/depth/export-star tests remain blocked by the missing Q2 implementation. See `call-resolution-hypothesis.service.integration.test.ts:365`, `:482`, `:1049`, and `call-resolution-graph-persister.integration.test.ts:179`, `:281`.                                                                                                                                                           |

## Why the earlier Q1 probe returned zero

The first Q1 draft gated Q1 on the workspace-wide `complete` flag. That flag also reflects incomplete class/object member inventories and source files outside Q1's TS/JS declaration inventory. On the pinned Docuvia snapshot there are 1,926 incomplete owner inventories and 22 Python files without declared-type facts. Neither condition makes the program-level named-function export set incomplete, but the broad gate caused valid imports to abstain as `incomplete-inventory`.

The ten call sites below were all `incomplete-inventory` in that draft. They use normal TypeScript ESM `.js` specifiers; path mapping was not the abstention cause. With the Q1-specific inventory gate, each proves the direct `.ts` export shown.

| `artifacts/cli/src/cli.ts` call site | Import specifier                   | Proven target                                        | Earlier result → current result |
| ------------------------------------ | ---------------------------------- | ---------------------------------------------------- | ------------------------------- |
| `:127` `analyzeCommand()`            | `./commands/analyze.js`            | `commands/analyze.ts#analyzeCommand`                 | `incomplete-inventory` → proven |
| `:153` `resolveOutputFormat()`       | `./utils/resolve-output-format.js` | `utils/resolve-output-format.ts#resolveOutputFormat` | `incomplete-inventory` → proven |
| `:154` `reviewCommand()`             | `./commands/review.js`             | `commands/review.ts#reviewCommand`                   | `incomplete-inventory` → proven |
| `:165` `resolveOutputFormat()`       | `./utils/resolve-output-format.js` | `utils/resolve-output-format.ts#resolveOutputFormat` | `incomplete-inventory` → proven |
| `:166` `impactCommand()`             | `./commands/impact.js`             | `commands/impact.ts#impactCommand`                   | `incomplete-inventory` → proven |
| `:172` `resolveOutputFormat()`       | `./utils/resolve-output-format.js` | `utils/resolve-output-format.ts#resolveOutputFormat` | `incomplete-inventory` → proven |
| `:175` `queryCommand()`              | `./commands/query.js`              | `commands/query.ts#queryCommand`                     | `incomplete-inventory` → proven |
| `:189` `exportTopologyCommand()`     | `./commands/export-topology.js`    | `commands/export-topology.ts#exportTopologyCommand`  | `incomplete-inventory` → proven |
| `:194` `snapshotCommand()`           | `./commands/snapshot.js`           | `commands/snapshot.ts#snapshotCommand`               | `incomplete-inventory` → proven |
| `:202` `hydrateCommand()`            | `./commands/hydrate.js`            | `commands/hydrate.ts#hydrateCommand`                 | `incomplete-inventory` → proven |

The graph persister also had a row-persistence gap: it could evaluate a Q1 proof but fail to persist it when `ParsedCall.sourceFunction` named a callback parameter/local instead of an enclosing graph function. After fixing the inventory gate, the whole-source run had 3,187 service proofs but only 957 persisted rows; all 2,230 missing rows had a unique target function but no matching caller by the legacy name hint. The exact `callerNodeKey` now uses the unique smallest enclosing function span, falling back to the file only when there is no unique enclosing function; the callback regression asserts this for `src/caller.ts#anonymous`.

That exact caller key remains the per-site resolution record's source of truth. The calls projection uses the same caller node that `linkSymbolReference` selects through `resolveSourceNodeId`; a separate `call_site_resolution_projection_callers` row preserves that projection attribution through transactional rebuilds and dependency invalidation. A proven site changes only the target side of its calls edge. Exact-caller calls projection is deferred as a separate uniform graph change requiring its own impact-accuracy evidence.

The `.js -> .ts/.tsx`, `.mjs -> .mts`, and `.cjs -> .cts` substitutions were already in the draft. The genuine path gap fixed here was extensionless directory imports: `index.ts/.tsx/.js/.jsx` is accepted only when exactly one candidate exists. Multiple `.js -> .ts` and `.tsx` candidates, multiple directory indexes, barrels/re-exports, external builtins, and exported arrow/variable values still abstain. For example, `artifacts/cli/src/mcp/server.ts:46` calls `MCP_TOOL_NOT_FOUND_MESSAGE`, which is an exported arrow-valued constant rather than a direct function declaration; that abstention is correct for this Q1 rule. `node:child_process` imports also abstain because their targets are outside the repository.

## Pinned source-only corpus results

The pinned corpus has 31,578 source rows. Source replay used the pinned snapshots, while only TRAIN (13,496 rows) and CALIBRATION (2,966 rows) labels were loaded. TEST and TEMPORAL labels were not read. Q1 proofs without a gold target: 0. Proven target vs gold target disagreements: **0**; the disagreement list is empty.

| Split                   | Repository family                                       |       Rows | Named-import-bound |    Proven | Coverage of rows | Coverage of bound sites | Q1 target differs from ScopeResolver | Gold disagreements |
| ----------------------- | ------------------------------------------------------- | ---------: | -----------------: | --------: | ---------------: | ----------------------: | -----------------------------------: | -----------------: |
| CALIBRATION             | `403errors/repomind`                                    |      1,207 |              1,204 |     1,104 |           91.47% |                  91.69% |                                  968 |                  0 |
| CALIBRATION             | `Egonex-AI/Understand-Anything`                         |      1,759 |              1,018 |       825 |           46.90% |                  81.04% |                                    0 |                  0 |
| TRAIN                   | `dyphn1/Docuvia`                                        |      3,610 |              1,484 |     1,348 |           37.34% |                  90.84% |                                    2 |                  0 |
| TRAIN                   | `nestjs/nest`                                           |      8,000 |              3,025 |       627 |            7.84% |                  20.73% |                                    2 |                  0 |
| TRAIN                   | `tirth8205/code-review-graph`                           |         77 |                  8 |         4 |            5.19% |                  50.00% |                                    0 |                  0 |
| TRAIN                   | `trailhq/Graft`                                         |        888 |                835 |       759 |           85.47% |                  90.90% |                                    2 |                  0 |
| TRAIN                   | `typescript-language-server/typescript-language-server` |        921 |                332 |       192 |           20.85% |                  57.83% |                                    0 |                  0 |
| **TRAIN + CALIBRATION** | **all families**                                        | **16,462** |          **7,906** | **4,859** |       **29.52%** |              **61.46%** |                              **974** |              **0** |

No selection or calibration promotion occurred: Q1 heuristic selections were 0. The 974 count compares each proven Q1 target with the ScopeResolver target for that source call site; a missing ScopeResolver target also counts as a difference.

Two additional calibration call sites in `Egonex-AI/Understand-Anything` abstain as `incomplete-inventory`. Their pinned snapshot does not provide a complete named-function inventory, so the proof correctly withholds both targets rather than treating the missing inventory as collision-free.

## Whole-source graph parity

The same archived HEAD source snapshot was parsed once, then persisted in isolated databases with Q1 proven proofs suppressed vs enabled. It contains 885 source files, all parsed with 0 failures. Results: 3,187 Q1 proofs and 3,187 persisted Q1 rows; no Q1 calibration selections; node rows, non-call links and non-Q1 hypothesis outputs are unchanged.

The calls comparison uses unique `(source_node_key, target_node_key, link_type)` tuples, matching the collapsed calls projection. It found 214 added and 0 removed call links; all 214 have a concrete Q1 witness in the [parity diff JSONL](tiered-call-resolution-phase3-q1-named-import-proof-parity.jsonl). The unique-link diff contains 212 additions where ScopeResolver had no local target and 2 additions correcting ScopeResolver self-recursion targets. Those self edges had already been discarded by the persister, so the correct Q1 edges appear as additions in the graph diff. The two corrections are:

- `lib/ui-core/src/docuvia-api.ts:476`: `checkTierBGate -> checkTierBGate` becomes `checkTierBGate -> lib/ui-core/src/workflows/analyze/tier-b-gate.ts#checkTierBGate`.
- `lib/ui-core/src/workflows/analyze/analyze-workflow.ts:553`: `AnalyzeWorkflow.persistDecisions -> itself` becomes `AnalyzeWorkflow.persistDecisions -> lib/ui-core/src/workflows/analyze/persist-l3-decisions.ts#persistDecisions`.

The 3,187 Q1 sites break down as:

- 357 changed per-site target projections: 355 had no ScopeResolver target and 2 resolved to the caller itself.
- 2,830 sites kept the same caller and target pair as ScopeResolver; 2,832 sites had a ScopeResolver target to compare.
- Caller-node changes: **0**. For every site, Q1 uses ScopeResolver's caller attribution and supplies only the proven target.

The parity appendix lists each changed link and its justification. There are no changes attributable to caller re-attribution or an unproven Q1 site. The set comparison deduplicates graph links, so call sites sharing the same ScopeResolver caller and proven target collapse to one added link.

## Impact accuracy eval

The latest checked-in baseline, [`impact_accuracy_2026-10-05.summary.md`](../../../evaluate/results/impact_accuracy_2026-10-05.summary.md), reports 8 cases, 0 errors, and mean precision/recall/F1 of `0.375` (below its `0.750` gate). The requested `pnpm eval:impact` run did not score the corpus: its scorer unit file passed 4/4 tests, then the integration setup's `docuvia init` exited 1 before case evaluation. Reproducing that init command reported sandbox `listen EPERM` while tsx opened `/var/folders/fx/nwt35w8j1pd38t25j8vl98940000gn/T/tsx-501/16875.pipe`. The current impact metric is therefore unavailable and cannot be compared with the baseline; no second scored attempt was made.

## Reproduction and hashes

Commands used (Node `v24.14.1`, TypeScript `5.9.3`):

```bash
node --import tsx scripts/semantic-corpus/phase3-q1-named-import-proof-audit.mts --out /private/tmp/docuvia-phase3-q1-proof-audit-final.json
node --import tsx scripts/semantic-corpus/phase3-q1-named-import-whole-source-parity.mts --snapshot-root /private/tmp/docuvia-q1-source-HEAD-eadea327 --out /private/tmp/docuvia-phase3-q1-whole-source-parity-caller-policy.jsonl
```

| Artifact/input                      | SHA-256                                                            |
| ----------------------------------- | ------------------------------------------------------------------ |
| TRAIN/CALIBRATION audit JSON output | `426574e1c7d350421d10e4a91c6dd8aa1191579039f094835a0a4bc8ac433c58` |
| Whole-source parity JSONL appendix  | `14064070bdf44d71bcb5f4f3850f00dcbef7db52aa5a9d36e6ae4663a8abe996` |
| Whole-source source manifest        | `09d54b304753392293342053061c5c611126cfcffbe3b078a3aa35035d13f624` |
| Frozen Q1 implementation bundle     | `86f6554ae11d1e6037bf209a2c793a79319c31992edd4bc0a953f8ada9fa4c1c` |
| Corpus audit runner                 | `965d4dfe4999f46df6890c6db0aa1823d03c9d4c17f7ada548f4457531fc042e` |
| Whole-source parity runner          | `561f9fc1aa663a036b155e101ac25e831021737ab50e11ee1d34978ddea1843e` |
| Pinned `callsites.jsonl`            | `b61764cdaa1168ba453689c5e11f6a9b035a05273532068648092c48a0dbd362` |
| Pinned declared-type facts pass A   | `ba7b631b36ed05b1f16c6b500b0c17b5e4273acd939a493800848225c4dad14e` |
| TRAIN label records                 | `d32a13e929f7678a36f35a86a2a598cd0aa86b23421aea5a70a3562791e4ddcc` |
| CALIBRATION label records           | `b629b3fbab15c1d3bb62c70874e6f20efd518191a214f6bafce974a52e948af9` |

No product decision is needed for this slice. Exact-caller calls projection remains a deferred follow-up requiring a uniform all-sites change and its own impact-accuracy evidence.
