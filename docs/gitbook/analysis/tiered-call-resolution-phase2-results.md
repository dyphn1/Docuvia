# GRPH-008 Phase 2 — Calibration and Corpus Results

**Disposition:** measurement/report gate complete; promotion gate failed closed. No rule signature is calibrated, and no call may skip Tier B.

## Fixed-corpus result

The source-only runner processed all 10 pinned snapshots and produced 31,578 unique prediction rows: train 13,496, calibration 2,966, test 12,422, and temporal 2,694. It parsed 3,426 call-site files with zero parse failures. The corrected Phase 1 declared-facts artifact was pinned to SHA-256 `ba7b631b36ed05b1f16c6b500b0c17b5e4273acd939a493800848225c4dad14e`.

Raw ranking metrics use every labeled row in each split, including rows without candidates. Counts below are eligible-site denominators, not only rows with a top candidate.

| Split / family                               | Eligible | Candidate recall | Raw top-1 | Production selected |
| -------------------------------------------- | -------: | ---------------: | --------: | ------------------: |
| Calibration pooled                           |    2,966 |           0.9302 |    0.8972 |                   0 |
| `403errors/repomind`                         |    1,207 |           0.9743 |    0.9553 |                   0 |
| `Egonex-AI/Understand-Anything`              |    1,759 |           0.8999 |    0.8573 |                   0 |
| Test pooled                                  |   12,422 |           0.8312 |    0.6976 |                   0 |
| `abhigyanpatwari/GitNexus`                   |    6,249 |           0.7745 |    0.6715 |                   0 |
| `onyx-dot-app/onyx`                          |    6,173 |           0.8885 |    0.7240 |                   0 |
| Temporal pooled / `abhigyanpatwari/GitNexus` |    2,694 |           0.6511 |    0.5913 |                   0 |

Raw family-macro top-1 / worst-family top-1 are calibration **0.9063 / 0.8573**, test **0.6977 / 0.6715**, and temporal **0.5913 / 0.5913**. The raw calibration macro exceeds 0.90, but this is not the production family-macro gate.

All 31,578 rows have `candidateSetComplete=false` (31,571 mapped call shapes; seven without a mapped shape). The runtime gate therefore selects **zero** sites. Across the three labeled evaluation splits, coverage is **0/18,082** and abstention is **18,082/18,082**; across the full corpus, no call is promoted (**0/31,578**). Accepted-site precision, ECE, and Brier score are undefined, and eligible-site family-macro end-to-end top-1 is **0**. The 236 calibration signatures produced zero records: 231 lack 100 complete independent duplicate groups and five have no ranked candidate. Even the largest signature has 504 eligible calibration sites but zero complete independent groups. All calls remain ambiguous/unsupported and continue to Tier B.

This explains the apparent gap between the raw calibration family-macro top-1 (0.9063) and the required 0.90 family-macro end-to-end gate: the gate denominator is all eligible sites, including abstentions, and no row passes the production completeness check. No signature promotion is justified.

## Isolation and reproducibility

Thresholds were frozen at `2026-10-03T07:41:42.480Z`, before test or temporal labels were read by the runner. The calibration input fingerprint is `d48d538154c5fbde0722456b2f8e7b220a2cede6dee41e668ce008560117f8e0`; it contains only calibration prediction rows, calibration labels, `callsites.jsonl` SHA-256 `b61764cdaa1168ba453689c5e11f6a9b035a05273532068648092c48a0dbd362`, corrected facts SHA-256 `ba7b631b36ed05b1f16c6b500b0c17b5e4273acd939a493800848225c4dad14e`, implementation hash `dbae5f856f5ab1d3f8b2432dfe761c9fdfb2eec067a378c960a95959f976b3a0`, and configuration hash `a494f560642e05141d58300ec781dcf6e412d66ae8227a10a707892e0e701bbf`. A focused test proves that full-label and evaluation sidecar hashes are excluded from the calibration source-hash allowlist. The run summary separately records the corpus-wide `labels.jsonl` SHA-256 `ce0c0bcbbf3c20b47ada2b6c5cccadfafda6a4a5978d8f668c068d88cba6c4c7` as provenance only; it is not an input to the frozen calibration fingerprint.

