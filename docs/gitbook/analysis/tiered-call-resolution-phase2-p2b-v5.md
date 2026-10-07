# GRPH-008 P2-B v5 — Tier A candidate-list recall funnel

**Status:** The source-grounded candidate generator fixes and license guard are implemented and measured. The primary Tier A metric is whether its generated candidate list contains the unique oracle target across **all confirmed, uniquely resolved sites**, including unsupported and non-ranked call shapes. System One top-1 and its bounded proposals are secondary funnel stages. Multi-candidate and unsupported cases still require LSP/checker confirmation; receiver type inference, generics, and dynamic dispatch remain outside Tier A.

Ranking policy remains `ordered-evidence-v1`. The candidate generator version is `declared-member-hypothesis-v7`. Only calibration labels selected the frozen System One threshold; TRAIN is descriptive/LOFO, and TEST is regression-only. The evaluation license policy fails closed for excluded repositories and excluded caller or target paths. Enterprise-path filtering removed 131 caller-path samples during source replay and 3 target-path samples during TEST evaluation (134 observed Onyx Enterprise-path samples total). No excluded repository rows entered a split.

## Measurement contract

The **generated candidate list** is the syntax-only hypothesis list produced by Tier A before System One's evidence filters and configured proposal bound. Its gold-containment recall is the primary measure; all confirmed, single-target labels that map uniquely in their snapshot and repository are counted, without conditioning on System One eligibility. Rows with an ambiguous or unmapped oracle target are counted separately and excluded only because no unique gold candidate can be tested.

The **bounded proposal list** is the secondary list after System One evidence filtering and its configured 25-candidate bound. Its coverage and truncation rate are reported separately. A correct singleton is a generated list containing exactly one hypothesis whose target matches the oracle. `No LSP` is the number of correct singleton sites divided by all uniquely resolved sites; singleton precision is correct singleton sites divided by singleton sites.

List-size percentiles include every uniquely resolved site. The generated list itself has no cap, so its truncation count is zero. “Bounded truncation” below means the separate System One proposal bound removed candidates. This distinguishes candidate discovery from ranking and abstention.

The reproducible pre-change comparison is the aggregate-only licensed source replay captured in `candidate-recall-before-summary.json`; it uses the same run-c unique-oracle mapping and all-site denominator as the post-change replay. The issue's earlier manual scan (16,375/16,403, 99.83%, with a 32-item maximum) is retained as context only: its list field and denominator differ from this runner's source-generated hypotheses, so it is not used as the paired baseline.

## Primary candidate-list recall

| Split                    |                    Resolved / observed |                                       Generated recall before → after | Family mean / worst after | Size p50 / p90 / p99 / max before → after | Correct singleton / resolved (no-LSP) before → after |           Multi / zero after | Singleton precision before → after |  Bounded proposal truncation before → after |
| ------------------------ | -------------------------------------: | --------------------------------------------------------------------: | ------------------------: | ----------------------------------------: | ---------------------------------------------------: | ---------------------------: | ---------------------------------: | ------------------------------------------: |
| TRAIN                    | 13,485 / 13,496 (11 ambiguous targets) |                   13,016 / 13,485 (96.52%) → 13,478 / 13,485 (99.95%) |           99.98% / 99.91% |     1 / 34 / 98 / 118 → 1 / 30 / 98 / 118 |    7,215 / 13,485 (53.50%) → 7,845 / 13,485 (58.18%) |   5,633 (41.77%) / 7 (0.05%) |                   99.99% → 100.00% | 738 / 13,485 (5.47%) → 673 / 13,485 (4.99%) |
| CALIBRATION              |                          2,966 / 2,966 |                       2,763 / 2,966 (93.16%) → 2,957 / 2,966 (99.70%) |           99.63% / 99.25% |       1 / 14 / 35 / 35 → 1 / 14 / 35 / 35 |      1,704 / 2,966 (57.45%) → 1,910 / 2,966 (64.40%) |   1,049 (35.37%) / 1 (0.03%) |                    99.65% → 99.69% |       2 / 2,966 (0.07%) → 2 / 2,966 (0.07%) |
| TEST, allowed Onyx paths |                          6,039 / 6,039 | Not captured in the paired pre-change replay → 5,894 / 6,039 (97.60%) |           97.60% / 97.60% |                     — → 1 / 9 / 282 / 448 |                           — → 4,195 / 6,039 (69.47%) | 1,699 (28.13%) / 141 (2.33%) |                         — → 99.90% |                     — → 492 / 6,039 (8.15%) |

