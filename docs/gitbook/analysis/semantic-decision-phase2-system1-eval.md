# Semantic decision Phase 2: System-1 offline evaluation

Phase 2 evaluates the label-free P1 state records offline. It does not add a scorer to the product, change request routing, start a daemon, or write to the Docuvia graph. The scorer contract, calibration, policy, metrics, and testable external-process adapter live in `lib/core/src/semantic/system1/eval/`; corpus file access and orchestration live in `scripts/semantic-corpus/system1-eval.mts`.

The evaluator uses protocol `system1-eval-protocol/v2`. Temporal and test scores below are regression checks under v2, not fresh evidence: those held-out values were observed by earlier protocol runs.

## Scorer protocol

An in-process TypeScript scorer and an external command use the same request/response contract. A scorer receives batches of P1 **state records only**. The records contain the Phase 0 request/options and P1 syntax-derived ambiguity fields. The separate labels JSONL is joined only after scoring; it is never placed in a scorer input.

An in-process scorer implements `System1InProcessScorer`: it has a scorer ID/version and a `scoreState(state)` callback that returns the same response object (synchronously or asynchronously). The adapter catches callback failures as `status: "error"` and strictly validates the response before policy evaluation.

An external scorer is started once per batch. The evaluator writes one JSON state record per line to stdin and reads one JSON response per line from stdout. The response count and order must match that batch's input; a count mismatch makes every row in that batch `status: "error"`, and a wrong-position `requestId` makes that row an error. The command is run without a shell, from the repository root. A batch timeout, process error, nonzero exit, output overflow, or malformed JSONL becomes a non-`ok` response for the affected request (a batch-level process failure affects the whole batch). The adapter is in core so Vitest can exercise it with local fake Node scorers.

The response shape is:

```json
{
  "requestId": "system1:...",
  "status": "ok",
  "scoreKind": "raw",
  "scores": {
    "tierA:candidate-id": 0.73,
    "UNKNOWN": 0.12,
    "VERIFY_WITH_LSP": 0.05
  }
}
```

`scores` must contain every option ID exactly once and no other keys. Every value must be a finite number in `[0, 1]`. Scores are independent raw probabilities and are not required to sum to one. A wrong request ID, invalid status/score kind, missing/extra option, or invalid score normalizes to `status: "error"`. `timeout`, `error`, and `ood` have an empty score map. Every non-`ok` response takes the `VERIFY_WITH_LSP` action; it is never interpreted as a negative decision.

The evaluator records a scorer manifest with scorer ID/version, SHA-256 for the weights/config (or the deterministic baseline configuration), evaluator and runtime versions, command/arguments, batch size, timeout, and the scorer's training-family declaration. The canonical manifest bytes are hashed, and that hash is embedded in both policies and metrics.

For the default leave-one-family-out (LOFO) run, each pool response must add `foldFamily: "owner/repository"`. The evaluator checks that the response request ID matches its state row, each request appears exactly once, the fold family matches the request's normalized repository family, and the training manifest excludes that family. Learned scorer manifests use this shape:

```json
{
  "mode": "folded",
  "foldTrainingFamilies": {
    "owner/repo-a": ["owner/repo-b", "owner/repo-c"],
    "owner/repo-b": ["owner/repo-a", "owner/repo-c"],
    "owner/repo-c": ["owner/repo-a", "owner/repo-b"]
  },
  "heldOutTrainingFamilies": ["owner/repo-a", "owner/repo-b", "owner/repo-c"]
}
```

The actual fitting pool currently has seven families, so each LOFO training list must contain the other six and the held-out model must declare all seven. The family keys and lists are compared as sets after normalization; missing, duplicate, extra, or self-trained folds fail before calibration. An in-process reference baseline declares `{"mode":"no-training"}` and is valid for every fold. Temporal/test scoring uses the model trained on the full fitting pool; those rows do not carry an OOF fold assignment.

Run all deterministic baselines through the same final-evaluation path:

```bash
pnpm run eval:semantic:system1-eval
```

The evaluator defaults to `evaluate/results/semantic-corpus/v1/system1-dataset-v2/`. Pass
`--dataset-dir evaluate/results/semantic-corpus/v1/system1-dataset/` to evaluate the preserved v1
dataset explicitly. The output root follows the selected dataset directory: the versioned v2
dataset writes beside it under `system1-eval-v2/`, while the unversioned v1 dataset writes under
`system1-eval/`. Held-out seal validation accepts export schema versions 1 and 2; it still checks
the partition names, raw file hashes, and row counts before parsing temporal or test inputs.

To evaluate an external JSONL scorer:

```bash
pnpm run eval:semantic:system1-eval -- \
  --scorer-id local-model \
  --scorer-version 1 \
  --scorer-command python \
  --scorer-args-json '["path/to/scorer.py"]' \
  --scorer-runtime-json '{"python":"3.12.1","torch":"2.4.0"}' \
  --scorer-training-manifest-json '{"mode":"folded","foldTrainingFamilies":{...},"heldOutTrainingFamilies":[...]}' \
  --weights-config path/to/weights-or-config.json \
  --batch-size 64 \
  --batch-timeout-ms 30000
```

The command's arguments are passed directly; shell expansion is not performed. `--scorer-command` must be a bare `node`, `python` or `python3` (resolved through `PATH`), an absolute path to one of those interpreters, or an absolute executable inside the repository; anything else, a relative path, or a NUL byte is rejected and every row scores `error` without spawning. A finished, failed, overflowing or timed-out batch tears the child down completely: listeners removed, stdio destroyed, process group killed if still running, and the handle unref'd. `--scorer-runtime-json` is a nonempty JSON object of scorer runtime/package version strings and is required for external scorers; these appear with a `scorer.` prefix next to the evaluator's Node, V8, TypeScript, and pnpm versions in the manifest. `--scorer-training-manifest-json` is required and must declare either `{"mode":"no-training"}` or the complete folded plan above. Omitting `--weights-config` records the SHA-256 of a fixed no-config sentinel. The external command is responsible for reporting deterministic scores for the given state records and its declared version/config/training plan.

## Baseline scorers

- **`tierA-rank-prior`** maps Tier A ranks 0/1/2 to `0.90`/`0.55`/`0.30`, then divides by `1 + log2(max(candidateCount, 1))`. With candidates it assigns raw `UNKNOWN`/`VERIFY_WITH_LSP` scores `0.25`/`0.75`; with no candidates those scores are `0.80`/`0.10`.
- **`single-rank0`** gives a rank-0 option `0.99` only when exactly one rank-0 candidate exists; other candidates score `0.01`. With candidates, controls rank VERIFY above UNKNOWN: `0.01`/`0.20` when rank 0 is unique, otherwise `0.10`/`0.20`. With no candidate options, `UNKNOWN`/`VERIFY_WITH_LSP` score `0.80`/`0.20`.
- **`always-verify`** scores candidate options and `UNKNOWN` as `0`, and `VERIFY_WITH_LSP` as `1`.

The default certification mode is LOFO; pass `--certification-mode calibration-only` to select the legacy comparison output as the primary `policy.json`. Each mode computes and reports both certification policies so the report always compares calibration-only and LOFO thresholds. Each scorer/mode is run twice. Correctness-bearing files are SHA-256 hashed on both runs and compared byte-for-byte; timing is written separately and excluded from the hash set. Hash sets and the equality result are recorded in `replay-hashes.json`.

## Calibration and frozen request policy

The fitting pool is exactly `train + calibration`; train examples may inform LOFO thresholds but are never used by the legacy calibration-only threshold rule. Temporal and test are held-out evaluation splits and never enter a calibrator, threshold scan, or family fold. The loader exposes only train/calibration paths to policy fitting. In the pinned v1 corpus, evaluation-only license rows appear in both temporal and test; both remain sealed and are kept outside the fitting pool.

The deterministic calibrator is pool-adjacent-violators isotonic regression (`isotonic-pava-v1`): candidate raw scores are grouped by equal value, ordered ascending, and adjacent blocks are pooled until empirical positive rates are nondecreasing. A map without both positive and negative candidate observations is marked unfitted and raw scores pass through unchanged. Only trusted, non-candidate-miss rows with an `ok` response contribute candidate outcomes to a map.

For the default LOFO policy, families are normalized to `owner/repository` and sorted deterministically. One fold is created per family. The fold calibrator is fit on trusted train+calibration candidate outcomes from the other families, then scores only requests from its excluded family. The evaluator verifies that every pool row has exactly one OOF response with the matching `foldFamily` and that a learned model's declared fold training set is exactly the other families. The final policy calibrator is then refit on all seven pool families.

For each exact-set precision target (`0.990`, `0.995`, `0.999`), LOFO considers observed calibrated OOF candidate scores from least strict to most strict, grouping tied scores. The independent unit for certification is the C-06 duplicate group: the SHA-256 of the whitespace-normalized ±2-line window plus callee. The evaluator joins `source.duplicateGroup` from the corpus manifest by the stable request ID; this metadata stays outside model state. It records the manifest's dataset-relative path and SHA-256 of its exact bytes in both frozen policies and `metrics.json`. The reader hashes the bytes before parsing any duplicate-group IDs and, for held-out rows, verifies the path and hash against the frozen policy before reading them. The source-only reader extracts pool group IDs before fitting and held-out group IDs only after the policy is frozen and each held-out seal has been verified. It does not parse oracle, review, or checker fields from the corpus manifest.

