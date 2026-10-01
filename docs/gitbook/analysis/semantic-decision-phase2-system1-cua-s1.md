# Semantic decision Phase 3: CUA-S1 option scoring

P3 evaluates a small local CUA-S1 model as an offline scorer for the P1 state records through the P2 evaluator. It does not add model inference to Docuvia production behavior, route requests, start a daemon, or write to the graph. Python adapter and training code live in `scripts/semantic-corpus/system1-models/cua_s1/`; weights and replay outputs stay under the gitignored `evaluate/results/semantic-corpus/v1/` tree.

## State and option encoding

The scorer receives batches of P1 state JSONL records. It rejects state inputs containing label-only, oracle, review, checker, candidate-miss, or gold fields. It never opens a labels file. The training entry point separately joins request-keyed state and label rows from `train` and `calibration` only.

The first P3 run's encoding is retained below as a historical run, but the verifier identified that it truncated candidate identities and import evidence. Its negative model result is therefore not evidence that CUA-S1 cannot discriminate candidates. The corrected v2 encoding and pool-only audit gate below were fixed before the v2 fit began.

### Corrected v2 encoding — fixed before retraining

Inspection of the pinned CUA-S1 `ByteCollator` confirmed that `context_tokens` and `option_tokens` count UTF-8 bytes: `_byte_ids` maps each byte to one token. The v2 fit keeps the supported **96-byte option limit** and raises the context limit to **1,024 bytes**. No tokenizer substitution or option-budget increase is used.

Each candidate is encoded in this fixed, space-separated form: `r{rank} {evidenceCode} {kindCode} {statusCode} {targetId} {signature}`. Evidence codes are `call` for `tier-a-calls-edge`, `name` for `tier-a-same-name`, `file` for `tier-a-imports-file`, and `other` for an unmapped value. Declaration-kind codes are `c` class, `f` function, `i` interface, `m` method, `p` property, `t` type-alias, `u` unknown, and `v` variable. Evidence status is `p` present or `m` missing. Rank is `r0`, `r1`, or `r2`. The 96-byte budget is allocated in order: compact prefix, target ID, then signature. If the target ID does not fit, only its file path is middle-elided; the entire `#symbol` and container suffix is preserved. The signature takes only the remaining bytes and is clipped at its end. P1 candidate order and stable option IDs remain unchanged; `UNKNOWN` and `VERIFY_WITH_LSP` remain the final controls.

The context is an ordered compact text record, not sorted JSON: `import binding (kind, local/imported alias, source specifier, barrel status, path-alias flag)`, `caller symbol and file`, `receiver and generic hints`, `call kind/callee/expression`, then `sourceWindow`. The source window is always last and has a separate 160-byte sub-budget. Per-field caps are 320 bytes for import binding, 184 for caller, 112 for receiver/generics, 216 for call syntax, and 160 for source window; separators and field caps keep the total below 1,024 bytes. The caller symbol is placed before the caller file path. The source specifier is placed before the source window and is retained whole whenever it fits its import-binding budget.

Candidate options keep P1's order and IDs. No candidate or target is manufactured. CUA-S1 returns one logit per option; the adapter applies an independent sigmoid (no softmax) and rounds each probability to six decimal places for the P2 `scoreKind: "raw"` contract.

Before fitting, `audit_encoding.py` reads only train/calibration state and label files. It reports request- and pair-level duplicate candidate encodings, candidate symbol survival, import source-specifier survival, and trusted gold-to-decoy encoding collisions. A duplicate declaration is excluded from the gold/decoy collision denominator only when its full target ID and full declaration text are equal; such pairs are separately counted. The gate requires symbol survival of at least 99% and gold-to-decoy collision rate at most 1% in the pooled data and in each fitting split. A failed gate blocks training.

The old encoder's independently reproduced fitting-pool baseline was: 62.40% of 6,088 multi-candidate requests had a duplicate candidate encoding (216,509/535,340 candidate pairs collided); no complete `#symbol` plus container suffix survived the old truncation rule in 66,555 candidates (the verifier's symbol-name-only metric was 2.3%); import source specifier survived in 28.80% of 9,114 applicable requests; and 19.00% of 6,033 trusted multi-candidate gold/decoy requests had identical encoded options (1,146 requests, 5,015 pairs). No exact same-target-ID/full-text duplicate declarations were observed. These are pool-only measurements; no temporal or test input was used.

The v2 pre-training audit passed before training was launched. It read exactly `train-state.jsonl`, `train-labels.jsonl`, `calibration-state.jsonl`, and `calibration-labels.jsonl`; `trainingStarted` was false. Symbol suffix survival was 66,555/66,555 (100%) overall, and source-specifier survival was 9,114/9,114 (100%). Of 6,088 multi-candidate requests, 27 (0.4435%) had any duplicate encoding; 54/535,340 candidate pairs collided (0.0101%). Trusted gold/decoy collisions were 0/48,959 pairs and 0/6,033 eligible requests; genuinely identical same-target/full-text declaration pairs were 0. Train and calibration were each independently above the symbol and gold-collision gates; the report records their duplicate rates separately. The deterministic audit report SHA-256 is `3ce9b7dd6b51898c391d24309b1ed7ea43bde1276aaf5df586b3e48462bd31a`. Training refuses to start unless this passing report is present and its four fitting-file hashes match the files it will read.

