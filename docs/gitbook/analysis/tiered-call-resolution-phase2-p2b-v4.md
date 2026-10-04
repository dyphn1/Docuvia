# GRPH-008 P2-B v4 — System One train/calibration evidence

**Status:** The v4 train/calibration ranking, calibration-quality measurements, and TRAIN-only family-transfer diagnostic are analysis evidence; the P2-B quality gate remains **partial**. The current score-0 threshold is bound to the v4 source candidate artifact and calibration labels. Five-fold duplicate-group OOF estimates show a weak member-call reliability lane, per-shape calibration did not improve site- and group-weighted metrics consistently, and family transfer has a weak Graft member lane. No production calibration record was added, no result became `proven`, and Tier B execution/skip behavior did not change. No v4 test/temporal labels or System One heldout mode were run; prior v3 heldout results remain exposed historical evidence and do not qualify as v4 results.

This follows [#559 comment 5969397300](https://github.com/dyphn1/Docuvia/issues/559#issuecomment-5969397300): cheap candidates come first, System One ranks only within that set, and hard or low-evidence calls abstain for LSP. `candidateSetComplete=false` does not block evaluation-only `likely` selections; it continues to block `proven` and does not grant authority to skip Tier B.

## Rule and data boundary

The ranking policy is the existing deterministic `ordered-evidence-v1`; no weights or product resolver behavior changed. Its evidence order is caller visibility, explicit declaration/flow facts, same-scope peer receiver members, parameter count/shape, then weak naming/package/DI signals. Train results are descriptive only. Calibration labels alone select the threshold. The runner's split-isolated label loader receives only the named split and sample IDs. No test or temporal labels were read, no System One heldout mode ran, and the output directory has no `system1-heldout-exposure.json` marker.

The runner verifies the prediction manifest against the pinned source sidecars and builds the `(snapshotId, repoId)` oracle mapping from source facts across the ten recorded scopes; that mapping does not use labels. It then uses `labelsForSplitIsolated` with only the current mode's split and sample IDs: train for descriptive development, calibration for threshold selection. All site-level metrics retain every confirmed eligible site. `scorable` and `unscorable` count whether the positive label targets map uniquely in that snapshot/repository scope; they do not remove a site from the overall denominator. Raw top-1, coverage, abstention, and end-to-end top-1 use all eligible sites. Accepted-site precision uses every selected site as its denominator, including selected sites with unscorable labels; selected-scorable count is not separately emitted, so the reported value is conservative. Duplicate-group precision uses all accepted duplicate groups and treats conflicting positive labels as incorrect.

Candidate recall uses uniquely mapped positive target occurrences, not all sites. Its denominators are 12,177 targets on train and 2,766 on calibration. Separately, the all-eligible zero-candidate denominator is 13,496 train sites and 2,966 calibration sites. Candidate inventory completeness is not an eligibility condition.

## Candidate recall and set size

Candidate recall is from the v4 P2-A candidate evaluator, using the exact source prediction bytes consumed by this P2-B run. It is not System One top-1 accuracy.

| Split       | All eligible sites | Unique-mapped positive target occurrences | Covered / target denominator | Candidate recall | All-site generated-key zero | Generated-key size p50 / p95 / max |
| ----------- | -----------------: | ----------------------------------------: | ---------------------------: | ---------------: | --------------------------: | ---------------------------------: |
| Train       |             13,496 |                                    12,177 |              12,170 / 12,177 |         99.9425% |        468 / 13,496 (3.47%) |                       1 / 64 / 118 |
| Calibration |              2,966 |                                     2,766 |                2,750 / 2,766 |         99.4215% |         193 / 2,966 (6.51%) |                        1 / 23 / 35 |

The source-only rows contain three distinct candidate counts. **Generated keys** are the raw v4 index output; **mapped target IDs** are the oracle-resolvable IDs used by evaluation; **ranker proposals** are candidates remaining after ordered evidence filtering. Train has 468 generated-key-zero sites, 833 sites with no mapped target ID, and 468 with no ranker proposal. Thus 365 sites had one or more generated keys but no mapped target ID; those rows must not be described as source zero-candidate. Calibration has 193 zero sites for each count. The linked machine summary records these counts and distributions, derived from the pinned source predictions without labels.

| Split       | Count layer                 | Zero / all eligible | Size p50 / p95 / max |
| ----------- | --------------------------- | ------------------: | -------------------: |
| Train       | Generated candidate keys    |        468 / 13,496 |         1 / 64 / 118 |
| Train       | Mapped candidate target IDs |        833 / 13,496 |          1 / 35 / 96 |
| Train       | Ranker proposals            |        468 / 13,496 |          1 / 25 / 25 |
| Calibration | Generated candidate keys    |         193 / 2,966 |          1 / 23 / 35 |
| Calibration | Mapped candidate target IDs |         193 / 2,966 |          1 / 14 / 17 |
| Calibration | Ranker proposals            |         193 / 2,966 |           1 / 3 / 25 |

## System One results

At score 0, train is reported descriptively using the threshold later selected on calibration. It is not used to select that threshold.

| Split                            | Eligible (scorable / unscorable) |                Raw top-1 | Selected / coverage |      Abstained | Correct selected / selected | Accepted-site precision | Correct groups / accepted groups | Duplicate-group precision |        End-to-end top-1 |
| -------------------------------- | -------------------------------: | -----------------------: | ------------------: | -------------: | --------------------------: | ----------------------: | -------------------------------: | ------------------------: | ----------------------: |
| Train, descriptive at score 0    |          13,496 (12,177 / 1,319) | 10,786 / 13,496 = 79.92% |      9,194 / 68.12% | 4,302 / 31.88% |               9,184 / 9,194 |                  99.89% |                    8,099 / 8,184 |                    98.96% | 9,184 / 13,496 = 68.05% |
| Calibration, threshold selection |              2,966 (2,766 / 200) |   2,665 / 2,966 = 89.85% |      2,669 / 89.99% |   297 / 10.01% |               2,662 / 2,669 |                  99.74% |                    2,424 / 2,446 |                    99.10% |  2,662 / 2,966 = 89.75% |

The calibration rule chooses score `0` to maximize all-eligible-site coverage subject to **both** accepted-site precision and conservative duplicate-group precision being at least 90%. All nine candidate thresholds met those two constraints; score 0 had the greatest coverage. This is a conditional precision constraint, not a 90% all-site accuracy claim. Calibration end-to-end family-macro top-1 is **90.67%** and worst-family end-to-end top-1 is **85.73%**, so not every family reaches 90%. The calibration set contains only two repository families and does not establish broad family generalization. All 2,669 selected calibration rows still have incomplete candidate inventories.

Train at score 0 has 87.92% family-macro raw top-1 (77.18% worst family) and 75.25% family-macro end-to-end top-1 (63.41% worst family). All 9,194 selected train rows also have incomplete candidate inventories. This shows the distinction between high conditional precision and useful all-site accuracy/coverage.

### Family and call-shape breakdown

`Selected / eligible` is coverage; precision is conditional on selected rows; end-to-end top-1 uses every eligible site. Candidate sizes below come from source-only `generatedCandidateCount` and post-filter `proposedCandidateCount`, respectively, with nearest-rank p50/p95. Zero counts use the eligible-site denominator.

| Split / group                      | Eligible | Raw top-1 | Selected / eligible | Accepted precision | End-to-end top-1 | Generated p50 / p95 (zero) | Proposals p50 / p95 |
| ---------------------------------- | -------: | --------: | ------------------: | -----------------: | ---------------: | -------------------------: | ------------------: |
| Train / Docuvia                    |    3,610 |    79.97% |       2,293 / 3,610 |            100.00% |           63.52% |                 3 / 44 (0) |              1 / 25 |
| Train / Nest                       |    8,000 |    77.18% |       5,376 / 8,000 |             99.96% |           67.18% |               1 / 70 (463) |              1 / 10 |
| Train / code-review-graph          |       77 |   100.00% |             65 / 77 |            100.00% |           84.42% |                  1 / 3 (0) |               1 / 2 |
| Train / Graft                      |      888 |    97.86% |           875 / 888 |             99.20% |           97.75% |                  1 / 2 (0) |               1 / 1 |
| Train / TypeScript Language Server |      921 |    84.58% |           585 / 921 |             99.83% |           63.41% |                 1 / 97 (5) |              1 / 25 |
| Calibration / Repomind             |    1,207 |    95.86% |       1,161 / 1,207 |             99.40% |           95.61% |                 1 / 5 (17) |               1 / 5 |
| Calibration / Understand-Anything  |    1,759 |    85.73% |       1,508 / 1,759 |            100.00% |           85.73% |               1 / 23 (176) |               1 / 2 |
| Train / `arg-chain`                |      517 |    79.88% |             0 / 517 |                  — |            0.00% |                 2 / 15 (0) |              1 / 12 |
| Train / `bare`                     |    5,684 |    86.00% |       4,789 / 5,684 |             99.96% |           84.22% |                1 / 8 (461) |               1 / 8 |
| Train / `member`                   |    7,087 |    76.18% |       4,320 / 7,087 |             99.81% |           60.84% |                 3 / 73 (0) |              1 / 25 |
| Train / `this`                     |      201 |    42.79% |            85 / 201 |            100.00% |           42.29% |                 2 / 10 (0) |               2 / 7 |
| Train / `unmapped`                 |        7 |     0.00% |               0 / 7 |                  — |            0.00% |                  0 / 0 (7) |               0 / 0 |
| Calibration / `bare`               |    2,222 |    89.47% |       1,995 / 2,222 |             99.65% |           89.47% |                1 / 4 (193) |               1 / 4 |
| Calibration / `member`             |      744 |    90.99% |           674 / 744 |            100.00% |           90.59% |                14 / 35 (0) |               1 / 2 |

The `arg-chain` and `unmapped` train shapes abstain entirely. The ranker does not invent candidates for those rows. Candidate sets can be large before evidence filtering: for example, train `member` p95 is 73 generated keys, reduced to 25 proposals; this report does not claim a measured latency improvement from that reduction.

## Calibration quality, costs, and limitations

The rank score is ordinal, not a probability. A separate five-fold, duplicate-group-cross-fitted Beta-smoothed isotonic map estimates correctness probability for selected outputs; its OOF ECE/Brier results are in the [calibration-quality follow-up](#calibration-quality-follow-up). Abstentions receive no probability and remain in all-eligible coverage/abstention denominators. These estimates are calibration-split diagnostics, not production confidence or external validation. The runner does not emit per-call latency or incremental index-memory measurements.

The initial train/calibration result above is a fresh v4 calibration, not an inherited v3 threshold. Its score-0 freeze is pinned to `declared-member-hypothesis-v4`, `ordered-evidence-v1`, source/facts/configuration, split assignment, calibration labels, and the calibration rule-signature set. The calibration-quality follow-up below reran train and calibration under its updated System One implementation hash and records a separate fresh score-0 freeze; it does not claim the earlier freeze is bound to that updated hash. Both freezes are analysis-only. No v4 test/temporal ranking results are claimed, and no production calibration signatures are promoted. The older [P2-B v3 report](tiered-call-resolution-phase2-p2b-results.md) remains as historical exposed-data evidence; its test/temporal outcomes are not inputs to either v4 freeze and were not reopened.

### Calibration-quality follow-up

The ordinal top-rank score is mapped to a probability estimate with pooled-adjacent-violators isotonic regression and a Beta(1,1) prior. Five deterministic folds are assigned by `duplicateGroup`; each held group is excluded from both that fold's threshold selection and probability-map fit. Each training example receives equal total weight per duplicate group. ECE uses ten fixed equal-width bins. Only selected outputs have probabilities; abstentions remain outside ECE/Brier and inside the coverage denominator. A selected row with an unscorable or conflicting positive label is conservatively counted as incorrect, with a scorable-only result shown separately.

| Calibration OOF measure                                          |                 Result |
| ---------------------------------------------------------------- | ---------------------: |
| Eligible sites / duplicate groups                                |          2,966 / 2,739 |
| Selected sites / coverage                                        | 2,669 / 2,966 (89.99%) |
| Abstained sites                                                  |                    297 |
| Selected scorable / unscorable sites                             |              2,662 / 7 |
| Selected groups / fully correct groups / group precision         | 2,446 / 2,424 / 99.10% |
| Site-weighted ECE / Brier (selected rows; unscorable is failure) |      0.04044 / 0.04880 |
| Site-weighted ECE / Brier (scorable selected rows only; n=2,662) |      0.03993 / 0.04878 |
| Duplicate-group-weighted ECE / Brier (n=2,446 groups)            |      0.00418 / 0.00627 |
| Site-weighted family-macro ECE / worst-family ECE                |      0.03673 / 0.06530 |

The group-weighted values differ substantially from the primary site-weighted values because they give each duplicate group equal weight. They do not replace site-weighted reporting. Only two repository families are present; these are descriptive in-split estimates, not broad-family reliability claims.

Reliability-bin metadata uses `lowerInclusive`, `upperBound`, and `upperBoundInclusive`. The assignment is `[lowerInclusive, upperBound)` for every bin except the last, which is `[lowerInclusive, 1]`; probability `1` is clamped into and included by the final bin. This is OOF artifact schema 3. The original schema-2 artifact from commit `4e629db9` mislabeled every upper bound as inclusive; its metrics were unchanged, but it is superseded for interval semantics and preserved in the prior evidence directory.

| Family                          | Eligible sites / groups | Selected sites / groups | Coverage |  Site ECE / Brier | Group ECE / Brier |
| ------------------------------- | ----------------------: | ----------------------: | -------: | ----------------: | ----------------: |
| `403errors/repomind`            |           1,207 / 1,129 |           1,161 / 1,086 |   96.19% | 0.00816 / 0.01648 | 0.00836 / 0.00316 |
| `Egonex-AI/Understand-Anything` |           1,759 / 1,610 |           1,508 / 1,360 |   85.73% | 0.06530 / 0.07368 | 0.00085 / 0.00876 |

| Call shape | Eligible sites / groups | Selected sites / groups | Global-map site ECE / Brier | Global-map group ECE / Brier | Per-shape map site ECE / Brier | Per-shape map group ECE / Brier |
| ---------- | ----------------------: | ----------------------: | --------------------------: | ---------------------------: | -----------------------------: | ------------------------------: |
| `bare`     |           2,222 / 2,123 |           1,995 / 1,900 |           0.00094 / 0.00963 |            0.00892 / 0.00185 |                    unavailable |                     unavailable |
| `member`   |               744 / 616 |               674 / 546 |           0.15808 / 0.16473 |            0.01230 / 0.02167 |              0.12992 / 0.15572 |               0.01484 / 0.02180 |

The per-shape sensitivity uses the same five folds, global threshold, and accepted sites. A shape map is reported only when its complementary training fold has at least 50 accepted duplicate groups and five score levels. `member` met that support rule in all folds (432–440 training accepted groups and seven levels) but remains poorly calibrated by site weighting; its group-weighted ECE/Brier slightly worsened. `bare` had ample groups but only four score levels in each fold, so its map was withheld; 1,995 selected bare rows therefore have no per-shape sensitivity probability. The per-shape map covers only 674/2,669 selected sites (25.25%) and is not an overall improvement. Keep the global-map OOF estimates as the primary diagnostic and confidence calibration marked **partial**; do not tune further on these same labels.

| Fold | Training / held duplicate groups | Held eligible / selected sites | Global threshold | Bare map support (groups / levels) | Member map support (groups / levels) |
| ---: | -------------------------------: | -----------------------------: | ---------------: | ---------------------------------: | -----------------------------------: |
|    0 |                      2,191 / 548 |                      568 / 503 |                0 |            1,528 / 4 (unsupported) |                     435 / 7 (fitted) |
|    1 |                      2,191 / 548 |                      599 / 543 |                0 |            1,521 / 4 (unsupported) |                     432 / 7 (fitted) |
|    2 |                      2,191 / 548 |                      575 / 514 |                0 |            1,521 / 4 (unsupported) |                     437 / 7 (fitted) |
|    3 |                      2,191 / 548 |                      590 / 540 |                0 |            1,508 / 4 (unsupported) |                     440 / 7 (fitted) |
|    4 |                      2,192 / 547 |                      634 / 569 |                0 |            1,522 / 4 (unsupported) |                     440 / 7 (fitted) |

The boundary-fix train-development, calibration-threshold, and OOF commands took 2.32s, 1.77s, and 1.84s wall time with maximum RSS 1,786,249,216, 1,996,587,008, and 1,994,244,096 bytes respectively. These whole-command costs include startup, loading, and evaluation; per-call ranking latency and incremental index memory remain unmeasured.

The original OOF command read only calibration labels (`labelSplitsRead: ["calibration"]`, `heldoutModeInvoked: false`). The boundary correction regenerated train description, calibration freeze, and OOF output under the current System One implementation hash `c876602a62b4156771a06f59347d218ed551a407e42cd5600d4070db18863477`; the resulting calibration and OOF runs still read only calibration labels. No heldout exposure marker exists in the new output directory. The earlier schema-2 artifacts (implementation hash `6f9129c6…`) remain byte-preserved in their original directory. These current outputs are distinct from the earlier attempt under `17fa7ff1…` and the older f7 evidence. Full OOF fold hashes and corrected interval metadata are retained in the new machine-readable evidence directory below.

| Current boundary-fix artifact         |                                                            SHA-256 |
| ------------------------------------- | -----------------------------------------------------------------: |
| Train development JSON                | `7c77e43e7d33141194fd7bdbaf3e789dc2b62c17b49392c34f674130b65de35d` |
| Calibration metrics JSON              | `439b87d2b512c3f855127369b9fc8d3921c2d5f4508a5fe8021376f036b5fdea` |
| Calibration threshold/freeze JSON     | `4ad98ab6b46ed48b4e34dbeda6ba92576fa005be1e8e72a2ddb092a9d5edb201` |
| Calibration-quality OOF schema-3 JSON | `f71a0067f3d420601500b0316b0a51317cc902e5e740c6e9aa27849ce2972e97` |
| System One implementation hash        | `c876602a62b4156771a06f59347d218ed551a407e42cd5600d4070db18863477` |
| V4 source predictions hash            | `6d99b1b940d470cbeb94e2bd55527a8e372d2c30c26b56b7d51fc9d773c0e622` |
| OOF row content hash                  | `f54f52c4c0d3a2f67e982eff86c9255b1c54d66b2bc4dc4356022a9239fcf5f4` |
| Calibration labels hash               | `5b2892aa4be1ea53c76ff6dc189c0c78c3bf3d83af61639cbd1c59716710c426` |
| OOF input fingerprint                 | `bc27aaba55e033d14502c90426603ac956c51b773f68c30f77f7faede612a6ae` |

These four corrected JSON outputs are tracked in [`tiered-call-resolution-phase2-p2b-v4-confidence-oof-bin-boundary-fix-evidence`](tiered-call-resolution-phase2-p2b-v4-confidence-oof-bin-boundary-fix-evidence/). The schema-2 [previous confidence OOF evidence](tiered-call-resolution-phase2-p2b-v4-confidence-oof-evidence/) and the earlier [v4 train/calibration evidence](tiered-call-resolution-phase2-p2b-v4-evidence/) remain byte-preserved and bound to their respective earlier implementation hashes.

## TRAIN-family transfer diagnostic

This is a five-fold leave-one-repository-family-out diagnostic using **TRAIN predictions and TRAIN labels only**. For each held family, the other TRAIN families select a threshold under the existing 90% accepted-site and conservative duplicate-group precision constraints; those same retained groups fit the Beta-smoothed isotonic probability map. A duplicate group spanning families is removed in full from each fold's training side. The source-facts oracle map remains scoped by `(snapshotId, repoId)`. All 13,496 eligible sites stay in held-family coverage and end-to-end denominators; 12,177 labels are uniquely scorable and 1,319 are unscorable. There were no cross-family duplicate groups, and every fold had zero training/held duplicate-group overlap.

This estimates transfer among the five repository families represented in the existing TRAIN corpus. It is **not** unseen-family certification or evidence for a production confidence bound. Aggregate metrics pool all 13,496 held sites; family macro and worst-family metrics are shown separately. Accepted-site precision counts selected unscorable rows as incorrect. A duplicate group is correct only when its labels are not conflicting and every selected site in the group is scorable and correct. The diagnostic leaves P2-B partial.

| Pooled held-family metric                                      |                   Result |
| -------------------------------------------------------------- | -----------------------: |
| Eligible sites / duplicate groups                              |          13,496 / 11,843 |
| Scorable / unscorable labels                                   |           12,177 / 1,319 |
| Raw top-1 correct / eligible                                   | 10,786 / 13,496 (79.92%) |
| Selected / eligible; coverage                                  |  9,172 / 13,496 (67.96%) |
| Accepted-site correct / selected; precision                    |   9,162 / 9,172 (99.89%) |
| Correct / accepted duplicate groups; group precision           |   8,077 / 8,162 (98.96%) |
| End-to-end correct / all eligible                              |  9,162 / 13,496 (67.89%) |
| Family-macro / worst-family raw top-1                          |          87.92% / 77.18% |
| Family-macro / worst-family end-to-end top-1                   |          75.20% / 63.41% |
| Generated-key zero / mapped-target zero / ranker-proposal zero |    468 / 833 / 468 sites |

The three zero counts have different meanings: 468 sites have no generated candidate key, 833 have no uniquely mapped candidate target ID, and 468 have no ranker proposal. Candidate recall remains the separate v4 measure reported above and in P2-A evidence; do not collapse the target-mapping gap into source-generation misses.

| Held family                                             | Fit threshold; training accepted site/group precision | Held eligible (scorable / unscorable) | Raw top-1 correct / eligible | Selected / coverage | Accepted-site precision | Correct / accepted groups; group precision | End-to-end top-1 |
| ------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------: | ---------------------------: | ------------------: | ----------------------: | -----------------------------------------: | ---------------: |
| `dyphn1/Docuvia`                                        | 0; 99.86% / 98.62%                                    |                    3,610 (3,565 / 45) |       2,887 / 3,610 (79.97%) |      2,293 / 63.52% |                 100.00% |                     2,033 / 2,033; 100.00% |           63.52% |
| `nestjs/nest`                                           | 10; 99.79% / 99.74%                                   |                 8,000 (6,852 / 1,148) |       6,174 / 8,000 (77.18%) |      5,354 / 66.93% |                  99.96% |                      4,599 / 4,675; 98.37% |           66.90% |
| `tirth8205/code-review-graph`                           | 0; 99.89% / 98.95%                                    |                           77 (77 / 0) |            77 / 77 (100.00%) |         65 / 84.42% |                 100.00% |                           63 / 63; 100.00% |           84.42% |
| `trailhq/Graft`                                         | 0; 99.96% / 98.93%                                    |                         888 (883 / 5) |           869 / 888 (97.86%) |        875 / 98.54% |                  99.20% |                          862 / 869; 99.19% |           97.75% |
| `typescript-language-server/typescript-language-server` | 0; 99.90% / 98.92%                                    |                       921 (800 / 121) |           779 / 921 (84.58%) |        585 / 63.52% |                  99.83% |                          520 / 522; 99.62% |           63.41% |

| Held family                                             | Generated zero; p50 / p95 | Mapped zero; p50 / p95 | Proposal zero; p50 / p95 | Selected site ECE / Brier | Selected group ECE / Brier | Probability-map fit support (groups / score levels) |
| ------------------------------------------------------- | ------------------------: | ---------------------: | -----------------------: | ------------------------: | -------------------------: | --------------------------------------------------: |
| `dyphn1/Docuvia`                                        |                 0; 3 / 44 |             11; 2 / 21 |                0; 1 / 25 |        0.01470 / 0.000243 |         0.01461 / 0.000242 |                                          6,151 / 12 |
| `nestjs/nest`                                           |               463; 1 / 70 |            795; 1 / 42 |              463; 1 / 10 |         0.02659 / 0.03180 |          0.01073 / 0.01611 |                                           3,487 / 9 |
| `tirth8205/code-review-graph`                           |                  0; 1 / 3 |               0; 1 / 3 |                 0; 1 / 2 |        0.01112 / 0.000142 |         0.01105 / 0.000141 |                                          8,121 / 12 |
| `trailhq/Graft`                                         |                  0; 1 / 2 |               1; 1 / 2 |                 0; 1 / 1 |        0.00541 / 0.007964 |         0.00535 / 0.008017 |                                          7,315 / 12 |
| `typescript-language-server/typescript-language-server` |                 5; 1 / 97 |              26; 1 / 8 |                5; 1 / 25 |        0.00833 / 0.003481 |         0.00771 / 0.003880 |                                          7,662 / 12 |

The Graft member shape is a concrete transfer weakness: it selected 52 of 53 sites, but accepted-site precision was 46/52 (88.46%) and site-weighted ECE/Brier were 0.10705/0.11232. Its threshold met both precision constraints on the other families. The code-review-graph held family has only 77 sites, so its perfect result has limited support.

Call-shape metrics below retain each held family's site denominator. The machine artifact also records group-weighted and scorable-only ECE/Brier for every family and call shape; the displayed site values conservatively count selected unscorable labels as failures. Abstentions have no probability and stay outside these reliability metrics while remaining in coverage denominators.

| Held family / call shape                 | Eligible | Raw top-1 | Selected / eligible | Accepted-site precision | End-to-end | Generated zero; p50 / p95 | Mapped zero; p50 / p95 | Proposal zero; p50 / p95 | Selected site ECE / Brier |
| ---------------------------------------- | -------: | --------: | ------------------: | ----------------------: | ---------: | ------------------------: | ---------------------: | -----------------------: | ------------------------: |
| Docuvia / `arg-chain`                    |      169 |    79.88% |             0 / 169 |                       — |      0.00% |                0; 15 / 15 |             0; 15 / 15 |                0; 1 / 25 |                         — |
| Docuvia / `bare`                         |    1,484 |    98.18% |      1,381 / 93.06% |                 100.00% |     93.06% |                 0; 1 / 44 |              0; 1 / 16 |                0; 1 / 25 |        0.01706 / 0.000291 |
| Docuvia / `member`                       |    1,955 |    66.24% |        912 / 46.65% |                 100.00% |     46.65% |                0; 15 / 62 |             11; 7 / 27 |                0; 1 / 25 |        0.01111 / 0.000171 |
| Docuvia / `this`                         |        2 |     0.00% |               0 / 2 |                       — |      0.00% |                0; 14 / 14 |               0; 4 / 4 |                0; 1 / 25 |                         — |
| Nest / `arg-chain`                       |      341 |    79.47% |             0 / 341 |                       — |      0.00% |                  0; 2 / 6 |              28; 2 / 6 |                0; 1 / 25 |                         — |
| Nest / `bare`                            |    3,025 |    78.35% |      2,349 / 77.65% |                  99.96% |     77.62% |                456; 1 / 3 |             456; 1 / 3 |              456; 1 / 10 |        0.00513 / 0.000452 |
| Nest / `member`                          |    4,430 |    77.86% |      2,922 / 65.96% |                  99.97% |     65.94% |                 0; 3 / 78 |            221; 2 / 71 |                0; 1 / 10 |         0.05130 / 0.05621 |
| Nest / `this`                            |      197 |    42.64% |         83 / 42.13% |                 100.00% |     42.13% |                 0; 2 / 10 |             83; 1 / 10 |                0; 1 / 10 |         0.05469 / 0.05960 |
| Nest / `unmapped`                        |        7 |     0.00% |               0 / 7 |                       — |      0.00% |                  7; 0 / 0 |               7; 0 / 0 |                 7; 0 / 0 |                         — |
| code-review-graph / `bare`               |        8 |   100.00% |         8 / 100.00% |                 100.00% |    100.00% |                  0; 1 / 3 |               0; 1 / 3 |                 0; 1 / 3 |        0.01318 / 0.000174 |
| code-review-graph / `member`             |       69 |   100.00% |         57 / 82.61% |                 100.00% |     82.61% |                  0; 1 / 2 |               0; 1 / 2 |                 0; 1 / 2 |        0.01083 / 0.000138 |
| Graft / `bare`                           |      835 |    98.44% |        823 / 98.56% |                  99.88% |     98.44% |                  0; 1 / 1 |               1; 1 / 1 |                 0; 1 / 1 |        0.01251 / 0.001370 |
| Graft / `member`                         |       53 |    88.68% |         52 / 98.11% |                  88.46% |     86.79% |                  0; 1 / 7 |               0; 1 / 7 |                 0; 1 / 6 |         0.10705 / 0.11232 |
| TypeScript Language Server / `arg-chain` |        7 |   100.00% |               0 / 7 |                       — |      0.00% |                  0; 1 / 1 |               0; 1 / 1 |                 0; 0 / 0 |                         — |
| TypeScript Language Server / `bare`      |      332 |    69.58% |        206 / 62.05% |                 100.00% |     62.05% |                 5; 1 / 97 |               5; 1 / 8 |                5; 1 / 25 |        0.01362 / 0.000185 |
| TypeScript Language Server / `member`    |      580 |    92.93% |        377 / 65.00% |                  99.73% |     64.83% |                  0; 1 / 9 |              21; 1 / 9 |                0; 1 / 25 |        0.00541 / 0.005300 |
| TypeScript Language Server / `this`      |        2 |   100.00% |         2 / 100.00% |                 100.00% |    100.00% |                  0; 1 / 1 |               0; 1 / 1 |                 0; 1 / 1 |        0.01362 / 0.000185 |

`—` means no selected row or no candidate-size observation, so the conditional metric is unavailable; it is not a zero-precision claim. These folds are descriptive within the existing corpus. Do not tune from held-family results or call them certification.

| TRAIN-family LOFO provenance                    | Value                                                              |
| ----------------------------------------------- | ------------------------------------------------------------------ |
| v4 source prediction SHA-256                    | `6d99b1b940d470cbeb94e2bd55527a8e372d2c30c26b56b7d51fc9d773c0e622` |
| source prediction manifest SHA-256              | `de7dc8ec977ac316addce6263fcdb9e3190ceed84a4cc8b7e7506f2a04f5ad9e` |
| corrected source facts SHA-256                  | `ba7b631b36ed05b1f16c6b500b0c17b5e4273acd939a493800848225c4dad14e` |
| source input callsites SHA-256                  | `b61764cdaa1168ba453689c5e11f6a9b035a05273532068648092c48a0dbd362` |
| configuration SHA-256                           | `e09018b7f5abca2e246fd1b6a9c7e078d6972b0a66fa54b67c2eeabc17437fdd` |
| snapshot-scoped oracle map SHA-256              | `3088674bee530052f7b7c5575f0714f217b4774074b92de2b169fe813d89ec81` |
| split assignment SHA-256                        | `41c9c0649c6e68d2afc4c66c8978ea3dfacbfbd78a67760f1f167b4cabeda595` |
| TRAIN label rows SHA-256                        | `4983b8bd52ca2c8048fd5fc9a5f4b8efdb6f7d48843740044e097e7901f9f62a` |
| runner source hash                              | `8ecf7d51f9f252c699f2a2f81a388c4660a29c62e6c7ad8b9494181aeb0e2299` |
| System One implementation aggregate hash        | `30e27e82be908fb9a3a5f16b432497cd3bf9240aca7b1859e322c2bc78bce03d` |
| LOFO input fingerprint                          | `09c5455b98c5b4c43d6b342cd11121f859943e487d14724c2060ad536ad490bb` |
| runner output and tracked evidence JSON SHA-256 | `4b9d295122bc022912a74d98b9c7ff3ed2df4df61e933726657c17de9add837d` |

The tracked [TRAIN-family LOFO artifact](tiered-call-resolution-phase2-p2b-v4-family-transfer-evidence/system1-train-family-transfer-lofo.json) records schema 1, `labelSplitsRead: ["train"]`, `heldoutModeInvoked: false`, each fold's train/held sample and label hashes, threshold, map-fit hash, overlap count, family/call-shape metrics and candidate-availability layers. The tracked JSON is the exact runner output bytes; `cmp` and SHA-256 verified identity, and `.prettierignore` preserves those generated bytes through hooks. The command took 3.20 seconds wall time and peaked at 2,146,844,672 bytes RSS. This is whole-command cost, not per-call latency or incremental production memory.

## Provenance

| Input / artifact                                                                                                                                                     | SHA-256                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| V4 source predictions (`labelsRead: false`; full JSONL remains in ignored local results)                                                                             | `6d99b1b940d470cbeb94e2bd55527a8e372d2c30c26b56b7d51fc9d773c0e622` |
| V4 candidate prediction manifest ([tracked source manifest](tiered-call-resolution-phase2-p2a-direct-import-alias-evidence/final-source-reproduction-manifest.json)) | `de7dc8ec977ac316addce6263fcdb9e3190ceed84a4cc8b7e7506f2a04f5ad9e` |
| Candidate generator                                                                                                                                                  | `declared-member-hypothesis-v4`                                    |
| Ranking policy                                                                                                                                                       | `ordered-evidence-v1`                                              |
| Corrected source facts                                                                                                                                               | `ba7b631b36ed05b1f16c6b500b0c17b5e4273acd939a493800848225c4dad14e` |
| Source call-site input                                                                                                                                               | `b61764cdaa1168ba453689c5e11f6a9b035a05273532068648092c48a0dbd362` |
| Source configuration                                                                                                                                                 | `e09018b7f5abca2e246fd1b6a9c7e078d6972b0a66fa54b67c2eeabc17437fdd` |
| Candidate source implementation                                                                                                                                      | `f51c86da6dc003082a3dc5e4015d45e60e25696fa694912e782d92b57b247182` |
| System One implementation                                                                                                                                            | `7f7df63057bdde1cd5cb742ec66c50db1cf044ae2f5f0a8136c3e8b3034b0982` |
| Snapshot-scoped oracle mapping                                                                                                                                       | `3088674bee530052f7b7c5575f0714f217b4774074b92de2b169fe813d89ec81` |
| Snapshot-scoped unique aliases                                                                                                                                       | 119,141 across ten scopes                                          |
| Split assignment                                                                                                                                                     | `41c9c0649c6e68d2afc4c66c8978ea3dfacbfbd78a67760f1f167b4cabeda595` |
| Train label rows                                                                                                                                                     | `4983b8bd52ca2c8048fd5fc9a5f4b8efdb6f7d48843740044e097e7901f9f62a` |
| Calibration label rows                                                                                                                                               | `5b2892aa4be1ea53c76ff6dc189c0c78c3bf3d83af61639cbd1c59716710c426` |
| Calibration input fingerprint                                                                                                                                        | `fe48551f80a57acb0aec23eb761f006adb4c8fe1c0f8cd53908b2181bc682afe` |
| Calibration rule-signature set (236 signatures)                                                                                                                      | `9eeef94ec6d0340d9a717a5a5b374ef03a3b0551c2b665bc933ee816af8548d3` |
| Train development JSON                                                                                                                                               | `c76a1c864d67e16cd17bc551afa69a7dca71e3d3d467afc3b66a29334a109c72` |
| Calibration metrics JSON                                                                                                                                             | `e690c824232dca2f057a05555ee87dbd284256136ce2f6b199e2e6ed8ee10a01` |
| Calibration threshold/freeze JSON (score 0)                                                                                                                          | `4ab51885371ef39ead657cc44beb000f81083642f57f497e52fff50b5e50a501` |
| Source candidate population summary                                                                                                                                  | `c707bdc9ab23cc02357b47f1b0a9c8f1cd899d814c86ea3493958980000651b3` |

Machine-readable outputs are in [`tiered-call-resolution-phase2-p2b-v4-evidence`](tiered-call-resolution-phase2-p2b-v4-evidence/): train development, calibration metrics, threshold freeze, and source candidate-population summary. The P2-A candidate-recall evidence is linked in the [direct import-alias report](tiered-call-resolution-phase2-p2a-direct-import-alias.md#candidate-recall-and-zero-candidate-results). No test/temporal label bytes or metric artifacts were copied into this evidence set.

## Reproduction

Run under Node `v24.14.1` from the repository root. The first command evaluates train labels descriptively; the second uses calibration labels only to choose/freeze the threshold. Do not run `--mode heldout` for this v4 output under the current evaluation boundary.

```sh
PATH=/Users/daniel.chang/.nvm/versions/node/v24.14.1/bin:$PATH /usr/bin/time -l pnpm exec tsx scripts/semantic-corpus/phase2-tiered-call-resolution-system1-runner.mts --mode develop --predictions evaluate/results/semantic-corpus/v1/phase2-p2a-direct-import-alias-final-source-reproduction/predictions.jsonl --out evaluate/results/semantic-corpus/v1/phase2-p2b-v4-confidence-oof-bin-boundary-fix

PATH=/Users/daniel.chang/.nvm/versions/node/v24.14.1/bin:$PATH /usr/bin/time -l pnpm exec tsx scripts/semantic-corpus/phase2-tiered-call-resolution-system1-runner.mts --mode calibrate --predictions evaluate/results/semantic-corpus/v1/phase2-p2a-direct-import-alias-final-source-reproduction/predictions.jsonl --out evaluate/results/semantic-corpus/v1/phase2-p2b-v4-confidence-oof-bin-boundary-fix

PATH=/Users/daniel.chang/.nvm/versions/node/v24.14.1/bin:$PATH /usr/bin/time -l pnpm exec tsx scripts/semantic-corpus/phase2-tiered-call-resolution-system1-runner.mts --mode calibration-quality-oof --predictions evaluate/results/semantic-corpus/v1/phase2-p2a-direct-import-alias-final-source-reproduction/predictions.jsonl --out evaluate/results/semantic-corpus/v1/phase2-p2b-v4-confidence-oof-bin-boundary-fix

PATH=/Users/daniel.chang/.nvm/versions/node/v24.14.1/bin:$PATH /usr/bin/time -l pnpm exec tsx scripts/semantic-corpus/phase2-tiered-call-resolution-system1-runner.mts --mode family-transfer-train --predictions evaluate/results/semantic-corpus/v1/phase2-p2a-direct-import-alias-final-source-reproduction/predictions.jsonl --out evaluate/results/semantic-corpus/v1/phase2-p2b-v4-family-transfer-lofo-train
```

The source candidate-population summary is a label-free aggregation of only train/calibration rows from the pinned source prediction JSONL. It counts `generatedCandidateCount`, `candidateTargetIds.length`, and `proposedCandidateCount` separately; percentiles use nearest-rank `ceil(p*n)-1`. Candidate recall itself is in the linked P2-A train/calibration evaluator artifacts. The OOF mode reads only calibration labels and does not invoke heldout mode. No source generation, label, ranking, or threshold command for test/temporal was run here.

The `family-transfer-train` mode reads `rowsFor(bundle, "train")` and passes only those sample IDs to `labelsFor("train", observations)`. It selects each fold threshold and fits its map using the other TRAIN families only, excludes cross-family duplicate groups from training, and writes the LOFO artifact with an explicit runner-source hash. Its output records `labelSplitsRead: ["train"]` and `heldoutModeInvoked: false`; it does not read calibration/test/temporal labels or consult the System One heldout exposure mode.

## Validation

- Boundary metadata RED: `PATH=/Users/daniel.chang/.nvm/versions/node/v24.14.1/bin:$PATH pnpm exec vitest run test/semantic-corpus/phase2-tiered-call-resolution-system1-confidence-calibration.unit.test.ts -t 'emits empty bins'` failed because the output had `upperInclusive` but lacked explicit half-open/final-inclusive boundaries. GREEN: `PATH=/Users/daniel.chang/.nvm/versions/node/v24.14.1/bin:$PATH pnpm exec vitest run test/semantic-corpus/phase2-tiered-call-resolution-system1-confidence-calibration.unit.test.ts test/semantic-corpus/phase2-tiered-call-resolution-system1-evaluation.unit.test.ts test/semantic-corpus/phase2-tiered-call-resolution-candidate-audit.unit.test.ts test/semantic-corpus/phase2-tiered-call-resolution-evaluation.unit.test.ts` passed 4 files, 32/32 under Node `v24.14.1`.
- Runner hash provenance RED: `PATH=/Users/daniel.chang/.nvm/versions/node/v24.14.1/bin:$PATH pnpm exec vitest run test/semantic-corpus/phase2-tiered-call-resolution-system1-runner.unit.test.ts` failed because `systemOneRunnerImplementationHash` was not exposed. GREEN: the same command passed 1/1 after adding a runner-source hash contract and including it in provenance/input fingerprint.
- Family-transfer evaluator and runner focused GREEN: `PATH=/Users/daniel.chang/.nvm/versions/node/v24.14.1/bin:$PATH pnpm exec vitest run test/semantic-corpus/phase2-tiered-call-resolution-system1-family-transfer.unit.test.ts test/semantic-corpus/phase2-tiered-call-resolution-system1-runner.unit.test.ts` passed 2 files, 9/9 under Node `v24.14.1`. Runner cases cover a valid family-transfer mode, unknown-mode rejection, heldout/freeze pairing, and exact source-byte fingerprinting.
- TRAIN-only corpus command: `PATH=/Users/daniel.chang/.nvm/versions/node/v24.14.1/bin:$PATH /usr/bin/time -l pnpm exec tsx scripts/semantic-corpus/phase2-tiered-call-resolution-system1-runner.mts --mode family-transfer-train --predictions evaluate/results/semantic-corpus/v1/phase2-p2a-direct-import-alias-final-source-reproduction/predictions.jsonl --out evaluate/results/semantic-corpus/v1/phase2-p2b-v4-family-transfer-lofo-train` completed successfully for 13,496 sites / five families in 3.20 seconds; peak RSS was 2,146,844,672 bytes. Output hash is `4b9d295122bc022912a74d98b9c7ff3ed2df4df61e933726657c17de9add837d` and confirms `labelSplitsRead: ["train"]`, `heldoutModeInvoked: false`.
- `pnpm run typecheck`, `pnpm run lint`, and `pnpm run build` passed under Node `v24.14.1`; scoped Prettier and `git diff --check` passed.
- The first full pre-push for this family-transfer commit passed format, lint, typecheck, build, and all 3,219 tests (7 skipped), and the weak-assertion count remained 215/220. Its category ratchet exposed one new failing test file (base 234 failures / 334 files; head 235 / 335) because the runner unit test covered only state-diff. The parser contract tests were then added; the working-tree category scanner now reports 234 failures / 335 files, and the runner test passes with `[happy]`, `[invalid-input]`, `[error-handling]`, and `[state-diff]`. The fresh TRAIN artifact was regenerated under the resulting runner hash. The first attempt did not pass the complete gate; final status comes from the corrected commit's normal push hook and PR checks.
- The quality-gate scan-scope issue seen in older CI (19 Zod findings from `node_modules`) was fixed in commit `117ca506`; the current quality-gate output includes `test-quality-gate scanner scope: PASS (rg + grep fallback)` and the local weak count remains 215.
- `docuvia review origin/main` reports current PR-wide CRITICAL impact: 160 changed files and 595 impacted nodes across 59 changed files. Leading dependency findings remain in earlier graph-store contract (123 dependents), factory tokens (71), and LSP provider base (31). This diagnostic changes only the analysis runner, its test, and documentation/evidence; it does not edit those production files.
- The TRAIN-only family-transfer runner command completed on Node `v24.14.1`: 9 focused tests passed (2 files), workspace build/typecheck and lint passed, TS/Markdown Prettier checks and `git diff --check` passed, and the artifact invariant check passed for five folds, 13,496 eligible sites, zero cross-family groups/overlap, and both training precision constraints. A direct bytewise `cmp` confirms the tracked machine artifact is the unformatted runner output exactly; `.prettierignore` keeps lint-staged from rewriting it. The machine result marks `labelSplitsRead: ["train"]`, `heldoutModeInvoked: false`.
- The current family-transfer run used System One implementation hash `30e27e82be908fb9a3a5f16b432497cd3bf9240aca7b1859e322c2bc78bce03d` and explicit runner hash `8ecf7d51f9f252c699f2a2f81a388c4660a29c62e6c7ad8b9494181aeb0e2299`. Existing train/calibration/OOF outputs retain their earlier respective implementation hashes. No calibration/test/temporal label rows were read, and no System One heldout mode ran.
- The first Node `v24.14.1` pre-push completed its full suite with 3,219 passed / 7 skipped, but failed afterward because the category ratchet rose 234→235. The corrected runner test now restores the working-tree count to 234; do not treat the first run as a passing pre-push. The corrected commit's full pre-push and remote checks are reported in the PR summary.