A committed duplicate group is exact only when every committed row in that group has an exact accepted `targetId` set. LOFO certifies only when (a) the pooled one-sided 95% Clopper–Pearson lower bound over committed groups reaches the target and (b) every repository family with at least `MIN_FAMILY_COMMITS = 200` committed groups has group-level point precision at or above the target. Families below 200 groups are reported but do not gate condition (b); their groups remain in the pooled bound. Per-family CP bounds and the worst-family bound are diagnostics, not extra gates. The same group-level counting is used by calibration-only certification. Row-level counts and the former row-level certified threshold are retained as labelled comparisons; neither affects v2 decisions. If no threshold passes, the target is `uncertifiable` and the policy action is `VERIFY_WITH_LSP`.

For zero-error samples, the minimum independent commit counts for the one-sided 95% CP lower bound are 299 at 0.990, 598 at 0.995, and 2,995 at 0.999. The policy and report put these beside observed group commits and mark insufficient zero-error support.

For an LOFO threshold record, `calibrationCommitCount`, `calibrationExactSetCount`, and `lowerBound` describe duplicate groups; separate `calibrationRow*` fields preserve request-row counts. Each family table reports both group and row counts. Each table has a `diagnosticKind`: `certified` is the selected certified threshold; for an uncertifiable target, `best-pooled-lower-bound` is the threshold with the highest pooled group CP lower bound (ties prefer more groups), `strictest` is the maximum-bound threshold with the fewest groups (remaining ties prefer the higher threshold), and `least-strict` is the lowest observed threshold retained as an explicitly labelled extra. Uncertifiable targets show all three diagnostic tables, with the best-pooled table as the primary table; none of these diagnostics changes the policy action.

`calibration-only` remains available as a comparison: it fits its isotonic map and certifies its threshold on in-sample calibration rows alone using the pooled Clopper–Pearson rule. LOFO is the default. The report includes both mode thresholds, held-out results, and LOFO's per-family OOF table for every target.

Before reading temporal or test state/labels, the evaluator writes and verifies `policy.json` plus its SHA-256 sidecar and also writes/verifies the comparison policy and hash. The selected mode's policy is `policy.json`; the other mode is in `comparison-policy.json`. Both hashes are frozen before either sealed split is opened, and neither policy file is rewritten afterward. The source-only manifest join reads a held-out duplicate group only after that split's seal and the frozen policy have been verified.

The calibrator uses a conservative floor map: a raw score maps to the last isotonic block whose minimum score is at most that raw score. Scores in gaps between observed blocks use the lower block, and scores below observed support use the lowest block. This avoids rounding an unseen gap upward into a more confident calibration block.

The request policy is:

1. A non-`ok` response or an uncertifiable precision target yields `VERIFY_WITH_LSP`.
2. Otherwise, `COMMIT` includes **all** Tier A candidates whose calibrated score meets the threshold. It never introduces an option outside the P1 candidate set.
3. If no candidate meets the threshold and the P1 candidate set is nonempty, choose `VERIFY_WITH_LSP` regardless of the scorer's control scores. `UNKNOWN` is available only when the candidate set is empty; there it is chosen only when its raw score is strictly greater than the raw `VERIFY_WITH_LSP` score. A tie or missing control score yields `VERIFY_WITH_LSP`.

`UNKNOWN` means the available Tier A evidence does not support committing to a target; it does not assert that no dependency exists. `VERIFY_WITH_LSP` requests authoritative follow-up. A timeout, error, or OOD status is always `VERIFY_WITH_LSP`, not `UNKNOWN` and not a negative. Both UNKNOWN and VERIFY incur LSP cost and write no edge, so neither action counts as avoided LSP work.

## Sealed access and outputs

`pnpm run eval:semantic:system1-eval` invokes the script with explicit `--final-evaluation` mode. It reads and scores train and calibration first, constructs both policies, freezes their hashes, then evaluates temporal and test. Temporal and test each have a separate accessor: after checking both persisted policy hashes, it reads the corresponding P1 seal manifest, hashes the raw state and labels bytes, checks both SHA-256 values and row counts against the seal, and only then parses those files. A seal mismatch aborts evaluation. No held-out rows enter calibration or threshold selection.