## Labels and training targets

Training reads only the `train-state.jsonl`/`train-labels.jsonl` and `calibration-state.jsonl`/`calibration-labels.jsonl` pairs. Rows are streamed and matched by request ID. A row is trusted only if review is `confirmed`, oracle status is `resolved`, the positive set is nonempty, and positive/negative target IDs do not conflict. Other rows are excluded from fitting.

Candidate options receive independent binary targets: 1 for a gold-positive target ID and 0 otherwise. `UNKNOWN` receives 1 exactly when no candidate option matches any positive target. `VERIFY_WITH_LSP` receives 1 when `candidateMiss` is true or no candidate is gold-positive; otherwise it receives 0. Thus a partial candidate miss can train an available gold option and still request verification. An empty candidate set can train the two control options, but cannot introduce a candidate target.

Evaluation-only licensing is kept out of model fitting: P1's temporal and test partitions are not opened by the trainer. They are read by the P2 final-evaluation path only after P2 verifies each seal and freezes the selected policy.

## Nested LOFO and fixed configuration

The P2 fitting pool is the seven repo families represented in `train + calibration`. P3 trains one model per family on the other six families for out-of-fold scoring, then trains the final held-out model on all seven. The scoring adapter chooses the matching fold model for a pool request and the final model for temporal/test requests. The generated scorer manifest records the family plan, per-fold and final safetensors/config SHA-256 values, runtime versions, and the canonical configuration hash. P2 receives the corresponding complete folded training-family manifest.

The following choices were fixed before training; there is no held-out tuning, validation-based early stopping, or training on temporal/test:

| Setting            | Fixed value                                                                                                                                               |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Encoder            | CUA-S1 `tinyx`, width 128, rank 128, two context layers, four heads, dropout 0.1                                                                          |
| Byte limits for v2 | Context 1,024; option 96                                                                                                                                  |
| Objective          | Independent option `BCEWithLogitsLoss`, masked padding excluded                                                                                           |
| Optimizer          | AdamW, learning rate 0.0003, weight decay 0.0001                                                                                                          |
| Epochs             | One fixed epoch per fold and final model; retained after the earlier measured 39m 59s run, since two epochs would exceed the available bounded run window |
| Batch size         | 8 examples                                                                                                                                                |
| Gradient clipping  | Global norm 1.0                                                                                                                                           |
| Seeds              | Base seed 553; fold-index offset 1,009; final model uses the next offset                                                                                  |
| Device/threads     | CPU only; four PyTorch/BLAS threads; deterministic algorithms enabled                                                                                     |
| Data order         | Stable P1 JSONL order, train followed by calibration; no shuffle or early stopping                                                                        |

The v2 training entry point also emits periodic batch-loss/RSS progress and, after each epoch, in-sample training-split diagnostics (mean option BCE and whether top-ranked option has any positive target). These are fit diagnostics, not OOF or held-out evaluation metrics. P2 policy certification remains unchanged.

The training entry point caps process peak RSS at 3 GiB and prints RSS per epoch. The run is monitored with macOS `memory_pressure`; it is stopped if system-wide free memory drops below 25%. The external scorer uses small internal inference batches and the same 3 GiB process RSS ceiling.

## Prior routing checkpoint reference

The previous public/prior harness-routing checkpoint is applicable as a zero-shot reference: CUA-S1 accepts a variable number of option strings and returns one score per option without requiring a fixed label catalog. The reference uses the checkpoint read-only, without loading labels or adapting its weights. Its training task was harness intent routing with 13 fixed labels, so its semantic candidate scores are out-of-domain and are only a weak baseline. It declares `no-training` relative to the P1 fitting families; its pool responses still carry P2's required fold-family identity.

## Historical v1 results (superseded by corrected v2 below)

This section records the first encoding's measurements for traceability only. The verifier found that its candidate identity and import context were truncated, so these figures are superseded by the corrected-v2 evaluation below.

Results below use P2's default LOFO certification and its 0.990 target. The 0.995 and 0.999 outcomes are identical: both CUA scorers are uncertifiable at all three targets, while tierA-rank-prior certifies threshold `1` at all three. An uncertifiable target causes P2 to route every non-empty candidate set to `VERIFY_WITH_LSP`; it does not apply the diagnostic threshold.

The calibration split is part of the seven-family pool and its scores are out-of-fold. Its threshold-selection precision is therefore diagnostic, not an independent held-out estimate. Temporal and test are sealed held-out results.

