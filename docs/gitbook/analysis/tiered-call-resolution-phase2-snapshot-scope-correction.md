# GRPH-008 P2-A/P2-B — Snapshot-scoped evaluation correction

**Status:** Evaluation-only correction, verified on train and calibration. Source prediction behavior is unchanged. Test and temporal labels were not read or re-evaluated; the impact of this correction on the earlier held-out results is unknown.

This correction follows [#559 comment 5969397300](https://github.com/dyphn1/Docuvia/issues/559#issuecomment-5969397300): cheap facts and candidate recall precede ranking, while difficult or uncertain calls remain on Tier B. It does not change the candidate generator, ranker, `likely`/`proven` boundary, completeness gate, production resolver, or Tier B scheduling.

## Finding and correction

The post-hoc oracle mapper used by P2-A and P2-B received facts from all ten snapshots at once. It keyed declarations and aliases without snapshot identity, so the same file/target in two snapshots could be counted as a collision. Source prediction generation already builds its candidate index from facts filtered to the current snapshot; the defect was in evaluation joins.

The evaluator now maps aliases within `(snapshotId, repoId)` and each prediction carries those source identities. A prediction with no matching scope fails closed for alias scoring. The production candidate target key and candidate set are unchanged. Regression tests cover an identical declaration in different snapshots, an actual same-snapshot duplicate, and a missing snapshot scope.

The old unscoped allowlist contained 72,676 unique alias entries. The corrected map contains 119,141 unique alias entries across ten snapshot/repository scopes (153,585 total alias entries before uniqueness filtering). The old and new mapping hashes are recorded in the evidence artifact.

## Train and calibration results

The same train/calibration label rows, corrected facts and candidate behavior were used for both mapper versions. Their candidate metrics and System One metrics are identical on both splits. The additional aliases therefore fix scope semantics and protect future cohorts, but do not explain the earlier held-out score drop.

| Split       | Eligible sites | Unique-mappable positive targets covered / denominator | Candidate recall | Ambiguous / unmapped positive occurrences | Zero candidates, all eligible sites | Candidate size p50 / p95, all eligible sites |
| ----------- | -------------: | -----------------------------------------------------: | ---------------: | ----------------------------------------: | ----------------------------------: | -------------------------------------------: |
| Train       |         13,496 |                                        12,167 / 12,177 |         99.9179% |                                 861 / 469 |                         471 (3.49%) |                                       1 / 64 |
| Calibration |          2,966 |                                          2,749 / 2,766 |         99.3854% |                                  13 / 187 |                         194 (6.54%) |                                       1 / 23 |

The unique-mappable target denominator counts positive target occurrences; the site denominator remains every confirmed site. Train has 12,177 sites with a unique positive and 1,319 without one. Calibration has 2,766 and 200 respectively. Train has ten unique-mappable positive misses (three `no-supported-candidates`, seven `unspecified`); calibration has 17, all `no-supported-candidates`.

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

## Held-out comparability

The existing P2-B test/temporal regression artifacts remain untouched. This correction did not read their labels or run a held-out evaluator. The prior P2-B outputs use the older unscoped alias mapper and their original scoring/denominator definition. The earlier Phase 2 figures also come from a different evaluator. The scoped mapper could affect which held-out target aliases are scorable, but its held-out impact is **unknown**; no causal explanation for the score difference is supported by the train/calibration evidence.

The historical held-out outputs remain exposed-data regression evidence only. They are not confirmation under this corrected mapping and are not certification. Do not retune from them.

## Reproduction

Run from the repository root with Node `v24.14.1`. The prediction runner is label-free; only the explicit train and calibration evaluation commands below open labels. No test or temporal evaluation command was run for this correction.

```sh
PATH=/Users/daniel.chang/.nvm/versions/node/v24.14.1/bin:$PATH pnpm exec tsx scripts/semantic-corpus/phase2-tiered-call-resolution-runner.mts --predictions-only --out evaluate/results/semantic-corpus/v1/phase2-snapshot-scope-correction-attempt-1

PATH=/Users/daniel.chang/.nvm/versions/node/v24.14.1/bin:$PATH pnpm exec tsx scripts/semantic-corpus/phase2-tiered-call-resolution-candidate-evaluation.mts --predictions evaluate/results/semantic-corpus/v1/phase2-snapshot-scope-correction-attempt-1/predictions.jsonl --baseline-predictions evaluate/results/semantic-corpus/v1/phase2-tiered-call-resolution/predictions.jsonl --split train

PATH=/Users/daniel.chang/.nvm/versions/node/v24.14.1/bin:$PATH pnpm exec tsx scripts/semantic-corpus/phase2-tiered-call-resolution-candidate-evaluation.mts --predictions evaluate/results/semantic-corpus/v1/phase2-snapshot-scope-correction-attempt-1/predictions.jsonl --baseline-predictions evaluate/results/semantic-corpus/v1/phase2-tiered-call-resolution/predictions.jsonl --split calibration

PATH=/Users/daniel.chang/.nvm/versions/node/v24.14.1/bin:$PATH pnpm exec tsx scripts/semantic-corpus/phase2-tiered-call-resolution-system1-runner.mts --mode develop --predictions evaluate/results/semantic-corpus/v1/phase2-snapshot-scope-correction-attempt-1/predictions.jsonl --out evaluate/results/semantic-corpus/v1/phase2-p2b-snapshot-scope-correction-attempt-1

PATH=/Users/daniel.chang/.nvm/versions/node/v24.14.1/bin:$PATH pnpm exec tsx scripts/semantic-corpus/phase2-tiered-call-resolution-system1-runner.mts --mode calibrate --predictions evaluate/results/semantic-corpus/v1/phase2-snapshot-scope-correction-attempt-1/predictions.jsonl --out evaluate/results/semantic-corpus/v1/phase2-p2b-snapshot-scope-correction-attempt-1
```

The source prediction SHA-256 is `3c3ff5a8b86bc58497faf4f9e357e7bc21d2853bd3a8d94d3f0023a46a41ab0f`; its schema-v2 manifest SHA-256 is `685c7765f668e64df19f13e998dfc11a3e8b0f5e9a2aa26ae3049b5e50a66bd2`. It declares `labelsRead: false`, 31,578 rows, and ten snapshot/repository scopes.

The calibration freeze records candidate generator `declared-member-hypothesis-v3`, ranking policy `ordered-evidence-v1`, configuration hash `805e2af39085c8df5a5b8dc7bf63f33ad484d9fb9fc983337c1d496e825e61b9`, source implementation hash `5d6a9c3d332c9ea744eaa17c49b0f0873f6f4bb606375bf482cf29aa9a28d3ca`, System One plus mapping implementation hash `4c284d5033ddb3866d4f7b405269623af95d97563c87d4fc20cc201080bf3c94`, split assignment hash `41c9c0649c6e68d2afc4c66c8978ea3dfacbfbd78a67760f1f167b4cabeda595`, and calibration input fingerprint `4e065bfed707f897af6194728368eb363d0cb54c4f5cbac91f66bb92686a49c4`.

| Result artifact                          | SHA-256                                                            |
| ---------------------------------------- | ------------------------------------------------------------------ |
| Train candidate recall                   | `2becb74c1e2d30bb63df24b8d471393bc5cba66cf1149ea4d77ac5a1073a6cbf` |
| Calibration candidate recall             | `bc216c9d679212ae611aed269bc4a76e5dd4b819c6e09856ee4ddd1d12fea681` |
| Train System One development             | `e1cb14259c8adf397916d124563534a6b41d222779796c148e14ff82ed57f49c` |
| Calibration System One metrics           | `fdf580d2ff41ff368342190b16197f149588c4584cb10522fd0812a558f27a4b` |
| Frozen calibration threshold (score `0`) | `45cc38678a530c8f79bb1a004dfe4282e47934689a1172d35c4b561cf9051bfd` |
| Snapshot-scope comparison                | `846cbfeed81b80242ab499bf1ac352f4a15bdd661616c2c81b70ec878009e52c` |

Input hashes: corrected facts `ba7b631b36ed05b1f16c6b500b0c17b5e4273acd939a493800848225c4dad14e`; call-site rows `b61764cdaa1168ba453689c5e11f6a9b035a05273532068648092c48a0dbd362`; train labels `4983b8bd52ca2c8048fd5fc9a5f4b8efdb6f7d48843740044e097e7901f9f62a`; calibration labels `5b2892aa4be1ea53c76ff6dc189c0c78c3bf3d83af61639cbd1c59716710c426`. The snapshot mapping hash is `3088674bee530052f7b7c5575f0714f217b4774074b92de2b169fe813d89ec81`; the mapping implementation hash is `bf8602f4bb49b0906467ad60d825c5e594ad523dc28dbea016189c4a5a683a2c`. Machine-readable outputs are in [`tiered-call-resolution-phase2-snapshot-scope-correction-evidence`](tiered-call-resolution-phase2-snapshot-scope-correction-evidence/).
