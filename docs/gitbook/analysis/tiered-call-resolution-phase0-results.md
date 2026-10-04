# GRPH-008 Phase 0 — Measurement Gate

Phase 0 passed its measurement and position-accounting gate. This report records a pinned baseline for [GRPH-008](../adr/graph/GRPH-008-tiered-call-resolution.md); it does not certify a rule, promote a call signature, or authorize skipping Tier B.

## Run identity and denominator

The fixed-source run completed at `2026-10-02T16:33:48.681Z` with Node `v24.14.1` and TypeScript `5.9.3`.

| Provenance                                          | Value                                                                                                                                                                                                                                                                             |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repository base commit                              | `fde5717c29f99418e77d58492b46163dced35d9e`                                                                                                                                                                                                                                        |
| Measurement implementation fingerprint              | `b5878f7ab233b21176d5c8f39511dd7655fd24cebbedfb00076f49eb5edcd265`                                                                                                                                                                                                                |
| Corpus manifest SHA-256                             | `f00c5b8fc6fada04fc0934dbc7b19157cf3b380f0a94fc46e596a3186dbd4c61`                                                                                                                                                                                                                |
| Collection report SHA-256                           | `159413d22bee7c14f0e76e510e06d7110f897732f4e6413653a4c37b80938c14`                                                                                                                                                                                                                |
| Corpus spec SHA-256                                 | `867b96f393be018c7552036b18d8164d8fcdd9f21fe8d3a2f100d674fd64e69a`                                                                                                                                                                                                                |
| Train / calibration / temporal / test state SHA-256 | `69746f7f91f12d53d4f4d6204941fcd565bd5957828fb76e9ae2703c0d8bcf0b` / `18463d81249d8e0d2287c29de99d6ad2d85f0156ca9e07d5b0885383a429b088` / `6624bfbc03e6ea971da149ae7c18db33b274bbf246a6f8cf18c9f8e8c54101a7` / `fba0f158a0a96378974f9e4966846816a07b282cb1adc07d2827ff43e90696c1` |

The run emitted all **31,578 / 31,578** manifest rows. **31,571** source positions mapped uniquely; **7** were preserved with `no-call-at-position`. Those seven rows are from Nest at the following source coordinates; each also lacks a matching saved System-1 state and is counted as a no-state abstention by query replay:

```text
github.com/nestjs/nest@b1014b6862c3::packages/core/errors/exceptions/invalid-class-scope.exception.ts:12:10
github.com/nestjs/nest@b1014b6862c3::packages/core/errors/exceptions/invalid-class.exception.ts:5:10
github.com/nestjs/nest@b1014b6862c3::packages/core/injector/instance-loader.ts:56:26
github.com/nestjs/nest@b1014b6862c3::packages/microservices/server/server-kafka.ts:450:31
github.com/nestjs/nest@b1014b6862c3::packages/microservices/server/server-rmq.ts:319:25
github.com/nestjs/nest@b1014b6862c3::packages/microservices/server/server-rmq.ts:359:30
github.com/nestjs/nest@b1014b6862c3::packages/microservices/server/server.ts:232:31
```

All **10 / 10** pinned snapshot hashes matched, all **14,836** relevant tracked paths were preflighted, and no snapshot had a hard integrity exclusion. Eleven regular, contained source files exceeded the 512,000-byte discovery cap; they are non-hash inputs and were recorded as soft skips, leaving every snapshot measurable:

| Snapshot(s)                                  | Oversized path                                    |      Bytes |
| -------------------------------------------- | ------------------------------------------------- | ---------: |
| `code-review-graph`                          | `code_review_graph/parser.py`                     |    776,424 |
| `gitnexus-2026-07-24`, `gitnexus-2026-09-25` | `gitnexus/vendor/tree-sitter-c/src/parser.c`      |  3,698,550 |
| `gitnexus-2026-07-24`, `gitnexus-2026-09-25` | `gitnexus/vendor/tree-sitter-dart/src/parser.c`   |  6,049,349 |
| `gitnexus-2026-07-24`, `gitnexus-2026-09-25` | `gitnexus/vendor/tree-sitter-kotlin/src/parser.c` | 33,716,905 |
| `gitnexus-2026-07-24`, `gitnexus-2026-09-25` | `gitnexus/vendor/tree-sitter-swift/src/parser.c`  | 18,224,272 |
| `gitnexus-2026-09-25`                        | `gitnexus/vendor/tree-sitter-objc/src/parser.c`   | 28,317,992 |
| `gitnexus-2026-09-25`                        | `gitnexus/vendor/tree-sitter-zig/src/parser.c`    |  5,843,608 |

