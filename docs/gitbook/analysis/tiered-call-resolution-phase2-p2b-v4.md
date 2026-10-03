# GRPH-008 P2-B v4 — System One train/calibration evidence

**Status:** The v4 ranking evaluation slice is complete for train and calibration. It uses the current v4 source-only candidate artifact and pins the calibration threshold to that generator, source, configuration, split assignment, and calibration labels. This is analysis-only: no production calibration record was added, no result became `proven`, and Tier B execution/skip behavior did not change. The v4 test/temporal ranking evaluator was not run; prior v3 heldout results remain exposed historical evidence and do not qualify as v4 results.

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

The rank score is an ordinal evidence score, not a probability estimate. **ECE and Brier score are unavailable and are not reported.** The runner does not emit per-call latency or incremental index-memory measurements. `/usr/bin/time -l` recorded whole-command wall time of 2.34 seconds for train development and 1.88 seconds for calibration, with process maximum RSS of 1,930,493,952 and 1,600,520,192 bytes respectively. These include process startup, artifact/facts loading, and evaluation; they are not per-query costs. No per-call rank latency or incremental memory figure is available.

This is a fresh v4 calibration, not an inherited v3 threshold. Score 0 is pinned to `declared-member-hypothesis-v4`, `ordered-evidence-v1`, the current source/facts/configuration, split assignment, calibration labels, and the calibration rule-signature set. It remains an analysis artifact only. No v4 test/temporal ranking results are claimed, and no production calibration signatures are promoted. The older [P2-B v3 report](tiered-call-resolution-phase2-p2b-results.md) remains as historical exposed-data evidence; its test/temporal outcomes are not inputs to this v4 threshold and were not reopened.

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
PATH=/Users/daniel.chang/.nvm/versions/node/v24.14.1/bin:$PATH /usr/bin/time -l pnpm exec tsx scripts/semantic-corpus/phase2-tiered-call-resolution-system1-runner.mts --mode develop --predictions evaluate/results/semantic-corpus/v1/phase2-p2a-direct-import-alias-final-source-reproduction/predictions.jsonl --out evaluate/results/semantic-corpus/v1/phase2-p2b-v4

PATH=/Users/daniel.chang/.nvm/versions/node/v24.14.1/bin:$PATH /usr/bin/time -l pnpm exec tsx scripts/semantic-corpus/phase2-tiered-call-resolution-system1-runner.mts --mode calibrate --predictions evaluate/results/semantic-corpus/v1/phase2-p2a-direct-import-alias-final-source-reproduction/predictions.jsonl --out evaluate/results/semantic-corpus/v1/phase2-p2b-v4
```

The source candidate-population summary is a label-free aggregation of only train/calibration rows from the pinned source prediction JSONL. It counts `generatedCandidateCount`, `candidateTargetIds.length`, and `proposedCandidateCount` separately; percentiles use nearest-rank `ceil(p*n)-1`. Candidate recall itself is in the linked P2-A train/calibration evaluator artifacts. No source generation, label, ranking, or threshold command for test/temporal was run here.

## Validation

- Focused evaluator/candidate audit suites: 3 files, 26/26 passed under Node `v24.14.1` (`system1-evaluation`, `candidate-audit`, and candidate `evaluation`).
- `pnpm run typecheck`, `pnpm run lint`, and `pnpm run build` passed under Node `v24.14.1`; scoped Prettier and `git diff --check` passed.
- `pnpm run test`: 3,207 passed, 7 skipped across 330 passed files and 1 skipped file; command exited 0.
- `bash scripts/test-quality-gate.sh`: exit 0; weak assertions 215/7,159, below the 220 ceiling. Category ratchet stayed at 234, matching base `78cf0e23bc87972955d79814b4964ce62f45ba2b`; this slice adds no test files or category debt.
- `docuvia review origin/main` reports PR-wide CRITICAL impact from earlier branch changes (top impacted files include graph-store contracts and LSP provider code). This P2-B v4 slice changes only analysis docs and evidence, and does not touch those runtime files; the review remains an existing PR-wide review finding, not a new v4 evaluator finding.
- Both v4 runner commands above completed with the pinned hashes. The heldout exposure marker was absent afterward. Validation did not read corpus test/temporal labels or run System One heldout mode.
