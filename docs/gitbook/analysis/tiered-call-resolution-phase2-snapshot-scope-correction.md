# GRPH-008 P2-A/P2-B — Snapshot-scoped evaluation correction

**Status:** Evaluation-only correction. Source prediction behavior is unchanged. The initial correction run covered train/calibration; a separate fixed v2/v3 candidate-only regression evaluated test and temporal once on 2026-10-04 under the corrected scope join. Those labels are exposed regression data, not unseen confirmation or certification. No rule, threshold, or production behavior was selected or changed from them.

This correction follows [#559 comment 5969397300](https://github.com/dyphn1/Docuvia/issues/559#issuecomment-5969397300): cheap facts and candidate recall precede ranking, while difficult or uncertain calls remain on Tier B. It does not change the candidate generator, ranker, `likely`/`proven` boundary, completeness gate, production resolver, or Tier B scheduling.

## Finding and correction

The post-hoc oracle mapper used by P2-A and P2-B received facts from all ten snapshots at once. It keyed declarations and aliases without snapshot identity, so the same file/target in two snapshots could be counted as a collision. Source prediction generation already builds its candidate index from facts filtered to the current snapshot; the defect was in evaluation joins.

The evaluator now maps aliases within `(snapshotId, repoId)` and each prediction carries those source identities. A prediction with no matching scope fails closed for alias scoring. The production candidate target key and candidate set are unchanged. Regression tests cover an identical declaration in different snapshots, an actual same-snapshot duplicate, and a missing snapshot scope.

The old unscoped allowlist contained 72,676 unique alias entries. The corrected map contains 119,141 unique alias entries across ten snapshot/repository scopes (153,585 total alias entries before uniqueness filtering). The old and new mapping hashes are recorded in the evidence artifact.

## Candidate generator provenance

The scoped predictions used for the regression are `declared-member-hypothesis-v3`, not the v2 baseline. Their schema-v2 manifest records the `snapshotId+repoId` oracle scope, `labelsRead: false`, corrected facts hash `ba7b631b36ed05b1f16c6b500b0c17b5e4273acd939a493800848225c4dad14e`, and call-site hash `b61764cdaa1168ba453689c5e11f6a9b035a05273532068648092c48a0dbd362`. Prediction bytes are `3c3ff5a8b86bc58497faf4f9e357e7bc21d2853bd3a8d94d3f0023a46a41ab0f`; manifest bytes are `685c7765f668e64df19f13e998dfc11a3e8b0f5e9a2aa26ae3049b5e50a66bd2`.

This is the same v3 source candidate output as attempt-3 `3f9324a4002fa327123e8cb926aea2ae23544c4f1512d8d19c23a52a040739ed`: all 31,578 sample IDs match, with zero differences in candidate target sets, call shapes, rule signatures, top candidate, truncation, unsupported-shape, or reason fields. The scoped rows add `snapshotId` and `repoId` required by the corrected evaluator. Both manifests declare the same facts and call-site hashes. The v3 candidate index source hash is `49c6156abaa969b9f7f4645a0f55d5b06b4cc994bf66ba59831237af9b8edfba`; it adds named top-level `program` arrows using their declaration spans. Candidate recall below does not evaluate ranking or treat rank scores as probabilities.

## Train and calibration results

The same train/calibration label rows, corrected facts and candidate behavior were used for both mapper versions. Their candidate metrics and System One metrics are identical on both splits. The additional aliases therefore fix scope semantics and protect future cohorts, but do not explain the earlier held-out score drop.

| Split       | Eligible sites | Unique-mappable positive targets covered / denominator | Candidate recall | Ambiguous / unmapped positive occurrences | Zero candidates, all eligible sites | Candidate size p50 / p95, all eligible sites |
| ----------- | -------------: | -----------------------------------------------------: | ---------------: | ----------------------------------------: | ----------------------------------: | -------------------------------------------: |
| Train       |         13,496 |                                        12,167 / 12,177 |         99.9179% |                                 861 / 469 |                         471 (3.49%) |                                       1 / 64 |
| Calibration |          2,966 |                                          2,749 / 2,766 |         99.3854% |                                  13 / 187 |                         194 (6.54%) |                                       1 / 23 |

The unique-mappable target denominator counts positive target occurrences; the site denominator remains every confirmed site. Train has 12,177 sites with a unique positive and 1,319 without one. Calibration has 2,766 and 200 respectively. Train has ten unique-mappable positive misses (three `no-supported-candidates`, seven `unspecified`); calibration has 17, all `no-supported-candidates`.

### Source evidence for train/calibration misses

The row audit reads only train or calibration labels and joins each miss to the matching `(snapshotId, repoId, filePath)` facts. All 27 missed target rows map to exactly one declaration fact. All are zero-candidate misses; none has a candidate set that omits a unique-mappable target.

| Split       | Family               | Source call shape → prediction call shape | Reason                    | Miss sites | Source/facts finding                                                                                                                                                      |
| ----------- | -------------------- | ----------------------------------------- | ------------------------- | ---------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Train       | `dyphn1/Docuvia`     | `bare` → `bare`                           | `no-supported-candidates` |          2 | `docuvia-api.ts` imports `listHooks` and `setHookEnabled` under local aliases `listHooksWorkflow` and `setHookEnabledWorkflow`; each target has one facts declaration.    |
| Train       | `nestjs/nest`        | `bare` → `bare`                           | `no-supported-candidates` |          1 | `Module` is imported as `ModuleDecorator`; the target has one facts declaration.                                                                                          |
| Train       | `nestjs/nest`        | `bare` → `unmapped`                       | `call-shape-unmapped`     |          7 | Tagged-template calls to message helpers have no indexed call-shape fact. Their target facts are named top-level arrows; the calls stay unsupported and fall back to LSP. |
| Calibration | `403errors/repomind` | `bare` → `bare`                           | `no-supported-candidates` |         17 | Caller bindings use renamed imports, underscore aliases, or a renamed default-page import; each labeled target has one facts declaration.                                 |

The 20 import-binding misses are evidence for a later narrow import-alias candidate-enrichment slice. The seven tagged-template misses remain unsupported. This audit adds no candidates and changes no runtime behavior.

Candidate set sizes and zero-candidate sites use the full eligible-site denominator:

| Split / group                                                   | Sites | Zero candidates | Size p50 / p95 |
| --------------------------------------------------------------- | ----: | --------------: | -------------: |
| Train / `dyphn1/Docuvia`                                        | 3,610 |               2 |         3 / 44 |
| Train / `nestjs/nest`                                           | 8,000 |             464 |         1 / 70 |
| Train / `tirth8205/code-review-graph`                           |    77 |               0 |          1 / 3 |
| Train / `trailhq/Graft`                                         |   888 |               0 |          1 / 2 |
| Train / `typescript-language-server/typescript-language-server` |   921 |               5 |         1 / 97 |
| Calibration / `403errors/repomind`                              | 1,207 |              18 |          1 / 5 |
| Calibration / `Egonex-AI/Understand-Anything`                   | 1,759 |             176 |         1 / 23 |
| Train / `arg-chain`                                             |   517 |               0 |         2 / 15 |
| Train / `bare`                                                  | 5,684 |             464 |          1 / 8 |
| Train / `member`                                                | 7,087 |               0 |         3 / 73 |
| Train / `this`                                                  |   201 |               0 |         2 / 10 |
| Train / `unmapped`                                              |     7 |               7 |          0 / 0 |
| Calibration / `bare`                                            | 2,222 |             194 |          1 / 4 |
| Calibration / `member`                                          |   744 |               0 |        14 / 35 |

## System One ranking: train development and calibration only

Train remains descriptive. Its raw top-1 is 10,783 / 13,496 (79.90%); 12,177 labels are uniquely scorable and 1,319 are not. No threshold is selected from train.

On calibration, raw top-1 is 2,664 / 2,966 (89.82%). The calibration-only threshold remains score `0`, selected for maximum coverage subject to accepted-site and conservative duplicate-group precision of at least 90%. It selects 2,668 / 2,966 sites (89.95% coverage) and abstains on 298 (10.05%). There are 2,661 correct selected sites, so conservative accepted-site precision is 2,661 / 2,668 (99.74%) and end-to-end top-1 is 2,661 / 2,966 (89.72%). Duplicate-group precision is 2,423 / 2,445 (99.10%). All 2,668 selected sites still have incomplete candidate inventories; these are evaluator `likely` rows and do not authorize Tier B skips.

| Calibration group               | Sites |              Raw top-1 | Selected / coverage | Accepted-site precision | End-to-end top-1 |
| ------------------------------- | ----: | ---------------------: | ------------------: | ----------------------: | ---------------: |
| `403errors/repomind`            | 1,207 | 1,156 / 1,207 (95.77%) |      1,160 / 96.11% |  1,153 / 1,160 (99.40%) |           95.53% |
| `Egonex-AI/Understand-Anything` | 1,759 | 1,508 / 1,759 (85.73%) |      1,508 / 85.73% |    1,508 / 1,508 (100%) |           85.73% |
| `bare`                          | 2,222 | 1,987 / 2,222 (89.42%) |      1,994 / 89.74% |  1,987 / 1,994 (99.65%) |           89.42% |
| `member`                        |   744 |     677 / 744 (90.99%) |        674 / 90.59% |        674 / 674 (100%) |           90.59% |

Train raw top-1 by family is 79.92% Docuvia, 77.16% Nest, 100% code-review-graph, 97.86% Graft, and 84.58% TypeScript Language Server. By call shape it is 79.88% arg-chain, 85.94% bare, 76.18% member, 42.79% `this`, and 0% unmapped. Calibration group counts above show the two families and two mapped call shapes represented there.

The rank score is ordinal evidence ordering, not a probability. ECE and Brier score are not applicable. The source-only correction run regenerated 31,578 rows across ten snapshots in about 56.0 seconds and parsed 3,426 call-site files with zero parse failures. Predictions-only mode does not emit per-call timing quantiles. The closest comparable recorded timing is the earlier attempt-3 run using the same hypothesis-call quantile code: p50 0.013875 ms and p95 0.215875 ms across 31,571 mapped calls (1,649.83 ms accumulated hypothesis time). These are historical timings, not a measurement from this correction run; no latency change can be inferred. Peak RSS and end-to-end request latency were not measured.

## Frozen test/temporal candidate-only regression

The fixed comparison used v2 predictions `3a250e913a1927376adbb7309d3281d3454a51e18abbe7d181c0f923da328aa5` and the v3 scoped predictions above, then applied one corrected `(snapshotId, repoId)` oracle mapping and one candidate-only evaluator. It did not run System One ranking, select a threshold, or choose a rule. All-site metrics use every confirmed site; candidate recall uses only uniquely mapped positive target occurrences. Ambiguous and unmapped labels are reported separately.

| Split    | All confirmed sites | Unique-mappable positive target occurrences | Ambiguous / unmapped positive occurrences | V2 covered / recall | V3 covered / recall | All-site zero candidates, V2 → V3 | Candidate size p50 / p95, V2 → V3 |
| -------- | ------------------: | ------------------------------------------: | ----------------------------------------: | ------------------: | ------------------: | --------------------------------: | --------------------------------: |
| Test     |              12,422 |                                      11,547 |                                 521 / 354 |    9,804 / 84.9052% |   11,492 / 99.5237% |      1,570 (12.64%) → 336 (2.70%) |                   1 / 32 → 1 / 32 |
| Temporal |               2,694 |                                       2,651 |                                    7 / 36 |    1,747 / 65.8997% |    2,644 / 99.7359% |         572 (21.23%) → 29 (1.08%) |                   1 / 26 → 1 / 28 |

The v3 source sets add 2,067 uniquely mapped candidate memberships and cover 1,688 additional targets on test, and add 1,069 memberships and cover 897 additional targets on temporal. Neither comparison removes a v2 unique candidate membership. This is exposed-data regression evidence, not certification.

| Test group      | Sites for zero/size metrics | Unique-mappable target denominator | V2 → V3 candidate recall | Zero candidates, V2 → V3 | Size p50 / p95, V2 → V3 |
| --------------- | --------------------------: | ---------------------------------: | -----------------------: | -----------------------: | ----------------------: |
| GitNexus family |                       6,249 |                              6,178 |          78.29% → 99.72% |                 917 → 22 |         1 / 22 → 1 / 24 |
| Onyx family     |                       6,173 |                              5,369 |          92.51% → 99.29% |                653 → 314 |       1 / 305 → 1 / 305 |
| `arg-chain`     |                          33 |                                 33 |              100% → 100% |                    0 → 0 |         3 / 21 → 3 / 21 |
| `bare`          |                       9,093 |                              8,802 |          80.20% → 99.38% |              1,570 → 336 |           1 / 5 → 1 / 5 |
| `member`        |                       3,199 |                              2,615 |              100% → 100% |                    0 → 0 |       2 / 305 → 2 / 305 |
| `this`          |                          97 |                                 97 |              100% → 100% |                    0 → 0 |       18 / 56 → 18 / 62 |

| Temporal group  | Sites for zero/size metrics | Unique-mappable target denominator | V2 → V3 candidate recall | Zero candidates, V2 → V3 | Size p50 / p95, V2 → V3 |
| --------------- | --------------------------: | ---------------------------------: | -----------------------: | -----------------------: | ----------------------: |
| GitNexus family |                       2,694 |                              2,651 |          65.90% → 99.74% |                 572 → 29 |         1 / 26 → 1 / 28 |
| `arg-chain`     |                          10 |                                 10 |              100% → 100% |                    0 → 0 |           3 / 3 → 3 / 3 |
| `bare`          |                       2,549 |                              2,527 |          64.23% → 99.72% |                 572 → 29 |         1 / 26 → 1 / 26 |
| `member`        |                         135 |                                114 |              100% → 100% |                    0 → 0 |         4 / 54 → 4 / 54 |

The Onyx family and test `member` shape retain a high-fanout p95 of 305 candidates. Candidate recall does not imply small candidate sets or validate ranking quality. Test v3 has 55 unique-positive miss sites (51 zero-candidate and four candidate-but-miss); temporal v3 has seven, all zero-candidate.

The earlier Phase 2 table's **83.12% test** and **65.11% temporal** values are candidate recall reported on eligible-site denominators of 12,422 / 2,694; its separate raw top-1 values are **69.76%** and **59.13%**. The corrected v2/v3 comparison excludes 875 test and 43 temporal sites without a unique-mappable positive target and drops ambiguous candidate aliases before scoring. The old 83.12/65.11 and corrected v2 84.91/65.90 therefore use different mapping domains. The v3 99.52/99.74 values are corrected-scope candidate recall over unique-mappable positive target occurrences, not top-1 accuracy.

The separate frozen P2-B System One report gives raw top-1 of **38.92% test** and **45.29% temporal**, and selected end-to-end top-1 of **37.92%** and **44.65%**, each over all eligible sites under its earlier ranker/evaluator artifacts. Those ranking figures are not candidate recall and are not directly comparable with this candidate-only v2/v3 result. The corrected candidate mapping's effect on the P2-B heldout ranking results remains unknown; no cause is inferred from these distinct metrics.

The prior P2-B System One held-out artifacts remain untouched and retain their original evaluation definition. These candidate-only outputs do not validate ranking, precision, calibration, certification, or Tier B skipping.

## Reproduction

Run from the repository root with Node `v24.14.1`. Source prediction generation is label-free and its manifest records `labelsRead: false`. The train/calibration audit commands below read only their named split. The test/temporal candidate-only commands were run once on 2026-10-04 against the frozen v2/v3 predictions; they opened only the named split and did not invoke System One, select a rule, or tune a threshold. They are included as reproducibility records for already-exposed regression data, not as instructions to repeat or certify the result.

```sh
PATH=/Users/daniel.chang/.nvm/versions/node/v24.14.1/bin:$PATH pnpm exec tsx scripts/semantic-corpus/phase2-tiered-call-resolution-runner.mts --predictions-only --out evaluate/results/semantic-corpus/v1/phase2-snapshot-scope-correction-attempt-1

PATH=/Users/daniel.chang/.nvm/versions/node/v24.14.1/bin:$PATH pnpm exec tsx scripts/semantic-corpus/phase2-tiered-call-resolution-candidate-evaluation.mts --predictions evaluate/results/semantic-corpus/v1/phase2-snapshot-scope-correction-attempt-1/predictions.jsonl --baseline-predictions evaluate/results/semantic-corpus/v1/phase2-tiered-call-resolution/predictions.jsonl --split train

PATH=/Users/daniel.chang/.nvm/versions/node/v24.14.1/bin:$PATH pnpm exec tsx scripts/semantic-corpus/phase2-tiered-call-resolution-candidate-evaluation.mts --predictions evaluate/results/semantic-corpus/v1/phase2-snapshot-scope-correction-attempt-1/predictions.jsonl --baseline-predictions evaluate/results/semantic-corpus/v1/phase2-tiered-call-resolution/predictions.jsonl --split calibration

PATH=/Users/daniel.chang/.nvm/versions/node/v24.14.1/bin:$PATH pnpm exec tsx scripts/semantic-corpus/phase2-tiered-call-resolution-candidate-miss-audit.mts evaluate/results/semantic-corpus/v1/phase2-snapshot-scope-correction-attempt-1/predictions.jsonl train /tmp/candidate-miss-audit-train.json

PATH=/Users/daniel.chang/.nvm/versions/node/v24.14.1/bin:$PATH pnpm exec tsx scripts/semantic-corpus/phase2-tiered-call-resolution-candidate-miss-audit.mts evaluate/results/semantic-corpus/v1/phase2-snapshot-scope-correction-attempt-1/predictions.jsonl calibration /tmp/candidate-miss-audit-calibration.json

PATH=/Users/daniel.chang/.nvm/versions/node/v24.14.1/bin:$PATH pnpm exec tsx scripts/semantic-corpus/phase2-tiered-call-resolution-candidate-evaluation.mts --predictions evaluate/results/semantic-corpus/v1/phase2-snapshot-scope-correction-attempt-1/predictions.jsonl --baseline-predictions evaluate/results/semantic-corpus/v1/phase2-tiered-call-resolution/predictions.jsonl --split test --out /tmp/p2a-v2-v3-locked-test.json

PATH=/Users/daniel.chang/.nvm/versions/node/v24.14.1/bin:$PATH pnpm exec tsx scripts/semantic-corpus/phase2-tiered-call-resolution-candidate-evaluation.mts --predictions evaluate/results/semantic-corpus/v1/phase2-snapshot-scope-correction-attempt-1/predictions.jsonl --baseline-predictions evaluate/results/semantic-corpus/v1/phase2-tiered-call-resolution/predictions.jsonl --split temporal --out /tmp/p2a-v2-v3-locked-temporal.json

PATH=/Users/daniel.chang/.nvm/versions/node/v24.14.1/bin:$PATH pnpm exec tsx scripts/semantic-corpus/phase2-tiered-call-resolution-system1-runner.mts --mode develop --predictions evaluate/results/semantic-corpus/v1/phase2-snapshot-scope-correction-attempt-1/predictions.jsonl --out evaluate/results/semantic-corpus/v1/phase2-p2b-snapshot-scope-correction-attempt-1

PATH=/Users/daniel.chang/.nvm/versions/node/v24.14.1/bin:$PATH pnpm exec tsx scripts/semantic-corpus/phase2-tiered-call-resolution-system1-runner.mts --mode calibrate --predictions evaluate/results/semantic-corpus/v1/phase2-snapshot-scope-correction-attempt-1/predictions.jsonl --out evaluate/results/semantic-corpus/v1/phase2-p2b-snapshot-scope-correction-attempt-1
```

The source prediction SHA-256 is `3c3ff5a8b86bc58497faf4f9e357e7bc21d2853bd3a8d94d3f0023a46a41ab0f`; its schema-v2 manifest SHA-256 is `685c7765f668e64df19f13e998dfc11a3e8b0f5e9a2aa26ae3049b5e50a66bd2`. It declares `labelsRead: false`, 31,578 rows, and ten snapshot/repository scopes.

The calibration freeze records candidate generator `declared-member-hypothesis-v3`, ranking policy `ordered-evidence-v1`, configuration hash `805e2af39085c8df5a5b8dc7bf63f33ad484d9fb9fc983337c1d496e825e61b9`, source implementation hash `5d6a9c3d332c9ea744eaa17c49b0f0873f6f4bb606375bf482cf29aa9a28d3ca`, System One plus mapping implementation hash `4c284d5033ddb3866d4f7b405269623af95d97563c87d4fc20cc201080bf3c94`, split assignment hash `41c9c0649c6e68d2afc4c66c8978ea3dfacbfbd78a67760f1f167b4cabeda595`, and calibration input fingerprint `4e065bfed707f897af6194728368eb363d0cb54c4f5cbac91f66bb92686a49c4`.

| Result artifact                               | SHA-256                                                            |
| --------------------------------------------- | ------------------------------------------------------------------ |
| Train candidate recall                        | `2becb74c1e2d30bb63df24b8d471393bc5cba66cf1149ea4d77ac5a1073a6cbf` |
| Calibration candidate recall                  | `bc216c9d679212ae611aed269bc4a76e5dd4b819c6e09856ee4ddd1d12fea681` |
| Train System One development                  | `e1cb14259c8adf397916d124563534a6b41d222779796c148e14ff82ed57f49c` |
| Calibration System One metrics                | `fdf580d2ff41ff368342190b16197f149588c4584cb10522fd0812a558f27a4b` |
| Frozen calibration threshold (score `0`)      | `45cc38678a530c8f79bb1a004dfe4282e47934689a1172d35c4b561cf9051bfd` |
| Snapshot-scope comparison                     | `846cbfeed81b80242ab499bf1ac352f4a15bdd661616c2c81b70ec878009e52c` |
| Corrected-scope test candidate regression     | `9254facfcb579c211c2f97f410c82d781c248e2679a0f024cccd20b6026e0aeb` |
| Corrected-scope temporal candidate regression | `f03cccc1146c4e64b596373c0d249c439db5bb7252ca5534d431acb6300ac1d4` |
| Train source-miss audit                       | `91791c5d9500274b221087636fe88181d1a85624be077eae1eccf08410c53ca6` |
| Calibration source-miss audit                 | `41e0ceae9784b42fdbb0d92fe776b8e752e375851c4ef7ff0e453c50d811d9db` |

Input hashes: corrected facts `ba7b631b36ed05b1f16c6b500b0c17b5e4273acd939a493800848225c4dad14e`; call-site rows `b61764cdaa1168ba453689c5e11f6a9b035a05273532068648092c48a0dbd362`; train labels `4983b8bd52ca2c8048fd5fc9a5f4b8efdb6f7d48843740044e097e7901f9f62a`; calibration labels `5b2892aa4be1ea53c76ff6dc189c0c78c3bf3d83af61639cbd1c59716710c426`; test labels `6a65cb34cac9f395a81179a2f24bfc9d4f16e739cbb14455726108cf3073a0eb`; temporal labels `268770bbe2ff8c1b49b7ac6fe7ae10f0cd9ea3d9da3243b602b8d4b89e524c3f`. The snapshot mapping hash is `3088674bee530052f7b7c5575f0714f217b4774074b92de2b169fe813d89ec81`; the mapping implementation hash is `bf8602f4bb49b0906467ad60d825c5e594ad523dc28dbea016189c4a5a683a2c`; the miss-audit script hash is `39810b2af40ee4777f61b562e22e544b8e31da38ede641bae2f21ec0499b8bec`. The audit verifies the pinned Phase 1 call-site and corrected-facts sidecars and requires both hashes to match the prediction manifest before loading source/facts rows. Machine-readable outputs are in [`tiered-call-resolution-phase2-snapshot-scope-correction-evidence`](tiered-call-resolution-phase2-snapshot-scope-correction-evidence/).