| Scorer                   | Split           | Commits / requests (avoidance) | Exact-set precision (95% Wilson CI) | Multi-candidate commits / requests | False-safe | UNKNOWN |  VERIFY |    ECE |
| ------------------------ | --------------- | -----------------------------: | ----------------------------------: | ---------------------------------: | ---------: | ------: | ------: | -----: |
| CUA-S1 domain adapted    | Calibration OOF |              0 / 2,966 (0.00%) |                                 n/a |                                  — |          0 |   0.00% | 100.00% | 0.1066 |
| CUA-S1 domain adapted    | Temporal        |              0 / 2,694 (0.00%) |                                 n/a |                            0 / 568 |          0 |   0.00% | 100.00% | 0.0456 |
| CUA-S1 domain adapted    | Test            |             0 / 12,422 (0.00%) |                                 n/a |                          0 / 3,704 |          0 |   0.00% | 100.00% | 0.0635 |
| CUA-S1 routing reference | Calibration OOF |              0 / 2,966 (0.00%) |                                 n/a |                                  — |          0 |   0.00% | 100.00% | 0.0359 |
| CUA-S1 routing reference | Temporal        |              0 / 2,694 (0.00%) |                                 n/a |                            0 / 568 |          0 |   0.00% | 100.00% | 0.3345 |
| CUA-S1 routing reference | Test            |             0 / 12,422 (0.00%) |                                 n/a |                          0 / 3,704 |          0 |   0.00% | 100.00% | 0.1851 |
| TierA-rank-prior         | Calibration OOF |         1,367 / 2,966 (46.09%) |                100.00% (99.72–100%) |                                  — |          0 |   0.57% |  53.34% | 0.0262 |
| TierA-rank-prior         | Temporal        |         2,113 / 2,694 (78.43%) |                100.00% (99.82–100%) |                            0 / 568 |          0 |   0.26% |  21.31% | 0.0484 |
| TierA-rank-prior         | Test            |        4,941 / 12,422 (39.78%) |                100.00% (99.92–100%) |                          0 / 3,704 |          0 |   0.41% |  59.81% | 0.0123 |

Avoidance is commits/requested trusted requests. UNKNOWN and VERIFY both incur the LSP cost and write no edge, so neither counts as avoidance. Exact-set precision is undefined for rows with no commits. False-safe is a committed request whose selected candidate set differs from the gold positive set; candidate-miss requests are counted false-safe if committed. No held-out candidate misses were committed here (7 temporal, 65 test). ECE uses P2's fixed 15 bins.

### Certification and OOF family diagnostics

| Scorer                   | Certified threshold at 0.990 / 0.995 / 0.999  |                     0.990 OOF diagnostic threshold | Pooled exact / commits | Pooled CP lower bound |
| ------------------------ | --------------------------------------------- | -------------------------------------------------: | ---------------------: | --------------------: |
| CUA-S1 domain adapted    | uncertifiable / uncertifiable / uncertifiable | 0.86420 (best pooled lower bound; diagnostic only) |          5,495 / 5,718 |               0.95652 |
| CUA-S1 routing reference | uncertifiable / uncertifiable / uncertifiable | 0.22651 (best pooled lower bound; diagnostic only) |        10,335 / 16,376 |               0.62486 |
| TierA-rank-prior         | 1 / 1 / 1                                     |                                      1 (certified) |          7,214 / 7,214 |               0.99958 |

The following family table gives exact-set precision at each scorer's row-specific threshold above. For the uncertifiable CUA scorers the values are diagnostics, not an allowed commit policy. `*` means fewer than the 200 commits required to participate in the family gate; such families still contribute to the pooled bound.

| Fitting family                                        | Domain adapted: exact / commits (precision) | Routing reference: exact / commits (precision) | TierA prior: exact / commits (precision) |
| ----------------------------------------------------- | ------------------------------------------: | ---------------------------------------------: | ---------------------------------------: |
| 403errors/repomind                                    |                        143 / 143 (100.00%)* |                         1,129 / 1,190 (94.87%) |                     139 / 139 (100.00%)* |
| Egonex-AI/Understand-Anything                         |                         845 / 845 (100.00%) |                         1,228 / 1,759 (69.81%) |                  1,228 / 1,228 (100.00%) |
| dyphn1/Docuvia                                        |                      2,182 / 2,280 (95.70%) |                         2,568 / 3,608 (71.18%) |                  2,223 / 2,223 (100.00%) |
| nestjs/nest                                           |                          928 / 965 (96.17%) |                         3,832 / 7,933 (48.30%) |                  2,176 / 2,176 (100.00%) |
| tirth8205/code-review-graph                           |                            9 / 9 (100.00%)* |                              65 / 77 (84.42%)* |                       65 / 65 (100.00%)* |
| trailhq/Graft                                         |                         715 / 715 (100.00%) |                             841 / 888 (94.71%) |                      840 / 840 (100.00%) |
| typescript-language-server/typescript-language-server |                          673 / 761 (88.44%) |                             672 / 921 (72.96%) |                      543 / 543 (100.00%) |