The local System-1 corpus had 31,571 rows, all found in the measured source rows; the remaining seven are explicit source-position exclusions. The parser and graph projection agreed on **58,245 / 58,245** call edges across all ten snapshots. Sidecars retain the full denominator and status for every row.

## ScopeResolver and deterministic query results

The production `ScopeResolver` processed **751,881** parsed call sites: 155,781 resolved, 461,763 unresolved, 126,179 unsupported, and 8,158 with an unmapped target. At the labeled corpus sites, candidate recall was **99.68%**, end-to-end top-1 was **43.14%**, and precision among its resolved labeled rows was **95.34%**. Resolver-call p95 was **0.038 ms**.

The deterministic Q1/Q2/Q3 replay used exact UTF-16 source coordinates and the pinned System-1 candidate pool. Labels were joined only after query execution. All 31,571 rows with saved state were evaluated; the seven no-state rows stayed abstentions. No query errors occurred.

| Route            | Commits | Candidate recall | End-to-end top-1 | Coverage | Gain over ScopeResolver |
| ---------------- | ------: | ---------------: | ---------------: | -------: | ----------------------: |
| Q1               |  16,759 |           99.68% |           53.07% |   53.08% |                +9.93 pp |
| Q2               |   2,405 |           99.68% |            7.62% |    7.62% |               −35.52 pp |
| Q3               |   3,632 |           99.68% |           11.50% |   11.50% |               −31.64 pp |
| Q1/Q2/Q3 cascade |  22,351 |           99.68% |           70.78% |   70.80% |               +27.64 pp |

Precision among committed labeled results was 100% for each route in this previously seen regression corpus. Q2 and Q3 contribute narrower, complementary coverage; their standalone top-1 rates reflect high abstention, and their precision on a small committed subset does not establish reliability at scale or on unseen data. Q1/Q2/Q3 request p95 was **0.826 ms**, with 8.664 seconds summed request latency and zero errors.

The receiver taxonomy shows where the aggregate gain comes from and where it does not. `Q candidate recall` is coverage by the pinned candidate pool, not top-1 accuracy. Top-1 values use every source row in that category as the denominator.

| Receiver category       |   Rows | Q candidate recall | ScopeResolver top-1 | Cascade top-1 |      Gain | Cascade commits |
| ----------------------- | -----: | -----------------: | ------------------: | ------------: | --------: | --------------: |
| bare                    | 19,555 |             99.53% |              65.30% |        95.72% | +30.43 pp |          18,719 |
| call-result-chain       |    560 |            100.00% |               0.00% |         0.00% |   0.00 pp |               0 |
| imported-identifier     |  1,749 |             99.54% |              48.77% |         0.00% | −48.77 pp |               0 |
| imported-property-chain |     15 |            100.00% |               0.00% |         0.00% |   0.00 pp |               0 |
| local-identifier        |      9 |            100.00% |               0.00% |        44.44% | +44.44 pp |               4 |
| member-property-chain   |    656 |            100.00% |               0.00% |         0.15% |  +0.15 pp |               1 |
| other-expression        |     59 |            100.00% |               0.00% |         0.00% |   0.00 pp |               0 |
| super                   |     16 |            100.00% |               0.00% |         0.00% |   0.00 pp |               0 |
| this                    |    282 |            100.00% |               0.00% |         0.00% |   0.00 pp |               0 |
| this-property-chain     |  1,866 |            100.00% |               0.00% |        76.10% | +76.10 pp |           1,420 |
| unbound-identifier      |  6,811 |             99.99% |               0.00% |        32.40% | +32.40 pp |           2,207 |

Q1 abstained most often for missing import bindings (10,246), non-unique direct exports (2,091), unsupported non-bare calls (1,777), and call-site context mismatch (492). This points to import/re-export evidence and explicit receiver facts as the useful next hypotheses; the imported-identifier category's zero cascade top-1 also shows those hypotheses remain unproven.

## Per-shape Tier B0 measurement

PartialSemantic ran as a separate, measurement-only TypeScript LanguageService using `PartialSemantic`, `noResolve: true`, and `types: []`. It returned one observation per corpus row; no-result, unsupported, ambiguous, invalid-position, and raw definition outcomes were retained separately. It ran for **105** project configurations with **0** project errors. Across all rows it had **74.07% candidate recall**, **74.00% top-1**, **74.02% coverage**, and 100% precision among committed labeled results. The top-1 result is **3.22 pp** above the deterministic cascade overall, but the benefit overlaps existing candidate/receiver behavior and comes with additional memory and project-startup cost.

