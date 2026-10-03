# Tiered call resolution P2-B: System One ranking evaluation

## Scope and decision

This slice evaluates the existing deterministic `ordered-evidence-v1` ranker over the source-only candidate sets produced by candidate generator `declared-member-hypothesis-v3`. A score threshold selects an evaluation-only `likely` result or abstains as `ambiguous`. Incomplete candidate inventories are included; this evaluation does not establish `proven`, change the production proof/completeness gate, modify Tier B scheduling or `node_links(calls)`, or authorize skipping Tier B.

The frozen threshold met the 90% accepted-site and conservative duplicate-group precision targets on the calibration split at score `0`, the maximum-coverage qualifying threshold. This threshold did **not** transfer across the held-out data: raw top-1 fell to 38.92% on test and 45.29% on temporal. The result is diagnostic evidence, not a promotion, certification, or generalization claim. No ranker, rule, threshold, or evaluator changes were made after opening test/temporal labels.

## Data isolation and evaluation

Source predictions were produced without labels (`labelsRead: false`) for 31,578 rows: train 13,496; calibration 2,966; test 12,422; temporal 2,694. The runner uses train labels only for descriptive development, calibration labels only to choose/freeze the threshold, and writes a one-shot exposure marker before reading test/temporal labels. Test and temporal are reported only as fixed-rule regression results. Their labels were already exposed by this run and must not be used to retune this rule or to claim unseen certification.

All eligible sites remain in the site denominator, including rows with no unique fact mapping. `scorable` and `unscorable` counts describe label-to-fact mapping, not candidate eligibility. Raw top-1 and end-to-end accuracy use all eligible sites. Accepted-site precision counts an unscorable selected site as incorrect. Duplicate-group precision conservatively counts conflicting duplicate labels as incorrect. `likely` selections were made against incomplete inventories in every split; they are evaluator output only.

The frozen summary does not separately store the count of selected sites whose labels are scorable. To preserve the one-shot heldout protocol, that count was not recomputed from the exposed labels. Therefore accepted-site precision below uses **all selected sites** as its denominator, including selected sites with unscorable labels; this is a conservative lower bound on precision among scorable accepted rows. Duplicate-group precision uses all selected duplicate groups as its denominator.

## Overall metrics

| Split                                | Eligible sites (scorable / unscorable) |                Raw top-1 | Likely selected / coverage |      Abstained | Accepted-site precision | Accepted duplicate groups / precision |        End-to-end top-1 |
| ------------------------------------ | -------------------------------------: | -----------------------: | -------------------------: | -------------: | ----------------------: | ------------------------------------: | ----------------------: |
| Train, descriptive at frozen score 0 |                13,496 (12,177 / 1,319) | 10,783 / 13,496 = 79.90% |             9,191 / 68.10% | 4,305 / 31.90% |  9,181 / 9,191 = 99.89% |                8,096 / 8,181 = 98.96% | 9,181 / 13,496 = 68.03% |
| Calibration, threshold selection     |                    2,966 (2,766 / 200) |   2,664 / 2,966 = 89.82% |             2,668 / 89.95% |   298 / 10.05% |  2,661 / 2,668 = 99.74% |                2,423 / 2,445 = 99.10% |  2,661 / 2,966 = 89.72% |
| Test, exposed regression             |                 12,422 (5,401 / 7,021) |  4,835 / 12,422 = 38.92% |             4,819 / 38.79% | 7,603 / 61.21% |  4,711 / 4,819 = 97.76% |                4,478 / 4,583 = 97.71% | 4,711 / 12,422 = 37.92% |
| Temporal, exposed regression         |                  2,694 (1,308 / 1,386) |   1,220 / 2,694 = 45.29% |             1,206 / 44.77% | 1,488 / 55.23% |  1,203 / 1,206 = 99.75% |                1,169 / 1,172 = 99.74% |  1,203 / 2,694 = 44.65% |

The high accepted precision on held-out rows is conditional on a selection that covers only 38.79% of test sites and 44.77% of temporal sites. It does not offset the large all-site accuracy drop. In particular, one test family has only 0.32% raw top-1 and 60.61% precision among 33 selected sites.

## Family breakdown

`raw` and `end-to-end` use the eligible-site denominator for each family; precision is conditional on selected sites.

