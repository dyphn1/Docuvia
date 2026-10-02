# Semantic decision Phase 4: Laya capability baseline

P4 evaluates the locally available Laya/mmBERT-base encoder as an offline capability baseline through the unchanged P2 external-scorer protocol. It does not add inference to Docuvia behavior, change routing, start a daemon, or write model edges to the knowledge graph. Adapter and training code live in `scripts/semantic-corpus/system1-models/laya/`; weights and request-level diagnostics remain under the gitignored `evaluate/results/semantic-corpus/v1/` tree.

Temporal and test values below are regression checks under the existing P2 protocol. They are sealed from fitting, calibration, and threshold selection, but were seen in earlier work and do not constitute fresh evidence. Candidate-generation misses remain Tier A failures and receive no model credit.

## Encoder, state, and option representation

The scorer accepts the P1 state JSONL shape and reuses CUA-S1's `encode_example`, repository-family parsing, request-ID parsing, and forbidden-key guard through an explicit import bridge. It never reads label files at inference. Candidate options retain their P1 order and stable option IDs; `UNKNOWN` and `VERIFY_WITH_LSP` remain separate protocol options. Each context-option pair is scored independently and receives a sigmoid probability. The adapter returns those probabilities directly as P2 `scoreKind: "raw"`; it applies no softmax, argmax, candidate-route multiplication, or B-4 coverage router.

The supplied local checkpoint was the previously trained `~/runs/laya-s1-full/model/` mmBERT-base encoder. Its harness-intent decision head is discarded. The frozen encoder produces mean-pooled pair features from the state context and option text. The tokenizer uses `truncation="only_first"` with a 256-token maximum, preserving each option while bounding context length. One small binary head is trained for each held-out-family fold and for the final model.

## Independent-event labels and masks

P4 shares CUA-S1's canonical trusted-label check and candidate-target helper. For each candidate event, target 1 is a confirmed positive target ID; target 0 is assigned only to an explicit `negativeTargetIds` entry. Every other non-positive candidate has zero loss weight. Untrusted rows have zero candidate and control weights. Protocol controls use the CUA-S1 v1 independent BCE labels in a separate control-loss term, so control events never contribute to candidate BCE. Top-1 is reported as a diagnostic only.

The training preflight read only the train and calibration state/label pairs:

| Split       |   Requests | Trusted / untrusted | Candidate options | Positive events | Confirmed negative events | Masked candidate events | Control events (total / trusted-weighted) |
| ----------- | ---------: | ------------------: | ----------------: | --------------: | ------------------------: | ----------------------: | ----------------------------------------: |
| Train       |     13,489 |         13,430 / 59 |            56,281 |          13,430 |                     3,292 |                  39,559 |                           26,978 / 26,860 |
| Calibration |      2,966 |           2,966 / 0 |            10,274 |           2,949 |                       301 |                   7,024 |                             5,932 / 5,932 |
| **Total**   | **16,455** |     **16,396 / 59** |        **66,555** |      **16,379** |                 **3,593** |              **46,583** |                       **32,910 / 32,792** |

The control target is 1 for `UNKNOWN` when no candidate matches the positive set, and 1 for `VERIFY_WITH_LSP` when `candidateMiss` is true or no candidate matches the positive set. These labels do not modify candidate targets or candidate masks.

## Nested LOFO and fixed configuration

Seven pool-family models each exclude their held-out repository family and emit that family's OOF responses. A separate final model trains on all seven pool families for temporal/test regression scoring. Fold membership is asserted before model loading and before each head fit. The training process reads no temporal or test state or labels.

| Setting                | Value                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------- |
| Encoder                | Laya Agent ModernBERT/mmBERT-base, local checkpoint; encoder frozen                   |
| Adaptation head        | Independent `LayerNorm → Linear(768,256) → GELU → Dropout(0.1) → Linear(256,1)`       |
| Tokenization           | Local Laya tokenizer; context-first pair, `only_first` truncation; maximum 256 tokens |
| Objective              | Per-option weighted `BCEWithLogitsLoss`; candidate and control masks are separate     |
| Optimizer              | AdamW, learning rate 0.001, weight decay 0.0001; gradient norm clipped at 1.0         |
| Epochs / batch sizes   | One fixed epoch; encoder batch 4; head batch 128                                      |
| Device / thread limits | CPU; four PyTorch/BLAS threads; one inter-op thread                                   |
| Random seeds           | Base seed 553; fold offset 1,009; deterministic algorithms enabled                    |
| Held-out tuning        | None; no validation-based early stopping, threshold tuning, or sealed-split fitting   |

The smoke run loaded the frozen encoder and trained one fold head on 1,036 real option events from 174 train requests. It took 35.03 seconds, peaked at 2,784,034,816 bytes RSS, and observed a 69% minimum system-free-memory reading. Its frozen-head nested-run projection was 3,093.301 seconds (0.8593 hours). The actual nested run completed in 3,132.032 seconds (52m12s), 38.731 seconds above projection, with a 3,010,641,920-byte peak RSS and 69% minimum free memory. It stayed below the 6 GiB process cap throughout.