| Call shape |   Rows | Scope top-1 |      Q1 / Q2 / Q3 top-1 | Cascade top-1 (gain) | Partial candidate recall / top-1 / coverage | Partial queries; p95 |
| ---------- | -----: | ----------: | ----------------------: | -------------------: | ------------------------------------------: | -------------------: |
| bare       | 19,555 |      65.30% | 85.70% / 12.30% / 0.00% |   95.72% (+30.43 pp) |                    85.59% / 85.50% / 85.53% |     19,548; 0.339 ms |
| member     | 11,165 |       7.64% |  0.00% / 0.00% / 32.53% |   32.53% (+24.89 pp) |                    59.58% / 59.56% / 59.56% |     11,165; 0.242 ms |
| arg-chain  |    560 |       0.00% |   0.00% / 0.00% / 0.00% |      0.00% (0.00 pp) |                       0.00% / 0.00% / 0.00% |       0; unsupported |
| this       |    298 |       0.00% |   0.00% / 0.00% / 0.00% |      0.00% (0.00 pp) |                       0.00% / 0.00% / 0.00% |       0; unsupported |

Separately, the unsupervised TypeScript/JavaScript `this.m()` / `super.m()` census found **7,368** sites, all position-mapped; ScopeResolver resolved 6,593. This census has no gold labels and makes no accuracy claim. The 298 labeled `this`-shape rows above are a different cohort and cannot substitute for this census.

PartialSemantic emitted 26,527 unique-definition results, 25 multiple-definition results, 4,161 no-result results, 858 unsupported results, and 7 invalid-position results. Its 30,713 actual definition queries had **0.069 ms p50 / 0.310 ms p95 / 3.727 seconds summed latency**. Disjoint LanguageService construction and program-readiness intervals summed to 6.620 seconds and 10.708 seconds respectively across 105 configs. The run-wide sampled process RSS peak was **4.59 GB**; this cannot be attributed to a specific LanguageService project. The separate maximum Tier A child peak was **2.54 GB**.

The existing `run-c` collection report is the pinned full-LSP cost record (SHA-256 `159413d22bee7c14f0e76e510e06d7110f897732f4e6413653a4c37b80938c14`; TypeScript Language Server 5.3.0 with tsserver 5.9.3). It records 36,884 LSP requests, 107 process starts/groups, 217 readiness probes, 75.209 seconds summed readiness, 93.517 seconds summed oracle duration, and no unready groups. Those requests and project groups are not a like-for-like cohort or protocol comparison with this Tier B0 measurement, so these figures do not establish that PartialSemantic is cheaper than full LSP.

The measured Tier A cumulative wall time was **70.269 seconds**. The old collection report records **66.334 seconds** for Tier A (ratio 1.059); this is a historical cross-protocol comparison, not a controlled A/B performance gate. Tier A launched no external LSP process. PartialSemantic ran afterward through the embedded TypeScript LanguageService. Use this same-protocol run as the next fixed-corpus reference: resolver-call p95 **0.038041 ms** (2× ceiling **0.076082 ms**), Tier A cumulative wall **70.269 seconds** (10% ceiling **77.296 seconds**), and no LSP process on the post-commit Tier A path. These are future comparison limits, not a claim from this single run that the limits are stable.

## Family and temporal results

Family macro is the unweighted mean of each of the nine family-level top-1 ratios. Candidate recall and top-1 are shown separately so a strong candidate pool cannot mask a weak selection rule.

| Family                                                |  Rows | Scope top-1 | Q candidate recall | Cascade top-1 | PartialSemantic candidate recall / top-1 |
| ----------------------------------------------------- | ----: | ----------: | -----------------: | ------------: | ---------------------------------------: |
| 403errors/repomind                                    | 1,207 |      12.01% |             98.59% |        94.37% |                        100.00% / 100.00% |
| Egonex-AI/Understand-Anything                         | 1,759 |      58.67% |            100.00% |        69.24% |                          97.16% / 97.16% |
| abhigyanpatwari/GitNexus                              | 8,943 |      75.60% |             99.72% |        85.30% |                          96.22% / 96.04% |
| dyphn1/Docuvia                                        | 3,610 |      52.74% |             99.94% |        55.01% |                          94.60% / 94.60% |
| nestjs/nest                                           | 8,000 |      19.89% |             99.89% |        48.61% |                          14.90% / 14.88% |
| onyx-dot-app/onyx                                     | 6,173 |      15.37% |             99.24% |        82.94% |                          87.43% / 87.40% |
| tirth8205/code-review-graph                           |    77 |      12.99% |            100.00% |        33.77% |                        100.00% / 100.00% |
| trailhq/Graft                                         |   888 |      93.81% |            100.00% |        95.61% |                          99.32% / 99.32% |
| typescript-language-server/typescript-language-server |   921 |      43.11% |            100.00% |        53.85% |                          98.26% / 98.26% |
| **Nine-family macro**                                 |     — |  **42.69%** |         **99.71%** |    **68.74%** |                      **87.54% / 87.52%** |