TRAIN generated-list recall rose 3.43 percentage points and CALIBRATION rose 6.54 points in the paired replay. Across TRAIN plus CALIBRATION, the generated list contains the oracle target at 16,435/16,451 sites (99.90%). The bounded proposal list contains it at 16,404/16,451 sites (99.71%): 16 sites are generated-list misses and 31 additional sites lose the gold target during proposal filtering or bounding.

The runner's generated-list size distribution is not the earlier 32-item manual list: the generated hypotheses are intentionally retained before proposal bounding and can exceed 32. The post-change bounded proposal list has a maximum of 25. These are separate stages, not contradictory measurements of one list.

### TRAIN family and call-shape breakdown

| Family / shape             | Before recall | After covered / resolved | After recall |
| -------------------------- | ------------: | -----------------------: | -----------: |
| Docuvia                    |       100.00% |            3,610 / 3,610 |      100.00% |
| Nest                       |        94.19% |            7,982 / 7,989 |       99.91% |
| code-review-graph          |       100.00% |                  77 / 77 |      100.00% |
| Graft                      |       100.00% |                888 / 888 |      100.00% |
| TypeScript Language Server |        99.46% |                921 / 921 |      100.00% |
| `arg-chain`                |       100.00% |                517 / 517 |      100.00% |
| `bare`                     |        91.87% |            5,684 / 5,684 |      100.00% |
| `member`                   |       100.00% |            7,076 / 7,076 |      100.00% |
| `this`                     |       100.00% |                201 / 201 |      100.00% |
| `unmapped`                 |         0.00% |                    0 / 7 |        0.00% |

The family mean moved from 98.73% to 99.98%; the worst family moved from Nest at 94.19% to 99.91%. The seven `unmapped` sites account for every remaining TRAIN generated-list miss.

### CALIBRATION family and call-shape breakdown

| Family / shape      | Before recall | After covered / resolved | After recall |
| ------------------- | ------------: | -----------------------: | -----------: |
| Repomind            |        97.76% |            1,198 / 1,207 |       99.25% |
| Understand-Anything |        89.99% |            1,759 / 1,759 |      100.00% |
| `bare`              |        90.86% |            2,213 / 2,222 |       99.59% |
| `member`            |       100.00% |                744 / 744 |      100.00% |

CALIBRATION has two families; the 99.63% family mean and 99.25% minimum describe this split only and do not establish broad transfer.

### TEST regression-only breakdown

| Family / shape      | Generated covered / resolved |  Recall |
| ------------------- | ---------------------------: | ------: |
| Onyx, allowed paths |                5,894 / 6,039 |  97.60% |
| `arg-chain`         |                        5 / 5 | 100.00% |
| `bare`              |                4,607 / 4,752 |  96.95% |
| `member`            |                1,282 / 1,282 | 100.00% |

TEST was not used to change the generator, list policy, or calibration threshold. Recall is lower on 145 bare sites: 141 now have an empty list and four have a non-gold list after the unsupported global import-name fallback was removed. This is a regression-only observation, not a tuning signal. The bounded proposal list covers the same 5,894/6,039 sites; 492 sites are truncated at the proposal bound.

## Fixed misses and remaining gap

The initial 28-miss audit attributed the losses to three deterministic source patterns:

| Pattern                                                                                                   | Initial misses | Deterministic fix                                                                                                                          |
| --------------------------------------------------------------------------------------------------------- | -------------: | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Named and default import aliases (including local names used by tests)                                    |             19 | Resolve the imported local binding to the exported declaration name before candidate lookup; follow source-bound named/default re-exports. |
| Class-qualified static calls such as `X.method()` pushed beyond the candidate bound by same-named methods |              8 | When `X` is a syntactically resolved imported or local class, restrict candidates to that class before proposal bounding.                  |
| Aliased decorator import                                                                                  |              1 | Use the same import-binding resolution for aliased decorators before lookup.                                                               |

The named/default import and decorator cases now have integration coverage. The class-qualified static path has integration coverage proving class restriction precedes truncation. The resolver uses import/export syntax and declared class ownership only; it does not infer receiver types or perform TypeScript semantic checking.