For each scorer and selected certification mode the default v2 dataset evaluation is under `evaluate/results/semantic-corpus/v1/system1-eval-v2/<scorerId>/<mode>/` (gitignored):

- `scorer-manifest.json` and `scorer-manifest.sha256`;
- frozen `policy.json` and `policy.sha256`;
- frozen comparison `comparison-policy.json` and `comparison-policy.sha256`;
- one state-only response JSONL per split;
- `metrics.json`, label-aware per-split metrics, duplicate-group accounting, and verified seal references for the selected policy plus both certification modes;
- per-target accounting funnels in `metrics.json` and `report.md`, with row and duplicate-group counts for raw corpus, export exclusions and untrusted labels by reason, post-exclusion/trusted counts, eligible nonempty candidate sets, candidate-miss and model-eligible side counts, empty-set candidate misses, commits, and exact outcomes;
- a per-split `repoFamilyBreakdown` in `metrics.json`, with row and duplicate-group commit rates and exact-set precision (including intervals) for each family and target;
- Brier scores and fixed-bin ECE/reliability values labelled with their measurement split, plus risk-coverage curves for the OOF pool and held-out splits;
- `slices.json`, per-slice metrics;
- `report.md`, calibration-only vs LOFO threshold/held-out comparison rows, LOFO per-family OOF tables, and slice tables;
- `replay-hashes.json`, per-file hashes for both runs; and
- `timing.json`, which is deliberately outside the deterministic hash set.

## Metric definitions and denominators

Labels are trusted only when review status is `confirmed`, oracle status is `resolved`, the positive set is nonempty, and positive/negative target IDs do not conflict. Label conflict takes precedence, followed by review-not-confirmed, oracle-not-resolved, and empty-positive-set. Every excluded row is counted by its first applicable reason. Untrusted rows are excluded from calibration, policy certification, precision, and other label-dependent metric denominators.

- **Commit / LSP avoidance (primary):** committed requests divided by trusted requests. Both UNKNOWN and VERIFY requests remain in this denominator as non-avoided requests because they incur LSP cost and write no edge. The report presents commit rate and LSP avoidance as the same rate, per the #553 comparison contract.
- **Request exact-set precision:** commits whose accepted target-ID set exactly matches all gold positive IDs divided by trusted commits. Its interval is a two-sided 95% Wilson interval.
- **Duplicate-group precision (certification unit):** distinct duplicate groups with at least one trusted committed row whose every committed row is exact, divided by distinct trusted groups with a commit. Group commit/avoidance and group precision include two-sided 95% Wilson intervals. Certification uses the one-sided 95% Clopper–Pearson lower bound over these groups. A group spanning families counts once in the pooled bound; each family gate counts that group once for each family with a committed row, using the group's conservative all-row outcome.
- **False-safe rate:** committed requests whose accepted set is not exactly the gold set divided by trusted requests. Candidate-miss requests that are committed count as false-safe. `falseSafeAmongCommits` uses trusted commits as the denominator.
- **UNKNOWN, VERIFY, and abstention:** each action divided by trusted requests; abstention is `UNKNOWN + VERIFY_WITH_LSP`.
- **Accepted-decision precision:** accepted candidate options with a gold-positive target divided by all accepted candidate options.
- **Gold-positive coverage:** gold-positive target IDs accepted divided by gold-positive target IDs in trusted, non-candidate-miss requests.
- **Candidate false-positive rate:** accepted negative candidate options divided by all negative Tier A candidate options in trusted, non-candidate-miss requests.
- **Top-1 candidate-selection accuracy:** highest raw-scored candidate target is gold-positive, divided by trusted, non-candidate-miss requests with an `ok` response and at least one candidate. P1 option order breaks score ties.
- **ECE and reliability:** 15 fixed equal-width bins over calibrated candidate scores, with the measured split recorded in every metric object and table. Only trusted, non-candidate-miss rows with `ok` responses enter; ECE is the candidate-count-weighted absolute difference between mean calibrated confidence and observed positive rate. Empty bins remain in the reliability table. Reliability observed-rate intervals use Wilson 95% intervals.
- **Brier score:** mean squared error between calibrated candidate probabilities and binary positive/negative labels over the same trusted, non-candidate-miss observations used for ECE.
- **Risk-coverage:** for each observed calibrated candidate threshold, reports row coverage/precision and duplicate-group coverage/precision. LOFO train+calibration curves use each request's out-of-family calibrator; temporal/test curves use the frozen full-pool map.
- **Confidence intervals:** every reported row- and group-level rate includes a two-sided 95% Wilson interval; certification uses the one-sided 95% Clopper–Pearson lower bound over duplicate groups. Counts, ECE, and Brier are not rates and have no rate interval.
- **Candidate misses:** reported separately as Tier A failures. Misses among nonempty candidate sets are counted as a side branch from the eligible stage and are omitted from candidate-level and calibration-fit outcomes because the scorer had no gold candidate option. Misses with an empty candidate set are reported in a separate side count because they are outside the nonempty-candidate eligibility stage. Only eligible non-miss requests continue through the model-eligible, committed, and exact stages. A committed miss still counts as false-safe in request-level metrics and lowers policy certification precision. The funnel lists all candidate-miss commits separately.