The weakest cascade family was code-review-graph (33.77%, 77 rows); the weakest PartialSemantic family was Nest (14.88%, 8,000 rows); ScopeResolver's weakest was RepoMind (12.01%, 1,207 rows). On the 2,694-row temporal split, ScopeResolver top-1 was 94.43%, the cascade 90.94%, and PartialSemantic 97.36%. This temporal split had already informed #553 and the design; it is regression evidence, not unseen certification data.

## Phase 0 decision and limits

The measured query cascade remains provisional. Its aggregate gain is concentrated in bare calls and the `this-property-chain` category; imported identifiers, argument chains, and `this`/`super` need distinct evidence. Prioritize Q1 import/re-export binding and explicit receiver facts for member calls, then measure each receiver family separately as those facts are introduced.

PartialSemantic remains **measurement-only**. Its 3.22 pp aggregate top-1 advantage over the cascade is not enough to adopt it as the production Tier B path given overlapping evidence, 4.59 GB run-wide sampled RSS, 17.328 seconds summed project startup/readiness, and the absence of a comparable same-cohort full-LSP cost run. Later type facts could improve Q3 member coverage; Phase 2 must measure that before an adoption decision.

ECE and Brier score are **not applicable**: Q1/Q2/Q3 emit deterministic proofs or abstentions and this run produced no calibrated probabilities. No rule was certified, no call-site signature was promoted, and Tier B was not skipped. The train, calibration, temporal, test, and System-1 data were already seen during #553/design and remain regression-only. Final certification requires a separately pinned unseen repository family and newer temporal revision; keep their labels unopened until the resolver and signature hashes are frozen. No fresh certification dataset is pinned by this report.

## Reproducibility artifacts

The complete JSONL outputs are local, ignored artifacts under `evaluate/results/semantic-corpus/v1/phase0-tiered-call-resolution/`. The checksums manifest SHA-256 is `ac414d947b95389637dfef92d7049890589092698b2b1a61afc873f277531471`; the manifest covers all eight output files:

| Output                               | SHA-256                                                            |
| ------------------------------------ | ------------------------------------------------------------------ |
| `callsites.jsonl`                    | `ae8a96121ea70227ce63f408ddf4f89e799b098480350b962efe7b637ca2c5b3` |
| `scope-resolver-baseline.jsonl`      | `eb03864fad5289955a2cc2528987dd8ae308433e1234aaad2ba6de4d251fb18b` |
| `labels.jsonl`                       | `ce0c0bcbbf3c20b47ada2b6c5cccadfafda6a4a5978d8f668c068d88cba6c4c7` |
| `this-member-baseline.jsonl`         | `b0ab9b328b99da0b37c2b6770d1f0cb969ae3c414546bcb25d4ce5fd6eaf73b2` |
| `deterministic-query-baseline.jsonl` | `7dd48142ce4f8e78a5c954b052514e0c90a6de6b929db09d6e2787f552e48c56` |
| `partial-semantic.jsonl`             | `54698159cae7b6fff23802c62d9f7dea5d357315bff5487afc59cc733469fbd9` |
| `partial-semantic-evaluation.jsonl`  | `206c00f610836832f6c258c15962c1e3220a62501d1de651d37025bc6a3da4f7` |
| `summary.json`                       | `552dc79baf93a092d54b934aa8818f4e196f7beeaf9b1a7e46affb9c5157826c` |

An independent audit recomputed the implementation fingerprint and input/output hashes, verified all four full sidecar ID sets contained the same 31,578 unique samples, and confirmed the call-site sidecar contains source-only fields. The earlier rejected run is retained locally at `evaluate/results/semantic-corpus/v1/phase0-tiered-call-resolution-rejected-e896e23c4/` and is not used for conclusions.