The domain-adapted fold weight SHA-256 values, in deterministic family order, are:

| Held-out fold family                                  | Weights SHA-256                                                    |
| ----------------------------------------------------- | ------------------------------------------------------------------ |
| 403errors/repomind                                    | `b2682bd428bf619b513ad5f75235e7f59617f41a5b4132e016d30787781b00f7` |
| Egonex-AI/Understand-Anything                         | `371288067770da1d741d39c2c5664c61114333379b2ff0a87390731b7973c597` |
| dyphn1/Docuvia                                        | `ef9073f11daa349d12338466c5a010c8eafd383ae5a68c731269ed536de00d2a` |
| nestjs/nest                                           | `ddbc7519567990c097fe24aa57a7a21a8765604552b99f7629ed4b8a15fd3ed5` |
| tirth8205/code-review-graph                           | `251e494f5b49e763d8c289c4b901ca93426999c8c15001558225d9a8e1d2065a` |
| trailhq/Graft                                         | `b0aaa91790a64887add8daafe513590f578b4d4865110665c6590202317bd948` |
| typescript-language-server/typescript-language-server | `81cd7acff46bac9ed444385be51b38c10b5be73964fe2ebd23406f35585d1f33` |

The domain-adapted model's family gate fails for Docuvia, Nest, and TypeScript Language Server. The routing reference fails the family gate on every family with at least 200 commits. TierA-rank-prior certifies because its committed OOF requests are exact in every family; the two low-count families are below the minimum gate size.

### Ambiguity and evidence slices

Ambiguity tags overlap, so class counts do not sum to the split size. The two CUA columns have zero commits in every slice because their targets are uncertifiable. The tierA columns show the certified baseline's committed request count.

| Ambiguity class                              | Temporal requests | Test requests | TierA commits: temporal / test | CUA commits: temporal / test |
| -------------------------------------------- | ----------------: | ------------: | -----------------------------: | ---------------------------: |
| DI/registry lookup                           |                 0 |             0 |                          0 / 0 |                        0 / 0 |
| Alias/renamed import                         |                 7 |            63 |                          0 / 0 |                        0 / 0 |
| Barrel/re-export                             |               308 |         1,535 |                      169 / 353 |                        0 / 0 |
| Computed-but-bounded import                  |                 0 |             0 |                          0 / 0 |                        0 / 0 |
| Fluent/chained call                          |                27 |         1,248 |                        1 / 552 |                        0 / 0 |
| Framework convention                         |                 0 |             0 |                          0 / 0 |                        0 / 0 |
| Generated wrapper/facade                     |                18 |           284 |                        6 / 215 |                        0 / 0 |
| Generic factory                              |                 0 |            15 |                          0 / 2 |                        0 / 0 |
| Other/plain                                  |             2,321 |         5,818 |                  1,935 / 3,804 |                        0 / 0 |
| Overloads                                    |                 3 |            19 |                         2 / 15 |                        0 / 0 |
| Path alias                                   |                 5 |         4,471 |                          0 / 0 |                        0 / 0 |
| Runtime string token                         |                 0 |             0 |                          0 / 0 |                        0 / 0 |
| Unresolved receiver with small candidate set |                11 |            73 |                          0 / 0 |                        0 / 0 |

P1 reports `not-detected` unresolved-receiver cases separately: 24 temporal and 82 test requests. No other not-detected class has nonzero held-out counts. For the missing-evidence slice, temporal has 244 requests with any missing candidate evidence and 2,450 without; test has 1,713 and 10,709 respectively. TierA-rank-prior commits 4/244 and 2,109/2,450 on temporal, and 12/1,713 and 4,929/10,709 on test. Both CUA scorers commit zero in each missing-evidence group. This makes the P1 missing-evidence shortcut visible; it does not demonstrate learned semantic discrimination.

### Training and replay records

The seven fold models plus final model trained in 2,399.53 seconds (39m 59s) using a single fixed epoch per model. Maximum observed process RSS was 1,774,452,736 bytes (about 1.65 GiB); model weights are 2,976,700 bytes. Memory pressure remained at 64–68% free during training with no swap I/O. The per-epoch measurements, fold family declarations, and each fold's weight/config hashes are in the ignored `training-manifest.json`; SHA-256: `643a4bd8582a4ead26e086b9915b4dc487472bbe3ee94eea4444b611fd858d43`. The final weights SHA-256 is `0764e1f1aacb54cd5f179388fd10f5fa87db3801ac81cfe46b1119496cb9a9a5`; fixed scorer config SHA-256 is `e0675c64fbca92b28495f94929ba0a24b7f3200ac794c2ca74c75a72a4646b23`.

Each P2 run replayed to byte-identical correctness-bearing outputs; the replay manifests contain equal run-1 and run-2 SHA-256 values for all 13 correctness-bearing files (timing is kept separate). Domain-adapted replay manifest SHA-256: `f546b83ea282d1a11e90f48a1b38b10c21415c410241b813312d27d7d70a4a51`. Routing-reference replay manifest SHA-256: `b64c6527292e64de3de74eaebfde48fc76353aa78e7d21def96e23ea158c7052`. The policy and scorer manifest hashes are:

| Scorer                   | Scorer manifest SHA-256                                            | Frozen policy SHA-256                                              |
| ------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| CUA-S1 domain adapted    | `5fc2c23b14f272a32037283df5942cae69504af4d926eca9f7c8be828e8661ef` | `758f5317e03743ad07685e18876f43b8d1fcd8dd4ccad9f13932b4c0108cba23` |
| CUA-S1 routing reference | `1f95f01b4a90bae6e54c0ece5e72bbb1990ffaf72e760ad0229289ac3bee1536` | `f0c86099da4bbdb6c756b16774f5944644eebf477b93265d1ca32fff74b51db7` |
| TierA-rank-prior         | `bb4484018035470aa25b84ea8adbf16e08adb25fcebf32758a878d254a5fd64b` | `8be603caadd75b7fc23495bcddd81604596684e6a8bb134d28ff9c2e7113a3c5` |

All training weights, scorer outputs, policies, and detailed P2 reports are under the gitignored `evaluate/results/semantic-corpus/v1/` tree. The result tables above are summarized from those generated reports.

## Historical v1 limitations (superseded below)

- Seven repo families remain a small fitting pool. P2's family-aware LOFO certification improves on a two-family calibration-only rule, but it cannot make repository-clustered requests independent.
- The fixed byte encoder truncates beyond its 512-byte context and 96-byte per-option limits. It sees P1's bounded syntax and evidence, not a compiler or LSP result.
- The BCE targets teach option evidence and the stated UNKNOWN/VERIFY rule; they do not establish that the model's probability is calibrated outside the P2 calibration procedure.
- The prior routing checkpoint was trained on a different 13-label task; its zero-shot row measures compatibility and out-of-domain behavior, not a meaningful semantic baseline.
- Missing Tier A evidence and candidate-set completeness can be strong features. Interpret the P2 missing-evidence and candidate-count slices alongside overall rates; a good score on a slice is not evidence that the scorer can recover a target absent from the options.
- Training is fixed at one epoch to bound CPU time. The original two-epoch estimate exceeded the one-hour run bound at the measured first-fold rate, so the full fit was restarted before saving any checkpoint. No held-out-driven hyperparameter search or early stopping is performed, and P3 resource values are informal rather than the formal P5 envelope.
- CUA-S1 adds no certified LSP avoidance beyond tierA-rank-prior LOFO. Its learned scorer and the prior routing checkpoint cannot certify any of the three targets; the safe policy therefore verifies every request. The apparent 100% TierA precision comes from candidate-set completeness and single-candidate decisions, not multi-candidate discrimination: neither CUA model nor tierA-rank-prior commits on any multi-candidate held-out request.

## Corrected v2 results

The tables below are the authoritative P3 results. The v2 encoding decisions, 96-byte option limit, 1,024-byte context limit, and one-epoch training schedule were recorded before fitting. The train/calibration-only encoding audit passed before the first training process; no temporal/test data or OOF certification results were used to choose or revise the encoding or training settings. P2's LOFO certification policy was not changed.

### Fitting-pool diagnostics

`pool-diagnostics.mts` reads only P1 train/calibration state and label files plus the matching P2 train/calibration response and policy files. It does not open temporal/test state, labels, responses, or metrics. It records OOF top-1 on trusted, non-candidate-miss requests and ties at the top raw candidate score.

| Scorer                                 |  Multi-candidate top-1 | Eligible requests | Top-score ties |
| -------------------------------------- | ---------------------: | ----------------: | -------------: |
| TierA-rank-prior                       | 4,728 / 6,033 (78.37%) |             6,033 |          2,562 |
| CUA-S1 domain adapted, corrected v2    | 4,243 / 6,033 (70.33%) |             6,033 |              0 |
| CUA-S1 routing reference, corrected v2 | 1,300 / 6,033 (21.55%) |             6,033 |              1 |

The corrected encoding therefore improves adapted CUA-S1 multi-candidate top-1 over the defective v1 run (63.9%) and removes the widespread identical encodings, but it remains 8.04 percentage points below the rank-prior baseline. The model no longer ties at the top among the OOF multi-candidate requests; the rank-prior's many ties reflect its coarse rank-only scores.

At the whole-pool 0.990 target, TierA-rank-prior certifies threshold `1` with 7,214 exact commits. There are 10,335 trusted, non-miss single-candidate requests whose sole candidate is gold-positive, so its global threshold commits 7,214 of those possible single-candidate cases and none of the 6,088 multi-candidate requests. CUA-S1 has no certified threshold and commits none. This reproduces the stratification effect: multi-candidate errors constrain the global threshold while the rank prior leaves 3,121 otherwise possible single-candidate commits unused.