| Split / family                                                | Eligible sites | Raw top-1 | Selected | Accepted-site precision | End-to-end top-1 |
| ------------------------------------------------------------- | -------------: | --------: | -------: | ----------------------: | ---------------: |
| Train — dyphn1/Docuvia                                        |          3,610 |    79.92% |    2,291 |                 100.00% |           63.46% |
| Train — nestjs/nest                                           |          8,000 |    77.16% |    5,375 |                  99.96% |           67.16% |
| Train — tirth8205/code-review-graph                           |             77 |   100.00% |       65 |                 100.00% |           84.42% |
| Train — trailhq/Graft                                         |            888 |    97.86% |      875 |                  99.20% |           97.75% |
| Train — typescript-language-server/typescript-language-server |            921 |    84.58% |      585 |                  99.83% |           63.41% |
| Calibration — 403errors/repomind                              |          1,207 |    95.77% |    1,160 |                  99.40% |           95.53% |
| Calibration — Egonex-AI/Understand-Anything                   |          1,759 |    85.73% |    1,508 |                 100.00% |           85.73% |
| Test — abhigyanpatwari/GitNexus                               |          6,249 |     0.32% |       33 |                  60.61% |            0.32% |
| Test — onyx-dot-app/onyx                                      |          6,173 |    78.00% |    4,786 |                  98.02% |           75.99% |
| Temporal — abhigyanpatwari/GitNexus                           |          2,694 |    45.29% |    1,206 |                  99.75% |           44.65% |

The calibration split contains two repository families; its results do not establish broad family generalization. The test regression shows a severe family shift and low precision for the small set selected in GitNexus. No family-specific threshold or rule was fitted after observing this.

## Call-shape breakdown

| Split / shape        | Eligible sites | Raw top-1 | Selected | Accepted-site precision | End-to-end top-1 |
| -------------------- | -------------: | --------: | -------: | ----------------------: | ---------------: |
| Train — arg-chain    |            517 |    79.88% |        0 |                       — |            0.00% |
| Train — bare         |          5,684 |    85.94% |    4,786 |                  99.96% |           84.17% |
| Train — member       |          7,087 |    76.18% |    4,320 |                  99.81% |           60.84% |
| Train — this         |            201 |    42.79% |       85 |                 100.00% |           42.29% |
| Train — unmapped     |              7 |     0.00% |        0 |                       — |            0.00% |
| Calibration — bare   |          2,222 |    89.42% |    1,994 |                  99.65% |           89.42% |
| Calibration — member |            744 |    90.99% |      674 |                 100.00% |           90.59% |
| Test — arg-chain     |             33 |    15.15% |        0 |                       — |            0.00% |
| Test — bare          |          9,093 |    45.38% |    4,225 |                  97.66% |           45.38% |
| Test — member        |          3,199 |    22.01% |      594 |                  98.48% |           18.29% |
| Test — this          |             97 |     0.00% |        0 |                       — |            0.00% |
| Temporal — arg-chain |             10 |     0.00% |        0 |                       — |            0.00% |
| Temporal — bare      |          2,549 |    46.88% |    1,187 |                 100.00% |           46.57% |
| Temporal — member    |            135 |    18.52% |       19 |                  84.21% |           11.85% |

## Frozen rule and provenance

Threshold selection evaluated nine score thresholds and all nine met the calibration precision constraints; score `0` was selected as the qualifying threshold with maximum coverage. The ranker is the existing deterministic evidence order, not a learned model. Its integer/ordinal score is not a probability, so ECE and Brier score are not applicable. No latency, peak memory, or end-to-end per-call cost profile was collected.