Round 5 fixed a fail-open fallback exposed by the P2-A boundary suites. An unresolved `@/…` path no longer searches every workspace export; a configured alias must resolve to one direct in-workspace path. If direct named-import proof rejects a target, the re-export walk now follows only actual re-export routes instead of reconsidering that same direct target. Duplicate export descriptors count across all export kinds, and `{ default as Local }` is not mistaken for a standalone default import. Unsupported or ambiguous forms keep the LSP fallback. This retains the TRAIN recall gain and nearly all CALIBRATION gain while removing speculative candidates from the allowed TEST split.

Round 6 removes the broad alias-candidate guard that had suppressed certified Q2 re-export proofs. The pre-existing unavailable-binding fixtures retain their original Q1/Q2 abstention reasons, and re-export-derived candidate membership is tested separately with an explicitly incomplete source index. Imported receiver types reached through named re-exports still fail closed under Q3. Q1/Q2/Q3 proof certification remains separate from this candidate-list change; the source and System One evaluations consume candidates and proposals, not `strictProof` results.

Seven TRAIN generated-list misses remain. They are Nest tagged-template calls whose tag syntax is currently classified as `unmapped`; there is no Tier A candidate list for them. They need the checker/LSP path or a future syntax-only tagged-template candidate rule. The other 31 misses in the bounded proposal list are `member` calls whose generated list contains the gold target but whose target does not survive System One proposal filtering/bounding. Calls needing receiver type inference stay with LSP.

One TRAIN singleton proposal points at the wrong same-named member (`close`) in Nest; its only ranking support is compatible argument count, and its signature is uncalibrated. The fail-closed signature gate abstains. This row does not affect generated-list singleton precision because the generated list is not a one-item list. Under the current calibration-frozen threshold, allowed TEST has 95 wrong score-threshold selections (86 bare, 9 member); these remain regression-only and are detailed in the TEST artifact.

## System One, secondary funnel evidence

The prior v7 threshold regression came from using the 99.5% accepted-site precision target as the duplicate-group precision floor. The runner now uses separate floors: 99.5% by site and 90% by duplicate group. With the import-resolution safety correction, all nine calibration score levels qualify and the maximum-coverage threshold is 0, selected from CALIBRATION only. The ranking policy remains `ordered-evidence-v1`.

| System One measure                        |             v6 baseline | v7 current, after safety correction |
| ----------------------------------------- | ----------------------: | ----------------------------------: |
| Frozen score threshold                    |                       0 |                                   0 |
| CAL accepted / coverage                   |  2,669 / 2,966 (89.99%) |              2,682 / 2,966 (90.42%) |
| CAL accepted precision                    |  2,662 / 2,669 (99.74%) |              2,675 / 2,682 (99.74%) |
| CAL duplicate-group precision             |                  99.10% |                              99.10% |
| CAL end-to-end top-1                      |                  89.75% |                              90.19% |
| CAL family mean / worst end-to-end        |         90.67% / 85.73% |                     91.21% / 85.73% |
| CAL site-weighted ECE / Brier             |       0.04044 / 0.04880 |                   0.04025 / 0.04856 |
| TRAIN LOFO accepted / coverage            | 9,194 / 13,496 (68.12%) |             8,648 / 13,496 (64.08%) |
| TRAIN LOFO accepted precision             |  9,184 / 9,194 (99.89%) |              8,639 / 8,648 (99.90%) |
| TRAIN LOFO end-to-end top-1               |                  68.05% |                              64.01% |
| TRAIN LOFO family mean / worst end-to-end |         75.25% / 63.41% |                     73.76% / 60.48% |
| Graft accepted precision                  |      868 / 875 (99.20%) |                  863 / 870 (99.20%) |
| Allowed TEST accepted / coverage          |  4,691 / 6,039 (77.68%) |              4,345 / 6,039 (71.95%) |
| Allowed TEST accepted precision           |  4,596 / 4,691 (97.97%) |              4,250 / 4,345 (97.81%) |
| Allowed TEST end-to-end top-1             |                  76.11% |                              70.38% |

