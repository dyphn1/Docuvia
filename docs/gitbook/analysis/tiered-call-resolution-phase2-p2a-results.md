# GRPH-008 P2-A — Candidate Recall and Set Quality

**Status:** The bounded candidate-recall slice is measured. It adds named top-level program arrows as ambiguous candidates. It does not change ranking, thresholds, confidence, completeness proof, or Tier B selection.

Scope follows [#559 comment 5969397300](https://github.com/dyphn1/Docuvia/issues/559#issuecomment-5969397300): cheap facts first, then candidate recall/set quality, with hard cases remaining on Tier B. P2-A evaluates the candidate set even when `candidateSetComplete` is false. Every one of the 31,578 attempt-3 predictions remains incomplete; P2-A does not promote a call or authorize skipping Tier B.

The prior ranking/calibration measurements in [the Phase 2 results](tiered-call-resolution-phase2-results.md) are historical P2-B diagnostics. No ranking thresholds were selected or changed for this candidate-only comparison.

## Bounded source rule

Candidate generator version `declared-member-hypothesis-v3` adds only named `owner.kind=program`, `kind=arrow` declarations with supported TS/TSX/JS facts. Candidate identity uses the declaration span. Same-file duplicate names stay distinct candidate keys; if the source alias does not identify one declaration, the alias is excluded from oracle coverage. Function-local, anonymous, and returned arrows remain out of this slice. Added candidates remain ambiguous, with `candidateSetComplete=false`.

The prediction runner writes all source-only rows and returns before loading labels. Its manifest records `labelsRead=false`; it contains only call-site and corrected-facts source hashes. The comparison then reads train or calibration labels in isolation and scores both the old v2 predictions and v3 predictions with the same evaluator, label rows, corrected facts, and unique alias allowlist.

## Shared comparison domain

The alias allowlist is reconstructed from corrected facts SHA-256 `ba7b631b36ed05b1f16c6b500b0c17b5e4273acd939a493800848225c4dad14e`, using the production candidate-key and unambiguous-alias mapping. It contains 72,676 aliases and hashes to `67ccf482e32d0a83bb0f8ff214ca61ac1cea6d1e6c75507a176679af98641484`. The identical allowlist hash is recorded for v2 and v3 in both split result files.

Old v2 prediction rows include aliases that map to more than one current fact identity. Those cannot count as candidate hits. Applying the shared allowlist removes 11,374 v2 candidate-alias memberships in train and 386 in calibration; v3 already emits only unique aliases. There are zero unmapped candidate-alias memberships in either comparison. After this filtering, every v2 unique candidate membership remains in v3.

| Split       | Confirmed sites | Unique-mappable positive target occurrences | Unique-positive sites | Ambiguous positive occurrences | Unmapped positive occurrences | Sites without a unique positive | V2 covered / recall | V3 covered / recall | Recall change | Raw zero-candidate sites, v2 → v3 |
| ----------- | --------------: | ------------------------------------------: | --------------------: | -----------------------------: | ----------------------------: | ------------------------------: | ------------------: | ------------------: | ------------: | --------------------------------: |
| Train       |          13,496 |                                      12,177 |                12,177 |                            861 |                           469 |                           1,319 |   11,576 / 95.0645% |   12,167 / 99.9179% |    +4.8534 pp |                       1,045 → 471 |
| Calibration |           2,966 |                                       2,766 |                 2,766 |                             13 |                           187 |                             200 |    2,746 / 99.2769% |    2,749 / 99.3854% |    +0.1085 pp |                         197 → 194 |

“Target occurrences” counts labeled positive target entries. “Sites” counts call-site rows; the two counts are reported separately even where they happen to be equal. Zero-candidate counts use all confirmed sites, including sites with no unique-mappable positive target. Candidate recall uses only unique-mappable positive target occurrences and reports the excluded ambiguous and unmapped labels above.

## Candidate additions and set size

The raw generated-candidate count did not decrease at any site. Train adds 835 generated candidates across 724 sites; calibration adds 3 across 3 sites. Under the common alias map, train adds 737 candidate memberships across 647 sites and covers 591 previously uncovered unique positives; calibration adds 3 memberships and covers 3 unique positives. Neither split removes an old uniquely mapped candidate membership.

| Split       | Version | Generated candidates summed across sites | Sites with ≥1 generated candidate | Sites with zero generated candidates | Unique candidate-alias memberships | Candidate size p50 / p95 across all confirmed sites |
| ----------- | ------- | ---------------------------------------: | --------------------------------: | -----------------------------------: | ---------------------------------: | --------------------------------------------------: |
| Train       | v2      |                                  136,631 |                            12,451 |                                1,045 |                             88,849 |                                              1 / 64 |
| Train       | v3      |                                  137,466 |                            13,025 |                                  471 |                             89,586 |                                              1 / 64 |
| Calibration | v2      |                                   11,850 |                             2,769 |                                  197 |                              9,733 |                                              1 / 23 |
| Calibration | v3      |                                   11,853 |                             2,772 |                                  194 |                              9,736 |                                              1 / 23 |

Candidate-size distribution by family and call shape uses all confirmed sites. Recall uses the unique-mappable targets within each group.

| Train group                                             | Sites |  V2 → v3 recall | Candidate size p50 | Candidate size p95 |
| ------------------------------------------------------- | ----: | --------------: | -----------------: | -----------------: |
| `dyphn1/Docuvia`                                        | 3,610 | 99.86% → 99.94% |              3 → 3 |            44 → 44 |
| `nestjs/nest`                                           | 8,000 | 91.96% → 99.88% |              1 → 1 |            70 → 70 |
| `tirth8205/code-review-graph`                           |    77 |     100% → 100% |              1 → 1 |              3 → 3 |
| `trailhq/Graft`                                         |   888 |   99.43% → 100% |              1 → 1 |              2 → 2 |
| `typescript-language-server/typescript-language-server` |   921 |   95.00% → 100% |              1 → 1 |            97 → 97 |
| `arg-chain`                                             |   517 |     100% → 100% |              2 → 2 |            15 → 15 |
| `bare`                                                  | 5,684 | 89.06% → 99.94% |              1 → 1 |              6 → 8 |
| `member`                                                | 7,087 |   99.40% → 100% |              3 → 3 |            73 → 73 |
| `this`                                                  |   201 |     100% → 100% |              2 → 2 |            10 → 10 |
| `unmapped`                                              |     7 |         0% → 0% |              0 → 0 |              0 → 0 |

| Calibration group               | Sites |  V2 → v3 recall | Candidate size p50 | Candidate size p95 |
| ------------------------------- | ----: | --------------: | -----------------: | -----------------: |
| `403errors/repomind`            | 1,207 | 98.33% → 98.58% |              1 → 1 |              5 → 5 |
| `Egonex-AI/Understand-Anything` | 1,759 |     100% → 100% |              1 → 1 |            23 → 23 |
| `bare`                          | 2,222 | 99.01% → 99.16% |              1 → 1 |              4 → 4 |
| `member`                        |   744 |     100% → 100% |            14 → 14 |            35 → 35 |

After the slice, 10 train and 17 calibration unique-mappable positive sites still miss a target. The train misses have reasons `no-supported-candidates` (3) and `unspecified` (7); calibration misses are `no-supported-candidates` (17). The candidate-set completeness flag remains false for every row.

## Frozen holdout and cost notes

Attempt-3 source rules were frozen before the one-time test/temporal regression. Those labels had already been exposed by earlier Phase 2 work and are not certification data. The preserved attempt-3 regression files used the then-current all-positive-label denominator; this follow-up changes only the train/calibration evaluator domain to exclude ambiguous/unmapped target aliases. Test and temporal labels were not re-read or re-scored here, and no rule was chosen from their results.

The source-only attempt-3 runner processed all 10 pinned snapshots and 31,578 rows in 55.9 seconds, parsing 3,426 call-site files with zero failures. Recorded parser time was 10.65 seconds; hypothesis time was 1.61 seconds; measured hypothesis-call latency was p50 0.0136 ms and p95 0.2147 ms. These are the runner’s hypothesis-call timings, not end-to-end request latency. Peak RSS and end-to-end per-call latency were not recorded.

## Reproduction and provenance

Source-only prediction command:

```sh
PATH=/Users/daniel.chang/.nvm/versions/node/v24.14.1/bin:$PATH pnpm exec tsx scripts/semantic-corpus/phase2-tiered-call-resolution-runner.mts --predictions-only --repos /Users/daniel.chang/Desktop/GitHub --out evaluate/results/semantic-corpus/v1/phase2-p2a-named-arrows-attempt-3
```

Train and calibration comparison commands:

```sh
PATH=/Users/daniel.chang/.nvm/versions/node/v24.14.1/bin:$PATH pnpm exec tsx scripts/semantic-corpus/phase2-tiered-call-resolution-candidate-evaluation.mts --predictions evaluate/results/semantic-corpus/v1/phase2-p2a-named-arrows-attempt-3/predictions.jsonl --baseline-predictions evaluate/results/semantic-corpus/v1/phase2-tiered-call-resolution/attempt-4/predictions.jsonl --split train
PATH=/Users/daniel.chang/.nvm/versions/node/v24.14.1/bin:$PATH pnpm exec tsx scripts/semantic-corpus/phase2-tiered-call-resolution-candidate-evaluation.mts --predictions evaluate/results/semantic-corpus/v1/phase2-p2a-named-arrows-attempt-3/predictions.jsonl --baseline-predictions evaluate/results/semantic-corpus/v1/phase2-tiered-call-resolution/attempt-4/predictions.jsonl --split calibration
```

| Artifact                              | SHA-256                                                            |
| ------------------------------------- | ------------------------------------------------------------------ |
| V2 attempt-4 predictions, 31,578 rows | `3a250e913a1927376adbb7309d3281d3454a51e18abbe7d181c0f923da328aa5` |
| V3 attempt-3 predictions, 31,578 rows | `3f9324a4002fa327123e8cb926aea2ae23544c4f1512d8d19c23a52a040739ed` |
| V3 source-only manifest               | `f0b0cd77369bfdc24c09f3ec2637a9c0f7737ada44d41d7fee30bd4c17248918` |
| Train candidate comparison JSON       | `53a45d8aa0574a80fc4acb0bf3339f7f83ede378b30a96df1c5460b988985618` |
| Calibration candidate comparison JSON | `db2454f22dfd69cd3aa6cb6d9a9292b134c5d8f2e9c8335f3a1b36e2daa7e4dd` |

Shared source hashes: `callsites.jsonl` `b61764cdaa1168ba453689c5e11f6a9b035a05273532068648092c48a0dbd362`; corrected declared facts `ba7b631b36ed05b1f16c6b500b0c17b5e4273acd939a493800848225c4dad14e`. V2 implementation hash: `dbae5f856f5ab1d3f8b2432dfe761c9fdfb2eec067a378c960a95959f976b3a0`. V3 implementation hash: `fb1921719c18e792a81b14bedce386a15023374ab9edcbabd6f59a1c803ffcb8`. Train label rows hash: `4983b8bd52ca2c8048fd5fc9a5f4b8efdb6f7d48843740044e097e7901f9f62a`. Calibration label rows hash: `5b2892aa4be1ea53c76ff6dc189c0c78c3bf3d83af61639cbd1c59716710c426`.

The prediction and metric artifacts remain in the ignored `evaluate/results` tree; their hashes and exact reproduction commands are recorded above. This P2-A result does not resume P2-B threshold work, strict proof, canary, snapshot output, or unseen certification.
