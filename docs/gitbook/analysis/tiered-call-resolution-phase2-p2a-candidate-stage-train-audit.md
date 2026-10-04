# GRPH-008 P2-A — TRAIN Candidate and Proposal-Filter Stage Audit

**Status:** Analysis-only TRAIN audit for candidate generator v4. It changes no generator, ranking, threshold, calibration, production resolution, or Tier B behavior. This follows [#559 comment 5969397300](https://github.com/dyphn1/Docuvia/issues/559#issuecomment-5969397300): improve candidate recall/set quality first; unsupported and hard cases continue to LSP.

## Scope and stage meanings

The audit reuses pinned v4 source-only predictions and a TRAIN-only opt-in replay. It compares exact per-call-site sets at each existing candidate/proposal boundary:

1. **Generated keys:** raw `generatedCandidateKeys` returned by the hypothesis index.
2. **Mapped target IDs:** those exact keys resolved through the `(snapshotId, repoId)` scoped facts/oracle map. Ambiguous mappings are not promoted to IDs.
3. **Ordered proposals:** exact target-key sequences after caller visibility, explicit receiver type, peer receiver members, and argument-shape filters, immediately before and after the service's `maxCandidates=25` cap. These are proposal sets, not top-1 estimates.

Recall counts uniquely mapped positive target **occurrences**. Empty-set rates and candidate-size quantiles use all confirmed eligible sites, including rows with no candidates and rows whose positive labels cannot be uniquely mapped. Quantiles use nearest rank (`ceil(p*n)-1`) over all confirmed eligible sites. Group tables also report the number of uniquely mappable positive sites and unscorable eligible sites. The audit does not infer any set from a winner or a count.

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

## Exact proposal-filter attribution

The replay captured the ordered candidate keys and their snapshot-scoped target mappings at each boundary. It compared every v4 decision field on all 13,496 TRAIN rows; the opt-in capture adds evidence only and leaves ordering, winner/rank/tie state, completeness, truncation, and result reason unchanged. This table separates an empty raw-key set from a non-empty set with no uniquely mapped target ID.

| Exact stage                      | Gold target occurrences covered / 12,177 | Raw-key p50 / p95 / max | Mapped-ID p50 / p95 / max | Raw empty sites / 13,496 | Zero-mapped-ID sites / 13,496 |
| -------------------------------- | ---------------------------------------: | ----------------------: | ------------------------: | -----------------------: | ----------------------------: |
| Generated keys                   |                                   12,170 |            1 / 64 / 118 |               1 / 35 / 96 |                      468 |                           833 |
| Before visibility                |                                   12,170 |            1 / 64 / 118 |               1 / 35 / 96 |                      468 |                           833 |
| After visibility                 |                                   12,170 |            1 / 64 / 116 |               1 / 35 / 96 |                      468 |                           833 |
| After explicit receiver type     |                                   12,168 |            1 / 34 / 116 |               1 / 16 / 96 |                      468 |                           884 |
| After peer receiver members      |                                   12,166 |            1 / 33 / 116 |               1 / 16 / 96 |                      468 |                           885 |
| After argument shape             |                                   12,166 |            1 / 31 / 102 |               1 / 15 / 76 |                      468 |                           894 |
| Immediately before maxCandidates |                                   12,166 |            1 / 31 / 102 |               1 / 15 / 76 |                      468 |                           894 |
| Immediately after maxCandidates  |                                   12,149 |             1 / 25 / 25 |               1 / 12 / 25 |                      468 |                           894 |

The cap keeps exactly the first `min(beforeCount, 25)` proposals. There were 747 truncated sites. These measurements are TRAIN-only and do not change the filter sequence or candidate policy.

The 21 uniquely mappable gold occurrences present in raw generated keys but missing from final proposals first disappear at these boundaries:

| First missing boundary        | Family × call shape | Gold occurrences |
| ----------------------------- | ------------------- | ---------------: |
| Explicit receiver-type filter | Graft × member      |                2 |
| Peer-member filter            | Nest × member       |                2 |
| maxCandidates cap             | Nest × member       |               17 |

Visibility and argument-shape filters removed no additional gold occurrences. Separately, 7 raw-generator misses are `Nest × unmapped`: the parser has no call-shape fact, so these are missing-evidence/LSP fallback cases, not proven unsupported syntax. The other raw empty rows (461) have no uniquely mappable positive target and count in the all-site zero rate, not as recall misses. The total **468 raw-zero** sites and **833 zero-mapped-ID** sites differ: 365 sites have raw keys but no unique target mapping.

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
- Ordered-proposal misses: **28 target occurrences** total. Seven are the same missing-call-shape-evidence misses. The other **21** were present in raw generated keys but disappeared at identified boundaries: 17 Nest member occurrences at the maxCandidates cap, 2 Nest member occurrences at the peer-member filter, and 2 Graft member occurrences at the explicit receiver-type filter.
- Of the raw zero-key rows, 461 have known bare-call shapes but no uniquely mappable positive target, so they remain in the all-site denominator but cannot contribute to positive-target recall. The other seven have uniquely mappable positives but lack call-shape facts (`calleeKind=unmapped`). A further 365 sites have keys whose target aliases cannot be uniquely mapped. These are separate evidence classes; none is silently counted as recall success or as an unsupported syntax form.

The evidence points to a narrow follow-up: inspect the 17 Nest member losses at the cap and the four source-filter losses against their exact syntax/fact evidence before considering any policy change. Keep the seven missing-shape cases on the LSP fallback path; do not infer a generator rule from them. High raw fanout is concentrated in Nest and Docuvia member calls, while TypeScript Language Server bare calls have a large ambiguous-alias tail (raw p95 97 keys versus 8 unique mapped IDs). This audit does not justify loosening any filter or tuning ranking.

## Provenance and reproduction

The TRAIN stage replay used pinned v4 predictions; source call sites were restricted to the 13,496 TRAIN sample IDs, with pinned source facts reused for `(snapshotId, repoId)` mapping. The original candidate-stage replay has `labelsRead=false`; this evaluator parsed only TRAIN labels using `labelsForSplitIsolated("train", ids)`. No calibration, test, temporal, or System One heldout label/evaluator path was invoked.

| Input / result                                                                                                                                                 | SHA-256                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| V4 source predictions (local ignored result)                                                                                                                   | `6d99b1b940d470cbeb94e2bd55527a8e372d2c30c26b56b7d51fc9d773c0e622` |
| [Pinned v4 source prediction manifest](tiered-call-resolution-phase2-p2a-direct-import-alias-evidence/final-source-reproduction-manifest.json)                 | `de7dc8ec977ac316addce6263fcdb9e3190ceed84a4cc8b7e7506f2a04f5ad9e` |
| [TRAIN stage replay manifest](tiered-call-resolution-phase2-p2a-candidate-stage-train-audit-evidence/train-candidate-stage-replay-manifest.json)               | `cf3587e63067a3475ed969d4b3e81817cb15559c998e2158329f9b3cfbf544c3` |
| TRAIN per-site candidate-stage evidence JSONL (earlier replay)                                                                                                 | `3806b5f555f2873747fab6a1f0943141f749995ab2cd139df4c05cea348f070a` |
| [Proposal-filter replay manifest](tiered-call-resolution-phase2-p2a-proposal-filter-stage-train-evidence/proposal-filter-stage-replay-manifest.json)           | `3c276df3fbc46b6c53d6987257e1bc030ec3e5adee1ff6b065feccbcf1b1c809` |
| TRAIN per-site ordered-filter evidence JSONL (local ignored result)                                                                                            | `ef6fbacd478a841a2330a892c4076452ea9a8e6b16fba0f9d1a09b03fc716d52` |
| TRAIN sample-ID list                                                                                                                                           | `83d1f36810abcb10306b15d2579afa4e113419f91a45c0fa59aab704aa6b20b6` |
| TRAIN label rows                                                                                                                                               | `4983b8bd52ca2c8048fd5fc9a5f4b8efdb6f7d48843740044e097e7901f9f62a` |
| `callsites.jsonl`                                                                                                                                              | `b61764cdaa1168ba453689c5e11f6a9b035a05273532068648092c48a0dbd362` |
| Corrected declared facts                                                                                                                                       | `ba7b631b36ed05b1f16c6b500b0c17b5e4273acd939a493800848225c4dad14e` |
| V4 candidate generator implementation                                                                                                                          | `f51c86da6dc003082a3dc5e4015d45e60e25696fa694912e782d92b57b247182` |
| Snapshot-scoped oracle mapping                                                                                                                                 | `3088674bee530052f7b7c5575f0714f217b4774074b92de2b169fe813d89ec81` |
| Proposal-filter replay implementation hash                                                                                                                     | `e19ac6a08adcabfae697703458223d30208e664c693f59a9d9f54d555e4ebb01` |
| Proposal-filter evaluator / runner implementation hash                                                                                                         | `75e4b530c9afa5ae638a5822e7d11ceeb26ef0f018818bee98c7c115d9a10977` |
| [TRAIN aggregate proposal-stage summary JSON](tiered-call-resolution-phase2-p2a-proposal-filter-stage-train-evidence/proposal-filter-stage-train-summary.json) | `10cc41ce63b114f2df2075463fc36aba93a71b91e8f657d9216b05db75e0af18` |
| Proposal-stage input fingerprint                                                                                                                               | `b2564d8d12c07dd3ed24c50fb07493fac7fa52dd754d78dd5f46480106555448` |

The per-site replay evidence and working aggregate remain in the ignored `evaluate/results` tree. Byte-identical copies of the replay manifest and aggregate are linked in the evidence table above. They can be reproduced with Node `v24.14.1`:

```sh
PATH=/Users/daniel.chang/.nvm/versions/node/v24.14.1/bin:$PATH pnpm exec tsx scripts/semantic-corpus/phase2-tiered-call-resolution-proposal-filter-stage-evaluation-runner.mts
```

The runner validates the pinned prediction/replay/source hashes, records `labelSplitsRead=["train"]`, and writes `evaluate/results/semantic-corpus/v1/phase2-p2a-v4-train-proposal-filter-stage-evaluation/proposal-filter-stage-train-summary.json`. It does not regenerate predictions, reopen other label splits, change any rule, or update a calibration threshold.

## Validation

### Ordered-filter trace update

- Replay command (Node `v24.14.1`):
  `PATH=/Users/daniel.chang/.nvm/versions/node/v24.14.1/bin:$PATH pnpm exec tsx scripts/semantic-corpus/phase2-tiered-call-resolution-candidate-stage-replay.mts --capture-proposal-filter-stages --out evaluate/results/semantic-corpus/v1/phase2-p2a-v4-train-proposal-filter-stage-replay`
  completed with **13,496/13,496** TRAIN decision rows equivalent and `labelSplitsRead=[]` / `labelsRead=false`.
- TRAIN-only evaluator command (Node `v24.14.1`):
  `PATH=/Users/daniel.chang/.nvm/versions/node/v24.14.1/bin:$PATH pnpm exec tsx scripts/semantic-corpus/phase2-tiered-call-resolution-proposal-filter-stage-evaluation-runner.mts`
  completed with **13,496** observed source rows and **12,177** unique-mappable positive target occurrences. It reads only TRAIN labels. The seven raw misses have missing call-shape evidence; the 21 raw-present proposal losses first disappear as **17 cap / 2 peer-member / 2 explicit-receiver** occurrences.
- Focused command:
  `PATH=/Users/daniel.chang/.nvm/versions/node/v24.14.1/bin:$PATH pnpm exec vitest run test/semantic-corpus/phase2-tiered-call-resolution-proposal-filter-stage-evaluation.unit.test.ts test/semantic-corpus/phase2-tiered-call-resolution-proposal-filter-stage-evidence.unit.test.ts lib/core/src/semantic/call-resolution-hypothesis.service.integration.test.ts`
  passed **34/34 tests**. This includes the exact 26→25 cap case and rejects 26→24; the validator requires exactly `min(beforeCount, 25)` keys in original order.
- Full `pnpm run build` passed (including root typecheck and all 11 workspace package builds); full `pnpm run lint` passed; repository-wide `pnpm exec prettier --check .` passed; `git diff --check` passed.
- `bash scripts/test-quality-gate.sh`: passed its static and category-ratchet gates. Weak assertions were **215/7,255** against the ceiling of **220**. Category failures remained **234**, unchanged from base `f7eb3434923bc7cdefd1788db9f284991320d01f` to the current working tree (base 336 files, head 337); the ratchet passed with no increase.
- Replay evidence SHA-256: `ef6fbacd478a841a2330a892c4076452ea9a8e6b16fba0f9d1a09b03fc716d52`; replay manifest SHA-256: `3c276df3fbc46b6c53d6987257e1bc030ec3e5adee1ff6b065feccbcf1b1c809`; aggregate summary SHA-256: `10cc41ce63b114f2df2075463fc36aba93a71b91e8f657d9216b05db75e0af18`. Tracked JSON copies are kept byte-identical to runner output and excluded from Prettier rewriting.
- Full repository pre-push/build status and remote checks will be recorded after that gate completes.

### Initial candidate-stage evaluator (previous audit)

- RED: the focused evaluator test failed on exact site count (`0` vs expected `2`) and failure to reject non-TRAIN input.
- GREEN: evaluator + candidate-stage evidence + scoped oracle audit tests passed **17/17** with:
  `pnpm exec vitest run test/semantic-corpus/phase2-tiered-call-resolution-candidate-stage-evaluation.unit.test.ts test/semantic-corpus/phase2-tiered-call-resolution-candidate-stage-evidence.unit.test.ts test/semantic-corpus/phase2-tiered-call-resolution-candidate-audit.unit.test.ts --testTimeout=120000 --hookTimeout=120000`.
- `pnpm run typecheck` and `pnpm run lint`: passed.
- `pnpm exec prettier --check` on the evaluator, runner, tests, and linked report/index files: passed; `git diff --check`: passed.
- `bash scripts/test-quality-gate.sh`: passed. Weak assertions were **215/7,219** against the ceiling of 220; category ratchet was **234/234** (base `7d7dd939`, head 234 across 336 files), with no net category debt.
- The generated TRAIN aggregate matched **13,496** replayed sites and **12,177** unique-mappable positive target occurrences. It classifies the seven scoreable raw misses as missing call-shape evidence, with zero misses classified as proven unsupported syntax. The source generator and all v4 decision fields remain unchanged.
- `docuvia query` returned keyword context; `docuvia impact filterCandidates` and `docuvia impact CallResolutionHypothesisService` reported medium risk. The graph is stale at `79a6c3d` while HEAD is `e2063d3`. `docuvia review origin/main` reports a PR-wide CRITICAL (170 changed files, 601 dependents); the top affected files are existing contract/LSP modules, not this analysis-only slice.
- The standard Node `v24.14.1` pre-push hook result and remote CI status will be recorded on the resulting PR commit.

This audit is descriptive TRAIN evidence, not calibration, certification, or a claim that all eligible calls resolve. Any later candidate-policy change should preserve LSP fallback for missing/unsupported evidence and first inspect the exact source facts for the 17 capped and four source-filtered gold occurrences. This measurement alone does not authorize a behavior change.