The smoke also bounded the full-fine-tune memory decision. The measured encoder-process peak plus one float32 gradient and two float32 Adam tensors per encoder parameter is 6,467,310,592 bytes, above the 6,442,450,944-byte (6 GiB) process cap before saved activations. The selected configuration therefore freezes the encoder and trains independent heads. The model-based full-fine-tune floor separately includes 4,980,240,384 bytes and excludes Python/tokenizer overhead, allocator overhead, and attention/feed-forward saved activations.

## OOF diagnostics and cross-family transfer

`diagnostics-oof.json` records one independent probability per candidate/control option, fold provenance, mask weights, and diagnostic top-1. These diagnostics use train/calibration only. `router_feasibility.py` fits a separate B-5-style logistic probe using only OOF scores and Tier A state facts. It evaluates Laya top-1 and Tier A rank-0 as distinct commit choices, with family-held-out router folds and in-sample upper-bound probes. Its row-level Clopper–Pearson prefix bound is optimistic because rows can share duplicate groups; no probe score is wired into P2 or the scorer.

The candidate component's weighted OOF Brier score is 0.159506; the trusted-control Brier score is 0.004588. Candidate top-1 remains a diagnostic, not a gate:

| Split       | Trusted top-1 exact / eligible | Multi-candidate top-1 exact / eligible | Trusted candidate misses |
| ----------- | -----------------------------: | -------------------------------------: | -----------------------: |
| Train       |       11,623 / 13,430 (86.56%) |                 3,645 / 5,449 (66.89%) |                       11 |
| Calibration |         2,774 / 2,966 (93.53%) |                     417 / 592 (70.44%) |                       17 |

The B-5-style router uses OOF candidate probabilities and Tier A state facts. Its largest row-level CP prefix results were:

| Commit target | Strongest in-sample prefix at .990 / .995 / .999 | LOFO prefix at .990 / .995 / .999 |
| ------------- | -----------------------------------------------: | --------------------------------: |
| Laya top-1    |                        2,472 / 0 / 0 (λ = 0.001) |                         0 / 0 / 0 |
| Tier A rank-0 |                   3,757 / 2,517 / 0 (λ = 0.0001) |                         0 / 0 / 0 |

No regularization strength produced a certifiable LOFO prefix for either commit target at any threshold. The in-sample rows are overfit upper bounds; the router is not used by P2 or the scorer. The check is row-level, so its Clopper–Pearson bound is more optimistic than duplicate-group certification and is not a P2 certification result.

## P2 certification and held-out regression results

P2 runs with `scripts/semantic-corpus/system1-eval.mts` unchanged, on the v2 dataset. It repeats the unchanged replay check, duplicate-group accounting, LOFO certification, and temporal/test seal checks. The scoring subprocess receives only state records; it responds with per-option raw scores and the request's OOF family provenance. No temporal/test input is used for fitting, calibration, or threshold selection.

The external command is pinned to Python 3.12.13, `laya` 0.3.20, `transformers` 5.17.0, `torch` 2.14.0, and `safetensors` 0.8.0. It uses batches of 64 requests and a 60-second batch timeout. An opt-in `score-progress.jsonl` beside the run directory records each scorer load and completed batch with option-event counts, RSS, and free memory; these records do not enter scorer stdout or alter replay bytes. The two complete scorer passes took 6,821.156 s and 6,842.804 s (3 h 47 m 44 s combined).

The unchanged P2 evaluator completed LOFO certification, sealed temporal/test regression scoring, duplicate-group accounting, and replay. Its replay manifest reports `byteIdentical: true`; the frozen policy hash is `b80252d0c5a968692710cc0ca6400f457abf005829696b5aed315cf9fac262cb`. The run read the sealed partitions only for evaluation. These temporal/test values are regression checks because they were observed in earlier work.

The Laya LOFO diagnostic's best pooled prefix contains 420 independent duplicate groups, of which 417 are exact (441 rows, 438 exact); its duplicate-group Clopper–Pearson lower bound is 0.981643. It misses the .990 target, so the frozen policy routes every eligible request to `VERIFY_WITH_LSP` at all three precision targets. For context, CUA-S1 is also uncertifiable at all three targets. The deterministic Tier A rank prior certifies threshold `1` at each target.