The current calibration threshold satisfies both configured floors: 99.5% accepted-site precision and 90% duplicate-group precision. It accepts seven wrong sites: five bare RepoMind calls to `getProfile`, `getUserRepos`, or `getAdminAnalyticsSnapshot` ranked at score 1 on `same-directory`, and two `getRepoFullContext` calls at score 0 with no ranking signals. The two score-0 calls select same-named test-file declarations while their oracle target is in `src/lib/github.ts`. All seven selected targets and scores are unchanged from v6. The earlier v7 workspace-name scan had added the oracle candidate at these sites; the current generator omits it because those paths do not yield a supported direct function candidate under the P2-A boundary, leaving the unsupported resolution for LSP. This keeps aggregate calibration precision at the v6 level, but these rows demonstrate why signatures without adequate support must fail closed. The detailed site, call shape, family, chosen target, oracle target, generator effect, score, and ranking signals are recorded in [the calibration audit](tiered-call-resolution-phase2-p2b-v5-evidence/system1-v6-v7-calibration-audit.json).

| Site                                              | Call shape / family | v6 and v7 selected target (score, signal)                                           | Oracle target                                    |
| ------------------------------------------------- | ------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------ |
| `src/app/actions.ts:404:31`                       | bare / Repomind     | `src/app/actions.scan-policy.test.ts#getProfile` (1, `same-directory`)              | `src/lib/github.ts#getProfile`                   |
| `src/app/actions.ts:439:11`                       | bare / Repomind     | `src/app/actions.scan-policy.test.ts#getProfile` (1, `same-directory`)              | `src/lib/github.ts#getProfile`                   |
| `src/app/actions.ts:448:30`                       | bare / Repomind     | `src/app/actions.scan-policy.test.ts#getProfile` (1, `same-directory`)              | `src/lib/github.ts#getProfile`                   |
| `src/app/actions.ts:506:24`                       | bare / Repomind     | `src/app/actions.scan-policy.test.ts#getUserRepos` (1, `same-directory`)            | `src/lib/github.ts#getUserRepos`                 |
| `src/app/admin/stats/page.tsx:21:23`              | bare / Repomind     | `src/app/admin/stats/page.test.tsx#getAdminAnalyticsSnapshot` (1, `same-directory`) | `src/lib/analytics.ts#getAdminAnalyticsSnapshot` |
| `src/lib/__tests__/github-context.test.ts:178:30` | bare / Repomind     | `src/app/repo/[owner]/[repo]/page.test.tsx#getRepoFullContext` (0, no signal)       | `src/lib/github.ts#getRepoFullContext`           |
| `src/lib/__tests__/github-context.test.ts:240:30` | bare / Repomind     | `src/app/repo/[owner]/[repo]/page.test.tsx#getRepoFullContext` (0, no signal)       | `src/lib/github.ts#getRepoFullContext`           |

The product service continues to fail closed when a matching calibration record is absent (`uncalibrated-signature`); the score-threshold replay is an empirical evaluation proxy and does not waive that support gate.

The allowed heldout TEST regression has 95 wrong accepts. Every one was selected by the frozen calibrated threshold: 86 bare calls and 9 member calls. Of the bare errors, 82 ranked on compatible argument count plus same-directory and four on compatible argument count alone. The member errors comprise three with no ranking signal, three with same-binding peer members plus compatible argument count and same-directory, one with compatible argument count plus same-directory, and two with explicit receiver type. These heldout errors should be sent to the LSP/checker instead of accepted. This is diagnostic only: no TEST-specific threshold or signal rule was added. A general production gate still needs cross-family TRAIN/CALIBRATION support evidence, especially for member calls; the heldout rows alone cannot justify a new gate.

The v7 TRAIN LOFO family mean and worst are below v6 by 1.49 and 2.93 percentage points, respectively; Graft's accepted precision remains below the 99.5% cross-family site floor. On allowed TEST, v7 coverage is lower than v6 and accepted precision is 97.81%, also below the floor. TEST is regression-only; these results did not change candidate policy or the threshold. The calibration ECE/Brier values are similar between v6 and v7, but OOF calibration has only two calibration families and cannot establish transfer by itself.

The current Tier A generated list resolves 58.18% of resolved TRAIN sites and 64.40% of CALIBRATION sites as correct singletons without LSP. Another 41.77% of TRAIN sites have multiple candidates and 0.05% have no candidate list; these need LSP/checker resolution or candidate expansion. TRAIN generated-list recall is 99.95%, so nearly all of the multi-candidate pool already contains the gold candidate for the checker. The corpus contains only calls whose oracle target is inside the repository; it has no external-library targets. A singleton such as `close()` can therefore look unique even when an external library owns the real target. Singleton precision here does not remove the need for System One's calibration and fail-closed gates in production.