Test and temporal labels were already exposed during attempt 2. Attempts 2–4 are regression/reproduction observations only, never unseen confirmation or final certification. Attempt 1 stopped before held-out evaluation. Attempt 3 fixed production candidate completeness but still fingerprinted the full labels sidecar; attempt 4 fixes that provenance leak. The final attempt therefore confirms deterministic Phase 2 disposition, but does not provide unseen evidence. Any final certification must use new data after Phases 3–5 and the rule/configuration are frozen.

Final attempt 4 ran with Node `v24.14.1` and TypeScript `5.9.3`: 38.25 seconds wall time, 5,430,476,800-byte peak RSS, 10.44 seconds parsing, 1.61 seconds hypothesis ranking, p50/p95 hypothesis latency 0.0136/0.2147 ms, 299,959 generated candidates, and zero LSP requests. Reproduce with `PATH=/Users/daniel.chang/.nvm/versions/node/v24.14.1/bin:$PATH /usr/bin/time -l node --import tsx scripts/semantic-corpus/phase2-tiered-call-resolution-runner.mts`. Inputs include corpus manifest `f00c5b8fc6fada04fc0934dbc7b19157cf3b380f0a94fc46e596a3186dbd4c61`, collection report `159413d22bee7c14f0e76e510e06d7110f897732f4e6413653a4c37b80938c14`, and corpus spec `867b96f393be018c7552036b18d8164d8fcdd9f21fe8d3a2f100d674fd64e69a`.

Attempt 4 artifact hashes: predictions `3a250e913a1927376adbb7309d3281d3454a51e18abbe7d181c0f923da328aa5` (31,578 rows); empty calibration records `01ba4719c80b6fe911b091a7c05124b64eeece964e09c058ef8f9805daca546b`; freeze `b14ef4f8a4fde17dd4ed63edc5b9ee3b2a0f98a1b338d4701a8f54f0ddfc931f`; full summary `339141d236201ad5d2572f8005910af5d1886f4e938fc7bc6dfabc0850d1bded`; runner log `7a7b18045cbe71685b795e7e6035424b5ff03f3a4c62969d3db1be1a41266cc1`. Predictions were independently checked for 31,578 unique sample IDs and all 31,578 have `candidateSetComplete=false`.

| Attempt | Status                                                                                                        | Key evidence                                                                                                                                                                                                                      |
| ------- | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1       | Diagnostic; stopped before held-out evaluation on zero-support bound error                                    | predictions `3a250e913a1927376adbb7309d3281d3454a51e18abbe7d181c0f923da328aa5`; log `6f35fa99761c94ddad8cc32eaa930ea3acc6d2c163324f50883c3a76f671bc11`                                                                            |
| 2       | Diagnostic; held-out labels exposed; incomplete candidate sets were selectable                                | records `59f8216cb3d92b42e76feb43b232f54947c778c74ff614fca2dffcbbd019d141`; freeze `64bc5dab571b4cb6e98f005aa474c9a4dc6570084a745ddab29df13c0530e686`; summary `c5cb51b2e419969068b620e4ea345ce508bfeefb51b4f414d1cd7e5cc1108a85` |
| 3       | Diagnostic reproduction; held-out labels exposed; completeness fixed, full-label hash remained in fingerprint | records `01ba4719c80b6fe911b091a7c05124b64eeece964e09c058ef8f9805daca546b`; freeze `4d2ffff164f483460ec3bb98d8626ce7dc02c072363d785b88d16687251e7853`; summary `45909e7a31127aca9712144f9b265ba5553b87a45edb28eb74938674c00c6c2c` |
| 4       | Final Phase 2 reproduction; held-out labels still exposed and regression-only                                 | hashes above; no calibration records and no promotions                                                                                                                                                                            |

## Stage handoff

Phase 2 adds a bounded calibration evaluator, source-backed corpus runner, source/facts reconstruction helpers, and hypothesis-index completeness alignment. Inputs are the pinned corpus/source snapshots, call-site rows, corrected declared-type facts, calibration labels, implementation and configuration. Outputs are source-only predictions, frozen calibration records, and per-split/per-family metrics. Phase 3 remains responsible for strict type-binding proofs, dependency fingerprints/invalidation, and transactional `node_links(calls)` projection. Phase 4 must retain Tier B scheduling for every uncertified signature; Phase 5 must preserve certainty in snapshots and outputs. Final unseen certification remains unrun.