As a diagnostic only, we also refit LOFO certification on the multi-candidate pool subset. It is not used by P2's decision policy. No scorer certifies any target (0.990, 0.995, or 0.999) on that subset:

| Scorer                   | 0.990 status  | Best-pooled diagnostic threshold | Diagnostic exact / commits | Pooled CP lower bound |
| ------------------------ | ------------- | -------------------------------: | -------------------------: | --------------------: |
| TierA-rank-prior         | uncertifiable |                          0.72826 |              1,939 / 2,191 |                87.32% |
| CUA-S1 domain adapted    | uncertifiable |                          0.64343 |              1,315 / 1,581 |                81.55% |
| CUA-S1 routing reference | uncertifiable |                          0.10839 |                116 / 5,860 |                 1.69% |

The first two scorers' best-pooled thresholds fail both the pooled precision requirement and one or more family gates. The routing reference scores are particularly weak on this task. These thresholds are reported as pool diagnostics, never as allowed commit thresholds.

At the corrected CUA-S1 best-pooled whole-pool diagnostic threshold (`0.8366386554621849`), the family table is:

| Fitting family                                        |   Exact / commits | Exact-set precision | Family CP lower bound | 200-commit family gate |
| ----------------------------------------------------- | ----------------: | ------------------: | --------------------: | ---------------------- |
| 403errors/repomind                                    |         183 / 183 |             100.00% |                98.38% | below minimum          |
| Egonex-AI/Understand-Anything                         |     1,706 / 1,759 |              96.99% |                96.23% | fail                   |
| dyphn1/Docuvia                                        |     2,835 / 2,922 |              97.02% |                96.45% | fail                   |
| nestjs/nest                                           |             1 / 1 |             100.00% |                 5.00% | below minimum          |
| tirth8205/code-review-graph                           |           74 / 76 |              97.37% |                91.95% | below minimum          |
| trailhq/Graft                                         |         854 / 875 |              97.60% |                96.56% | fail                   |
| typescript-language-server/typescript-language-server |         697 / 817 |              85.31% |                83.12% | fail                   |
| **Pooled**                                            | **6,350 / 6,633** |          **95.73%** |            **95.30%** | —                      |

The four families at or above the 200-commit minimum fail the point-precision gate. The small families remain in the pooled CP bound even though they do not participate in the family gate.

### Frozen LOFO policy and held-out outcomes

P2 fit each policy on its permitted fitting data, wrote and hashed the frozen policy, then verified the temporal/test seals before scoring those splits. Exact-set precision is undefined when there are no commits. The calibration ECE is in-sample because the final calibrator is refit on all seven pool families. UNKNOWN and VERIFY both incur the LSP cost and write no edge; neither is counted as LSP avoidance.

| Scorer                      | Split                   | Certified threshold at 0.990 / 0.995 / 0.999  | Commits / trusted requests (avoidance) | Exact-set precision (95% Wilson CI) | False-safe | UNKNOWN |  VERIFY |    ECE |
| --------------------------- | ----------------------- | --------------------------------------------- | -------------------------------------: | ----------------------------------: | ---------: | ------: | ------: | -----: |
| CUA-S1 domain adapted v2    | Calibration (in-sample) | uncertifiable / uncertifiable / uncertifiable |                      0 / 2,966 (0.00%) |                                 n/a |          0 |   0.00% | 100.00% | 0.0603 |
| CUA-S1 domain adapted v2    | Temporal                | uncertifiable / uncertifiable / uncertifiable |                      0 / 2,694 (0.00%) |                                 n/a |          0 |   0.00% | 100.00% | 0.1100 |
| CUA-S1 domain adapted v2    | Test                    | uncertifiable / uncertifiable / uncertifiable |                     0 / 12,422 (0.00%) |                                 n/a |          0 |   0.00% | 100.00% | 0.1268 |
| CUA-S1 routing reference v2 | Calibration (in-sample) | uncertifiable / uncertifiable / uncertifiable |                      0 / 2,966 (0.00%) |                                 n/a |          0 |   0.00% | 100.00% | 0.0351 |
| CUA-S1 routing reference v2 | Temporal                | uncertifiable / uncertifiable / uncertifiable |                      0 / 2,694 (0.00%) |                                 n/a |          0 |   0.00% | 100.00% | 0.2837 |
| CUA-S1 routing reference v2 | Test                    | uncertifiable / uncertifiable / uncertifiable |                     0 / 12,422 (0.00%) |                                 n/a |          0 |   0.00% | 100.00% | 0.1724 |
| TierA-rank-prior            | Calibration (in-sample) | 1 / 1 / 1                                     |                 1,367 / 2,966 (46.09%) |                100.00% (99.72–100%) |          0 |   0.57% |  53.34% | 0.0262 |
| TierA-rank-prior            | Temporal                | 1 / 1 / 1                                     |                 2,113 / 2,694 (78.43%) |                100.00% (99.82–100%) |          0 |   0.26% |  21.31% | 0.0484 |
| TierA-rank-prior            | Test                    | 1 / 1 / 1                                     |                4,941 / 12,422 (39.78%) |                100.00% (99.92–100%) |          0 |   0.41% |  59.81% | 0.0123 |