| Input / artifact                                          | SHA-256                                                            |
| --------------------------------------------------------- | ------------------------------------------------------------------ |
| Candidate source predictions                              | `3f9324a4002fa327123e8cb926aea2ae23544c4f1512d8d19c23a52a040739ed` |
| Source prediction manifest (`labelsRead: false`)          | `f0b0cd77369bfdc24c09f3ec2637a9c0f7737ada44d41d7fee30bd4c17248918` |
| Corrected source facts                                    | `ba7b631b36ed05b1f16c6b500b0c17b5e4273acd939a493800848225c4dad14e` |
| Candidate generation source implementation                | `fb1921719c18e792a81b14bedce386a15023374ab9edcbabd6f59a1c803ffcb8` |
| System One evaluator/runner implementation                | `4166981d8812c1385ca8efb28f9ec37d50b113dfbe209ddf9739213992114eef` |
| Ranking policy / candidate generator                      | `ordered-evidence-v1` / `declared-member-hypothesis-v3`            |
| Configuration                                             | `805e2af39085c8df5a5b8dc7bf63f33ad484d9fb9fc983337c1d496e825e61b9` |
| Split assignment                                          | `41c9c0649c6e68d2afc4c66c8978ea3dfacbfbd78a67760f1f167b4cabeda595` |
| Calibration labels                                        | `5b2892aa4be1ea53c76ff6dc189c0c78c3bf3d83af61639cbd1c59716710c426` |
| Calibration input fingerprint                             | `6b17c9d1710a2eb95b5768466b5c98605d1070a0be8730d3bffc6d936093ee90` |
| Unique oracle alias allowlist (72,676 aliases)            | `67ccf482e32d0a83bb0f8ff214ca61ac1cea6d1e6c75507a176679af98641484` |
| Train development artifact                                | `b9fb1cbcd14b5ebc6b12656721d7977f48606b7e9c144730eb435613d50b29f4` |
| Calibration metrics artifact                              | `5f658a24126f3975f697b117b055a950090dd569d2171c855af6a9dcb301863f` |
| Frozen calibration threshold artifact (score 0)           | `daa3b456d3032236b0e2c46f4fb376456befa5925a26c4acf90debf6eba9a740` |
| Test regression artifact                                  | `320ed1b635654ec4ab19c91125f04f046b54a3da574fab928385d45ce5122c97` |
| Temporal regression artifact                              | `54ee8cc87bb5be4dc23c059eac762a6e3f0f5a30d0d0bfe1d100888a5b1c1b08` |
| Runner-written heldout exposure marker, before formatting | `bc4ed9f6a3bb37cb1b2ebe22494b01c7654516aff5a92d48e5d31ea3aae01e6e` |
| Committed heldout exposure marker, JSON formatting only   | `a393bde726aa99e41012e1856467cb5722bbcae0e71040762c167d77df456a75` |

The freeze was written at `2026-10-03T16:21:34.625Z`; test and temporal labels were opened once at `2026-10-03T16:23:56.471Z`. The freeze pins the candidate/ranking versions, implementation, facts/config/source hashes, split assignment, calibration-label hash, training development artifact, and calibration rule-signature set. The calibration fingerprint excludes test and temporal label bytes.

After the one-shot run completed, Prettier normalized whitespace in the exposure marker JSON for the repository pre-commit formatter. Its parsed values, including the freeze hash, open timestamp, and split names, were unchanged; both byte hashes are recorded above.

## Reproduction commands

Run under Node `v24.14.1` from the repository root. The first two commands are safe to reproduce with the same immutable inputs; the final command is one-shot because it opens exposed heldout labels and writes an exclusive exposure marker.

```sh
PATH=/Users/daniel.chang/.nvm/versions/node/v24.14.1/bin:$PATH pnpm exec tsx scripts/semantic-corpus/phase2-tiered-call-resolution-system1-runner.mts --mode develop --predictions evaluate/results/semantic-corpus/v1/phase2-p2a-named-arrows-attempt-3/predictions.jsonl --out docs/gitbook/analysis/tiered-call-resolution-phase2-p2b-evidence

PATH=/Users/daniel.chang/.nvm/versions/node/v24.14.1/bin:$PATH pnpm exec tsx scripts/semantic-corpus/phase2-tiered-call-resolution-system1-runner.mts --mode calibrate --predictions evaluate/results/semantic-corpus/v1/phase2-p2a-named-arrows-attempt-3/predictions.jsonl --out docs/gitbook/analysis/tiered-call-resolution-phase2-p2b-evidence

PATH=/Users/daniel.chang/.nvm/versions/node/v24.14.1/bin:$PATH pnpm exec tsx scripts/semantic-corpus/phase2-tiered-call-resolution-system1-runner.mts --mode heldout --predictions evaluate/results/semantic-corpus/v1/phase2-p2a-named-arrows-attempt-3/predictions.jsonl --out docs/gitbook/analysis/tiered-call-resolution-phase2-p2b-evidence --freeze docs/gitbook/analysis/tiered-call-resolution-phase2-p2b-evidence/system1-calibration-threshold.json
```

The heldout command completed successfully. No additional heldout run or threshold selection is permitted on these same rows.

## Artifacts and validation

Machine-readable summaries are in [`tiered-call-resolution-phase2-p2b-evidence`](tiered-call-resolution-phase2-p2b-evidence/):

- `system1-train-development.json`
- `system1-calibration-metrics.json`
- `system1-calibration-threshold.json`
- `system1-heldout-exposure.json`
- `system1-test-regression.json`
- `system1-temporal-regression.json`

Focused evaluator tests cover incomplete candidate sets, all-eligible denominators, duplicate-group conflicts, split isolation, threshold selection, ties, truncation, unsupported shapes, and unmapped targets. The evaluator and runner are analysis tooling only; `CallResolutionHypothesisService`, Tier B behavior, and call-edge persistence were not changed in P2-B.