| Split                   | Scorer                      |    Certified thresholds at .990 / .995 / .999 | Commits / trusted requests (LSP avoidance) | Exact committed sets |
| ----------------------- | --------------------------- | --------------------------------------------: | -----------------------------------------: | -------------------: |
| Train + calibration OOF | Laya                        | uncertifiable / uncertifiable / uncertifiable |                         0 / 16,396 (0.00%) |                  n/a |
| Train + calibration OOF | CUA-S1 independent-event-v2 | uncertifiable / uncertifiable / uncertifiable |                         0 / 16,396 (0.00%) |                  n/a |
| Train + calibration OOF | Tier A rank prior           |                                     1 / 1 / 1 |                    7,214 / 16,396 (44.00%) |        7,214 / 7,214 |
| Temporal regression     | Laya                        | uncertifiable / uncertifiable / uncertifiable |                          0 / 2,694 (0.00%) |                  n/a |
| Temporal regression     | CUA-S1 independent-event-v2 | uncertifiable / uncertifiable / uncertifiable |                          0 / 2,694 (0.00%) |                  n/a |
| Temporal regression     | Tier A rank prior           |                                     1 / 1 / 1 |                     2,113 / 2,694 (78.43%) |        2,113 / 2,113 |
| Test regression         | Laya                        | uncertifiable / uncertifiable / uncertifiable |                         0 / 12,422 (0.00%) |                  n/a |
| Test regression         | CUA-S1 independent-event-v2 | uncertifiable / uncertifiable / uncertifiable |                         0 / 12,422 (0.00%) |                  n/a |
| Test regression         | Tier A rank prior           |                                     1 / 1 / 1 |                    4,941 / 12,422 (39.78%) |        4,941 / 4,941 |

At the component-diagnostic level, Laya's OOF multi-candidate top-1 is 4,062/6,041 (67.24%), below CUA-S1's 69.7% and Tier A rank-0's 78.3%. Top-1 is diagnostic only; none of these figures changes P2 certification. Laya does not add any certified avoidance beyond Tier A.

## P5 resource envelope

The bounded P5 harness measured the CUA-S1 final checkpoint and Laya final head plus its frozen base encoder in separate sequential processes. Both received the same deterministic 32-request train-state sample (SHA-256 `e822e4c4169284c636a46a4d4388285f421df55a35d0b32a5fd3d319f527b247`); no labels were read. Current RSS comes from macOS `proc_pidinfo`; peak RSS comes from `resource.getrusage`. The CUA-S1 process cap was 3 GiB, the Laya cap was 6 GiB, and both used the 25% system-free-memory floor. The report JSON is at `evaluate/results/semantic-corpus/v1/system1-resource-envelope-v1/report.json`.

| Model                          |     Serving components on disk | RSS after load / incremental | Peak RSS / incremental over baseline | Cold load | 512 MiB peak-RSS label |
| ------------------------------ | -----------------------------: | ---------------------------: | -----------------------------------: | --------: | ---------------------: |
| CUA-S1 final                   |         3,239,695 B (3.09 MiB) |            270.94 / 4.63 MiB |              1,636.20 / 1,369.89 MiB |  0.0192 s |               **FAIL** |
| Laya final head + base encoder | 1,357,198,999 B (1,294.26 MiB) |      2,040.73 / 1,774.14 MiB |              2,654.55 / 2,387.95 MiB |  1.7999 s |               **FAIL** |

| Model                          | Idle CPU (one core) | Sustained CPU (one core) | Warm request latency p50 / p95 / p99 | Batch requests/s / options/s | 25-request RSS growth | Four-client shared-model requests/s / options/s |
| ------------------------------ | ------------------: | -----------------------: | -----------------------------------: | ---------------------------: | --------------------: | ----------------------------------------------: |
| CUA-S1 final                   |               0.33% |                  264.16% |              6.07 / 10.00 / 10.29 ms |               79.40 / 563.26 |                   0 B |                               273.21 / 1,570.96 |
| Laya final head + base encoder |               1.05% |                  212.72% |          105.01 / 737.50 / 848.86 ms |                 4.63 / 32.82 |              16,384 B |                                    7.01 / 40.29 |

Both models fail the hard serving ceiling on peak process RSS. CUA-S1's weights are small, but its measured process peak is 1.60 GiB; Laya's base encoder alone dominates its 1.26 GiB component footprint, and its peak is 2.59 GiB. Laya is capability-only and non-production under this resource envelope. Four concurrent clients shared a single loaded model instance in each measurement. The minimum free-memory readings were 70% for CUA-S1 and 69% for Laya; the 25% floor was not approached.

## Interpretation and limits

P4 is an offline capability test, not a production-serving proposal. The independent per-option objective avoids the known-mis-specified B-4 coverage target, but Laya remains uncertifiable at every threshold and does not outperform CUA-S1 on OOF multi-candidate top-1. The B-5-style router's in-sample prefixes do not transfer under family-held-out evaluation. Temporal and test tables are regression checks. P5 also rejects both serving processes under the 512 MiB peak-RSS ceiling; Laya remains capability-only.

## Sources

- Local checkpoint and runtime: `~/runs/laya-s1-full/model/`; Python 3.12, `laya` 0.3.20, `transformers` 5.17.0, `torch` 2.14.0.
- [Hugging Face ModernBERT documentation](https://huggingface.co/docs/transformers/main/model_doc/modernbert).
- [Hugging Face tokenizer documentation](https://huggingface.co/docs/transformers/main_classes/tokenizer).