P1 records 7 candidate misses in temporal and 65 in test; none were committed. CUA-S1 adds no certified LSP avoidance over TierA-rank-prior. The adapted scorer has better raw candidate ordering than the routing reference, but its LOFO policy remains uncertifiable, so the evaluator correctly routes every nonempty request to VERIFY_WITH_LSP.

On held-out multi-candidate requests, candidate-level top-1 is:

| Split    |       TierA-rank-prior |      CUA-S1 adapted v2 | Routing reference v2 |
| -------- | ---------------------: | ---------------------: | -------------------: |
| Temporal |     537 / 568 (94.54%) |     517 / 568 (91.02%) |    94 / 568 (16.55%) |
| Test     | 2,886 / 3,694 (78.13%) | 2,819 / 3,694 (76.31%) | 789 / 3,694 (21.36%) |

No scorer commits a multi-candidate held-out request at its frozen P2 policy. The denominators exclude candidate-miss and untrusted examples where applicable; the complete P2 reports retain the per-request denominators and confidence intervals.

### Held-out ambiguity and missing-evidence slices

The following top-1 rates use trusted, non-candidate-miss rows; sample counts include all requests tagged with the class. A class can contain fewer eligible top-1 rows than tagged requests. Class tags overlap, and small classes are noisy.

| Temporal ambiguity class                     | Requests | TierA top-1 | CUA-S1 v2 top-1 | Routing reference v2 top-1 |
| -------------------------------------------- | -------: | ----------: | --------------: | -------------------------: |
| Alias/renamed import                         |        7 |         n/a |             n/a |                        n/a |
| Barrel/re-export                             |      308 |     100.00% |         100.00% |                     57.14% |
| Fluent/chained call                          |       27 |      77.78% |          33.33% |                     18.52% |
| Generated wrapper/facade                     |       18 |      88.89% |          88.89% |                     33.33% |
| Other/plain                                  |    2,321 |      99.14% |          98.88% |                     86.82% |
| Overloads                                    |        3 |      66.67% |         100.00% |                     66.67% |
| Path alias                                   |        5 |      80.00% |          80.00% |                     80.00% |
| Unresolved receiver with small candidate set |       11 |      90.91% |          63.64% |                     45.45% |

| Test ambiguity class                         | Requests | TierA top-1 | CUA-S1 v2 top-1 | Routing reference v2 top-1 |
| -------------------------------------------- | -------: | ----------: | --------------: | -------------------------: |
| Alias/renamed import                         |       63 |         n/a |             n/a |                        n/a |
| Barrel/re-export                             |    1,535 |      94.10% |          70.95% |                     50.16% |
| Fluent/chained call                          |    1,248 |      96.96% |          94.39% |                     55.05% |
| Generated wrapper/facade                     |      284 |      98.59% |          97.54% |                     89.08% |
| Generic factory                              |       15 |     100.00% |         100.00% |                    100.00% |
| Other/plain                                  |    5,818 |      96.46% |          96.66% |                     80.40% |
| Overloads                                    |       19 |     100.00% |          78.95% |                     78.95% |
| Path alias                                   |    4,471 |      87.80% |          87.50% |                     77.85% |
| Unresolved receiver with small candidate set |       73 |      75.34% |          32.88% |                     28.77% |

The ambiguous-class differences are most visible on barrel/re-export and unresolved-receiver slices, where v2 CUA remains below the rank prior. P2 has zero held-out examples for DI/registry lookup, computed-but-bounded import, framework convention, and runtime string token, so no conclusion is possible for those classes.

| Split    | Missing-evidence slice | Requests | TierA top-1 | CUA-S1 v2 top-1 | Routing reference v2 top-1 | TierA commits | CUA/reference commits |
| -------- | ---------------------- | -------: | ----------: | --------------: | -------------------------: | ------------: | --------------------: |
| Temporal | Has missing evidence   |      244 |      90.16% |          82.38% |                     13.93% |             4 |                 0 / 0 |
| Temporal | No missing evidence    |    2,450 |      99.71% |          99.67% |                     89.19% |         2,109 |                 0 / 0 |
| Test     | Has missing evidence   |    1,713 |      93.28% |          70.39% |                     18.57% |            12 |                 0 / 0 |
| Test     | No missing evidence    |   10,709 |      93.49% |          96.54% |                     85.81% |         4,929 |                 0 / 0 |

P1 missing-evidence remains a strong feature risk. CUA's missing-evidence top-1 is much lower than its no-missing-evidence score, especially on test. This is a descriptive slice and was not used to tune the model or certify a threshold.

### Training logs, artifacts, and replay hashes

