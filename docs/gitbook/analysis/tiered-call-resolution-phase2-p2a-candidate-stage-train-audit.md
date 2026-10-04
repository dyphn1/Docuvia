# GRPH-008 P2-A — TRAIN Candidate-Stage Audit

**Status:** Analysis-only TRAIN audit for candidate generator v4. It changes no generator, ranking, threshold, calibration, production resolution, or Tier B behavior. This follows [#559 comment 5969397300](https://github.com/dyphn1/Docuvia/issues/559#issuecomment-5969397300): improve candidate recall/set quality first; unsupported and hard cases continue to LSP.

## Scope and stage meanings

The audit reuses the pinned v4 source-only predictions and the TRAIN candidate-stage replay. It compares exact per-call-site sets from three points in the existing path:

1. **Generated keys:** raw `generatedCandidateKeys` returned by the hypothesis index.
2. **Mapped target IDs:** those exact keys resolved through the `(snapshotId, repoId)` scoped facts/oracle map. Ambiguous mappings are not promoted to IDs.
3. **Ordered proposals:** exact `result.candidates` after the existing filters and the service's `maxCandidates` bound. This is a proposal set, not a top-1 estimate.

Recall counts uniquely mapped positive target **occurrences**. Empty-set rates and candidate-size quantiles use all confirmed eligible sites, including rows with no candidates and rows whose positive labels cannot be uniquely mapped. Group tables also report the number of uniquely mappable positive sites and unscorable eligible sites. The audit does not infer any set from a winner or a count.

## TRAIN results

| Stage                       | Exact set membership total | Unique-mappable targets covered / 12,177 | Candidate recall | Empty stage set / 13,496 eligible sites | Empty mapped target set / 13,496 | Stage set size p50 / p95 / max | Mapped target set size p50 / p95 / max |
| --------------------------- | -------------------------: | ---------------------------------------: | ---------------: | --------------------------------------: | -------------------------------: | -----------------------------: | -------------------------------------: |
| Generated keys              |               137,469 keys |                                   12,170 |         99.9425% |                           468 (3.4677%) |                    833 (6.1722%) |              1 / 64 / 118 keys |                        1 / 35 / 96 IDs |
| Mapped generated target IDs |                 89,589 IDs |                                   12,170 |         99.9425% |                           833 (6.1722%) |                    833 (6.1722%) |                1 / 35 / 96 IDs |                        1 / 35 / 96 IDs |
| Ordered proposals           |       44,060 proposal keys |                                   12,149 |         99.7701% |                           468 (3.4677%) |                    894 (6.6242%) |               1 / 25 / 25 keys |                        1 / 12 / 25 IDs |

All 13,496 TRAIN label rows are confirmed eligible. Their 13,507 positive target occurrences divide into 12,177 uniquely mappable, 861 ambiguous, and 469 unmapped. The recall denominator therefore differs from the all-site denominator by design. Raw generated keys have 89,589 uniquely mapped memberships and 47,880 ambiguous memberships; the 137,469 raw key memberships have no unmapped outcomes. Proposal keys have 31,412 mapped and 12,648 ambiguous memberships out of 44,060.

The 468 rows with no raw generated key split into:

- **461 known-shape, unscorable rows:** Nest bare calls (456) and TypeScript Language Server bare calls (5). Each has a confirmed positive label, but none of its positive target occurrences is uniquely mappable. They remain in the all-site empty-set rate and are excluded from candidate recall. They are not evidence of a generator miss.
- **7 missing-call-shape-evidence rows:** all seven have `calleeKind=unmapped`, a uniquely mapped positive target, and no generated key. `unmapped` here means the parser call-shape fact is missing; it does not prove the syntax is unsupported. These are the only raw generator misses, and the absent call-site evidence should continue to LSP/Tier B.

Another 365 sites have raw keys but no uniquely mapped target ID; their 485 candidate-key memberships are ambiguous. They are not generator-zero rows. Across all stages, the reported set sizes preserve the difference between raw keys, mapped IDs, and proposals.

## Family × call-shape results

`Scorable / unscorable sites` is a site count; target counts in the recall columns are occurrences. `Raw key p95/max` and `mapped ID p95/max` use every eligible site in that family/shape. Proposal misses count uniquely mapped positive occurrences present in the raw generated set but absent from the ordered proposals, plus any raw misses.

The `Nest × unmapped` row contains seven sites whose call-shape fact is absent, not seven proven unsupported syntax forms. All seven are scorable positive sites and belong to the missing-evidence/LSP fallback bucket.

| Family × call shape                    | Sites | Scorable / unscorable | Raw recall (covered / targets) | Raw zero keys | Raw key p95 / max | Mapped ID p95 / max | Proposal recall (covered / targets) | Proposal misses | Proposal key p95 / max |
| -------------------------------------- | ----: | --------------------: | -----------------------------: | ------------: | ----------------: | ------------------: | ----------------------------------: | --------------: | ---------------------: |
| Docuvia × arg-chain                    |   169 |              155 / 14 |               100% (155 / 155) |             0 |           15 / 15 |             15 / 15 |                    100% (155 / 155) |               0 |                12 / 13 |
| Docuvia × bare                         | 1,484 |             1,484 / 0 |           100% (1,484 / 1,484) |             0 |           44 / 44 |             16 / 16 |                100% (1,484 / 1,484) |               0 |                25 / 25 |
| Docuvia × member                       | 1,955 |            1,924 / 31 |           100% (1,924 / 1,924) |             0 |           62 / 98 |             27 / 36 |                100% (1,924 / 1,924) |               0 |                25 / 25 |
| Docuvia × this                         |     2 |                 2 / 0 |                   100% (2 / 2) |             0 |           14 / 14 |               4 / 4 |                        100% (2 / 2) |               0 |                14 / 14 |
| Nest × arg-chain                       |   341 |              313 / 28 |               100% (313 / 313) |             0 |            6 / 78 |              6 / 26 |                    100% (313 / 313) |               0 |                 6 / 25 |
| Nest × bare                            | 3,025 |           2,512 / 513 |           100% (2,512 / 2,512) |           456 |            3 / 30 |               3 / 8 |                100% (2,512 / 2,512) |               0 |                 3 / 25 |
| Nest × member                          | 4,430 |           3,906 / 524 |           100% (3,906 / 3,906) |             0 |          78 / 118 |             71 / 96 |            99.5136% (3,887 / 3,906) |              19 |                15 / 25 |
| Nest × this                            |   197 |              114 / 83 |               100% (114 / 114) |             0 |           10 / 31 |             10 / 27 |                    100% (114 / 114) |               0 |                 7 / 25 |
| Nest × unmapped                        |     7 |                 7 / 0 |                     0% (0 / 7) |             7 |             0 / 0 |               0 / 0 |                          0% (0 / 7) |               7 |                  0 / 0 |
| Code Review Graph × bare               |     8 |                 8 / 0 |                   100% (8 / 8) |             0 |             3 / 3 |               3 / 3 |                        100% (8 / 8) |               0 |                  2 / 2 |
| Code Review Graph × member             |    69 |                69 / 0 |                 100% (69 / 69) |             0 |             2 / 6 |               2 / 6 |                      100% (69 / 69) |               0 |                  1 / 5 |
| Graft × bare                           |   835 |               833 / 2 |               100% (833 / 833) |             0 |            1 / 22 |              1 / 15 |                    100% (833 / 833) |               0 |                 1 / 21 |
| Graft × member                         |    53 |                50 / 3 |                 100% (50 / 50) |             0 |            7 / 28 |              7 / 10 |                       96% (48 / 50) |               2 |                  3 / 6 |
| TypeScript Language Server × arg-chain |     7 |                 7 / 0 |                   100% (7 / 7) |             0 |             1 / 1 |               1 / 1 |                        100% (7 / 7) |               0 |                  1 / 1 |
| TypeScript Language Server × bare      |   332 |              236 / 96 |               100% (236 / 236) |             5 |           97 / 97 |               8 / 8 |                    100% (236 / 236) |               0 |                25 / 25 |
| TypeScript Language Server × member    |   580 |              555 / 25 |               100% (555 / 555) |             0 |            9 / 77 |               9 / 9 |                    100% (555 / 555) |               0 |                  2 / 9 |
| TypeScript Language Server × this      |     2 |                 2 / 0 |                   100% (2 / 2) |             0 |             1 / 1 |               1 / 1 |                        100% (2 / 2) |               0 |                  1 / 1 |

The highest raw-key fanout is concentrated in ordinary member calls: Nest member has p95/max 78/118 and Docuvia member 62/98. TypeScript Language Server bare calls have raw-key p95/max 97/97 but mapped-target p95/max 8/8, indicating a large alias ambiguity tail rather than 97 uniquely mapped targets. The candidate generator covers every uniquely mapped TRAIN target in these high-fanout groups.

## Missing evidence and proposal losses

- Raw recall misses: **7 target occurrences**, all `missing call-shape evidence → expected LSP fallback`. They are not classified as unsupported syntax. No uniquely mappable positive target was missed by the v4 raw generator on a known shape.
- Ordered-proposal misses: **28 target occurrences** total. Seven are the same missing-shape-evidence misses. The remaining **21** are in the raw generated set but absent from the final ordered proposal list: Nest member 19 and Graft member 2.
- The returned ordered proposal set is the output after the service's visibility/receiver/peer/argument filters and `maxCandidates=25` bound. The captured evidence contains exact raw and final proposal IDs, but no IDs at each intermediate filter stage. Therefore the 21 losses are attributable to the proposal pipeline, but this audit cannot identify which individual filter versus the 25-item bound removed each target.
- Of the raw zero-key rows, 461 have known bare-call shapes but no uniquely mappable positive target, so they remain in the all-site denominator but cannot contribute to positive-target recall. The other seven have uniquely mappable positives but lack call-shape facts (`calleeKind=unmapped`). A further 365 sites have keys whose target aliases cannot be uniquely mapped. These are separate evidence classes; none is silently counted as recall success or as an unsupported syntax form.

The result supports a narrow next measurement priority: capture exact target IDs after each ordered filter and before the 25-candidate cap, then inspect the 21 proposal-pipeline drops on TRAIN. Do not loosen the filters or tune ranking from this audit. The high-fanout rows also merit an analysis of whether early ordered proposals preserve useful recall, while the ambiguous alias memberships should stay distinct from target-ID recall.

## Provenance and reproduction

The TRAIN stage replay used pinned v4 predictions; source call sites were restricted to the 13,496 TRAIN sample IDs, with pinned source facts reused for `(snapshotId, repoId)` mapping. The original candidate-stage replay has `labelsRead=false`; this evaluator parsed only TRAIN labels using `labelsForSplitIsolated("train", ids)`. No calibration, test, temporal, or System One heldout label/evaluator path was invoked.

| Input / result                                                                                                                                   | SHA-256                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| V4 source predictions (local ignored result)                                                                                                     | `6d99b1b940d470cbeb94e2bd55527a8e372d2c30c26b56b7d51fc9d773c0e622` |
| [Pinned v4 source prediction manifest](tiered-call-resolution-phase2-p2a-direct-import-alias-evidence/final-source-reproduction-manifest.json)   | `de7dc8ec977ac316addce6263fcdb9e3190ceed84a4cc8b7e7506f2a04f5ad9e` |
| [TRAIN stage replay manifest](tiered-call-resolution-phase2-p2a-candidate-stage-train-audit-evidence/train-candidate-stage-replay-manifest.json) | `cf3587e63067a3475ed969d4b3e81817cb15559c998e2158329f9b3cfbf544c3` |
| TRAIN per-site stage evidence JSONL                                                                                                              | `3806b5f555f2873747fab6a1f0943141f749995ab2cd139df4c05cea348f070a` |
| TRAIN sample-ID list                                                                                                                             | `83d1f36810abcb10306b15d2579afa4e113419f91a45c0fa59aab704aa6b20b6` |
| TRAIN label rows                                                                                                                                 | `4983b8bd52ca2c8048fd5fc9a5f4b8efdb6f7d48843740044e097e7901f9f62a` |
| `callsites.jsonl`                                                                                                                                | `b61764cdaa1168ba453689c5e11f6a9b035a05273532068648092c48a0dbd362` |
| Corrected declared facts                                                                                                                         | `ba7b631b36ed05b1f16c6b500b0c17b5e4273acd939a493800848225c4dad14e` |
| V4 candidate generator implementation                                                                                                            | `f51c86da6dc003082a3dc5e4015d45e60e25696fa694912e782d92b57b247182` |
| Snapshot-scoped oracle mapping                                                                                                                   | `3088674bee530052f7b7c5575f0714f217b4774074b92de2b169fe813d89ec81` |
| Evaluator / runner source bundle                                                                                                                 | `7a4853f0e6f3862a5f9eff94689e3882490e5f880fd9977568fd06b42df84153` |
| TRAIN aggregate summary JSON (local ignored output; schema 2)                                                                                    | `f3d429e912fa5b46106faef4016eb74c61e74ade9b31d7edd6393c6e22e94fb7` |
| Combined input fingerprint                                                                                                                       | `4c0f5639ceb8119faa499a9a5f1878813837c29ff52f439da73f2c98b0369ef3` |

The aggregate summary and per-site replay evidence remain in the ignored `evaluate/results` tree and can be reproduced with Node `v24.14.1`:

```sh
PATH=/Users/daniel.chang/.nvm/versions/node/v24.14.1/bin:$PATH pnpm exec tsx scripts/semantic-corpus/phase2-tiered-call-resolution-candidate-stage-evaluation-runner.mts
```

The runner validates the pinned prediction/replay/source hashes, records `labelSplitsRead=["train"]`, and writes `evaluate/results/semantic-corpus/v1/phase2-p2a-v4-train-candidate-stage-evaluation/candidate-stage-train-summary.json`. It does not regenerate predictions, reopen other label splits, change any rule, or update a calibration threshold.

## Validation

- RED: the focused evaluator test failed on exact site count (`0` vs expected `2`) and failure to reject non-TRAIN input.
- GREEN: evaluator + candidate-stage evidence + scoped oracle audit tests passed **17/17** with:
  `pnpm exec vitest run test/semantic-corpus/phase2-tiered-call-resolution-candidate-stage-evaluation.unit.test.ts test/semantic-corpus/phase2-tiered-call-resolution-candidate-stage-evidence.unit.test.ts test/semantic-corpus/phase2-tiered-call-resolution-candidate-audit.unit.test.ts --testTimeout=120000 --hookTimeout=120000`.
- `pnpm run typecheck` and `pnpm run lint`: passed.
- `pnpm exec prettier --check` on the evaluator, runner, tests, and linked report/index files: passed; `git diff --check`: passed.
- `bash scripts/test-quality-gate.sh`: passed. Weak assertions were **215/7,219** against the ceiling of 220; category ratchet was **234/234** (base `7d7dd939`, head 234 across 336 files), with no net category debt.
- The generated TRAIN aggregate matched **13,496** replayed sites and **12,177** unique-mappable positive target occurrences. It classifies the seven scoreable raw misses as missing call-shape evidence, with zero misses classified as proven unsupported syntax. The source generator and all v4 decision fields remain unchanged.
- `docuvia query` returned an empty context and `docuvia impact` found no graph node for the new evaluator. `docuvia review origin/main` reports a PR-wide CRITICAL (165 changed files, 601 dependents); its top affected files are existing contracts/LSP files, not this analysis-only slice.
- The standard Node `v24.14.1` pre-push hook result and remote CI status will be recorded on the resulting PR commit.

This audit is descriptive TRAIN evidence, not calibration, certification, or a claim that all eligible calls resolve. The next candidate stage should preserve LSP fallback for unsupported/missing evidence and inspect the exact 21 proposal-pipeline losses before considering any behavior change.