The report does not use aggregate F1 as a headline. `metrics.json` reports denominators and intervals alongside rates so small slices and zero-denominator metrics remain explicit.

Under LOFO, train and calibration decisions, commit rates, exact-set precision, ECE, and Brier use each request's fold-specific out-of-fold calibrator and are labelled `out-of-fold`. The final calibrator is refit on all seven pool families for held-out scoring, but it is not used to label or score the LOFO train/calibration rows. Under calibration-only, calibration decisions and calibration metrics are labelled `in-sample` because those rows fit and certify its map; train rows are not used by that policy. Temporal/test values are regression checks under protocol v2, not fresh evidence, because those held-out numbers were already seen. Held-out headline rows mark the group-level result `NO` when its exact-set precision point estimate or Wilson lower bound is below the certified target; the old row-level comparison is shown in a separate column.

## Limitations

- Calibration contains only two repository families: `Egonex-AI/Understand-Anything` (1,759 requests) and `403errors/repomind` (1,207 requests). All splits are repo-disjoint, so calibration and held-out behavior can vary by repository family; `metrics.json` exposes exact-set precision and commit rate by family for every split.
- LOFO raises the fitting/certification pool to seven repository families, but seven clusters are still few. Duplicate groups remove repeated-window rows from the CP unit, while distinct groups remain clustered within repositories; the pooled CP bound can still overstate cross-repository certainty. Per-family group-level point precision gates reduce but do not remove that limitation.
- `MIN_FAMILY_COMMITS = 200` is a deterministic support cutoff. Families below it are visible and included in pooled certification but cannot fail the family point-precision gate; the choice trades gate stability for the risk of leaving small families unchecked.
- The least-strict certified threshold is selected on the same OOF scores used to calculate the LOFO certification bounds. This selection reuse makes the reported bound optimistic, despite the request-family folds. The final calibrator is refit on the full pool, so its score map can differ from the fold maps used for certification.
- For the tierA rank prior, LOFO threshold `1` commits only single-candidate rank-0/1 requests. Its precision therefore reflects candidate-set completeness, not meaningful discrimination among competing candidates.
- OOF calibrated values are fold-specific. For coarse scorers, a held-out family's quality can affect the fold map inversely with its score distribution, so the pooled threshold scan partly selects families as well as score cutoffs.
- Commit-everything diagnostic rows are not meaningful for scorers such as `always-verify`; they are retained only as explicitly labelled diagnostics and do not imply that the scorer would commit under its certified policy.
- For external learned scorers, the evaluator verifies the declared family plan and the `foldFamily` response metadata, but cannot independently prove which data the supplied weights actually used for training. That part of the protocol is a scorer-manifest attestation.
- The legacy calibration-only comparison has only two repository families and retains the stronger clustering limitation of the original P2 rule.
- P1 missing-evidence status is available from syntax and Tier A source reads and can be a strong scorer feature. Missingness differs between candidate ranks/gold status in the corpus, so this is a potential dataset shortcut and should be examined by the missing-evidence slices before interpreting generalization.

## Slice definitions

Slices are multi-label where appropriate and retain not-detected outcomes:

- `ambiguity-class`: every syntax/Tier-A class tag present on a P1 state record;
- `not-detected-class`: every P1 class detector recorded as not detected;
- `repo-family`: normalized owner/repository (for example, `acme/widget`), matching the LOFO cluster key;
- `candidate-set-size`: `0`, `1`, `2-4`, `5-8`, `9-16`, `17-32`, or `33+` candidates; and
- `missing-evidence`: `has-missing-evidence` when any candidate has P1 `evidenceStatus: "missing"`, otherwise `no-missing-evidence`.

Every slice carries sample/trusted/candidate-miss counts, split-labelled ECE/Brier/reliability, row and duplicate-group request metrics, and candidate metrics for each precision target. Candidate-miss samples remain visible in request-level slices while being excluded from candidate-level denominators as described above.