The corrected v2 nested-LOFO run trained seven family-excluded models and one final all-family model, one fixed epoch each. Total training time was 2,543.425 seconds. Peak training-process RSS was 2,120,515,584 bytes (about 1.97 GiB); final model plus checkpoint config was 3,238,845 bytes. During the run, system-wide free memory remained 69–70% and swap I/O stayed at zero. Batch loss and RSS were emitted every 250 batches; the table records the per-epoch diagnostic emitted at completion. Train/calibration positive top-1 is in-sample fit diagnostics, not OOF evaluation.

| Excluded family (or final model)                      | Examples | Epoch seconds | Mean batch BCE | Train positive top-1 | Calibration positive top-1 |
| ----------------------------------------------------- | -------: | ------------: | -------------: | -------------------: | -------------------------: |
| 403errors/repomind                                    |   15,189 |       341.784 |        0.10261 |               94.18% |                     97.44% |
| Egonex-AI/Understand-Anything                         |   14,637 |       322.250 |        0.11660 |               94.04% |                     97.68% |
| dyphn1/Docuvia                                        |   12,786 |       287.820 |        0.11423 |               92.31% |                     97.20% |
| nestjs/nest                                           |    8,462 |       160.175 |        0.11281 |               97.53% |                     97.20% |
| tirth8205/code-review-graph                           |   16,319 |       363.703 |        0.10351 |               94.14% |                     97.47% |
| trailhq/Graft                                         |   15,508 |       351.881 |        0.10786 |               93.62% |                     97.51% |
| typescript-language-server/typescript-language-server |   15,475 |       349.992 |        0.10759 |               94.09% |                     96.93% |
| Final model, all seven families                       |   16,396 |       365.683 |        0.10421 |               94.30% |                     97.34% |

The corrected audit, model manifests, weights, policies, responses, and detailed metrics are in the gitignored `evaluate/results/semantic-corpus/v1/` tree. Key hashes:

| Artifact                                 | SHA-256                                                            |
| ---------------------------------------- | ------------------------------------------------------------------ |
| Pool-only encoding audit                 | `3ce9b7dd6b51898c391d24309b1ed7ea43bde1276aaf5df586b3e48462bd31a`  |
| Training manifest                        | `49fb36e1c4c83f804f6385bce4e679c730f554b1e8dc44947082b0dfa0bc1f8c` |
| Scorer config                            | `8dadda8211d5d6e14a093e24db203130100e24bed96e16e00f39ff4b768a21c4` |
| Final model weights                      | `fb30047adb6f6cefa070e5d694afde76e450a4c8a8a2a118c6d8f210e0cf6e05` |
| Adapted CUA scorer manifest              | `500058b31b2ab57cdaea43e49eec8753b53227b22536b7d28c037a3f9fb82aa0` |
| Adapted CUA frozen policy                | `4f5ac35bf7176f7591c3b4de92c4ff1f306a4ddf42f25c4d81dee92fb5dc8140` |
| Adapted CUA replay-hashes manifest       | `297b17bef1a798a55b315e138d76b531cc67a429452c65ffd8024c6da40dc2f1` |
| Routing-reference scorer manifest        | `61e2df2bd6b353786918756d68b54421433b72c1f1a31fffc67172856dd6968e` |
| Routing-reference frozen policy          | `aa2d53d6ffa2a870902ae5ac0999d31ada894ff4670a1279c9f6bd3ff7b5dd03` |
| Routing-reference replay-hashes manifest | `06a7f135446999c27b7033c7b52a12d76a26d4588ab7b047f3662d2ff7b921f0` |
| Pool-only stratified diagnostics         | `ae4d17c7282e09bec7315dae18e3b198d16aaba2d5712c3b1dfcad59ecd3bbbc` |

Both P2 runs report `byteIdentical: true`; each replay manifest contains identical SHA-256 sets for all 13 correctness-bearing files, with timing kept in the separate non-hashed timing file. The LOFO selected policy and seal hashes are also recorded in each generated report.

### Corrected v2 limitations

- LOFO still has only seven pool repo families, with two smaller calibration families. The family gate and pooled request-level CP calculation do not eliminate repository clustering.
- CUA-S1 remains uncertifiable at all three precision targets, so this run adds no certified LSP avoidance beyond the TierA rank prior. OOF multi-candidate top-1 is below the rank prior even after the identity-preserving encoding fix.
- The model trains for one epoch on a small byte-level architecture. The in-sample train/calibration diagnostics are not independent validation; do not interpret them as generalization evidence.
- Missing evidence strongly separates top-1 results. P1's missing-evidence pattern can act as a shortcut feature, and the test missing-evidence slice is small relative to the no-missing slice.
- Ambiguity tags overlap; several held-out classes are absent or have fewer than 20 samples. Their percentages have wide uncertainty and do not support strong class-specific conclusions.
- The prior routing checkpoint is an out-of-domain 13-label model. Its corrected-v2 row is useful as a compatibility floor, but it is not a trained semantic baseline.
- The P2 policy remains an offline report/evaluation mechanism only. Nothing in this work changes production routing or writes graph edges.