For an end-to-end KPI near 90%, restate the target as **Tier A candidate recall plus LSP/checker resolution**, not Tier A top-1. Candidate recall itself exceeds 90%; the LSP/checker share and combined end-to-end result still need a measured production stage.

## Evidence and reproduction

Machine-readable evidence is in [the v5 evidence directory](tiered-call-resolution-phase2-p2b-v5-evidence/):

- [paired pre-change aggregate](tiered-call-resolution-phase2-p2b-v5-evidence/candidate-recall-before-summary.json)
- [aggregate miss taxonomy](tiered-call-resolution-phase2-p2b-v5-evidence/candidate-miss-taxonomy.json)
- [candidate prediction manifest](tiered-call-resolution-phase2-p2b-v5-evidence/candidate-prediction-manifest.json)
- [TRAIN candidate recall](tiered-call-resolution-phase2-p2b-v5-evidence/candidate-recall-train.json), [CALIBRATION](tiered-call-resolution-phase2-p2b-v5-evidence/candidate-recall-calibration.json), [TEST](tiered-call-resolution-phase2-p2b-v5-evidence/candidate-recall-test.json), and [TEMPORAL](tiered-call-resolution-phase2-p2b-v5-evidence/candidate-recall-temporal.json)
- [license exclusion summary](tiered-call-resolution-phase2-p2b-v5-evidence/license-exclusion-summary.json)
- [v6/v7 calibration, error, LOFO, and TEST comparison](tiered-call-resolution-phase2-p2b-v5-evidence/system1-v6-v7-calibration-audit.json), [calibration threshold](tiered-call-resolution-phase2-p2b-v5-evidence/system1-calibration-threshold.json), [OOF calibration quality](tiered-call-resolution-phase2-p2b-v5-evidence/system1-calibration-quality-oof.json), [TRAIN family-transfer LOFO](tiered-call-resolution-phase2-p2b-v5-evidence/system1-train-family-transfer-calibrated-lofo.json), and [TEST regression](tiered-call-resolution-phase2-p2b-v5-evidence/system1-test-regression.json)

The source replay and candidate evaluation commands were:

```bash
node --import tsx scripts/semantic-corpus/phase2-tiered-call-resolution-runner.mts --predictions-only --out /private/tmp/docuvia-round5-source-v7
node --import tsx scripts/semantic-corpus/phase2-tiered-call-resolution-candidate-evaluation.mts --predictions /private/tmp/docuvia-round5-source-v7/predictions.jsonl --split train --out docs/gitbook/analysis/tiered-call-resolution-phase2-p2b-v5-evidence/candidate-recall-train.json
node --import tsx scripts/semantic-corpus/phase2-tiered-call-resolution-system1-runner.mts --mode develop --predictions /private/tmp/docuvia-round5-source-v7/predictions.jsonl --out /private/tmp/docuvia-round5-system1-v7-final
node --import tsx scripts/semantic-corpus/phase2-tiered-call-resolution-system1-runner.mts --mode calibrate --predictions /private/tmp/docuvia-round5-source-v7/predictions.jsonl --out /private/tmp/docuvia-round5-system1-v7-final
node --import tsx scripts/semantic-corpus/phase2-tiered-call-resolution-system1-runner.mts --mode calibration-quality-oof --predictions /private/tmp/docuvia-round5-source-v7/predictions.jsonl --out /private/tmp/docuvia-round5-system1-v7-final
node --import tsx scripts/semantic-corpus/phase2-tiered-call-resolution-system1-runner.mts --mode family-transfer-calibrated-lofo --predictions /private/tmp/docuvia-round5-source-v7/predictions.jsonl --out /private/tmp/docuvia-round5-system1-v7-final --freeze /private/tmp/docuvia-round5-system1-v7-final/system1-calibration-threshold.json
node --import tsx scripts/semantic-corpus/phase2-tiered-call-resolution-system1-runner.mts --mode heldout --predictions /private/tmp/docuvia-round5-source-v7/predictions.jsonl --out /private/tmp/docuvia-round5-system1-v7-final --freeze /private/tmp/docuvia-round5-system1-v7-final/system1-calibration-threshold.json
```

The same candidate evaluation command was run for `calibration`, `test`, and `temporal`. The System One runner was then run in `develop`, `calibrate`, `calibration-quality-oof`, `family-transfer-calibrated-lofo`, and `heldout` modes; the freeze came from calibration, TRAIN LOFO is descriptive, and TEST remains regression-only. Temporal contains no labeled sites.
