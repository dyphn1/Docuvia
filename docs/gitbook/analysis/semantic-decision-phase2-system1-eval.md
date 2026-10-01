# Semantic decision Phase 2: System-1 offline evaluation

Phase 2 evaluates the label-free P1 state records offline. It does not add a scorer to the product, change request routing, start a daemon, or write to the Docuvia graph. The scorer contract, calibration, policy, metrics, and testable external-process adapter live in `lib/core/src/semantic/system1/eval/`; corpus file access and orchestration live in `scripts/semantic-corpus/system1-eval.mts`.

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

The evaluator records a scorer manifest with scorer ID/version, SHA-256 for the weights/config (or the deterministic baseline configuration), evaluator and runtime versions, command/arguments, batch size, and timeout. The canonical manifest bytes are hashed, and that hash is embedded in the policy and metrics.

Run all deterministic baselines through the same final-evaluation path:

```bash
pnpm run eval:semantic:system1-eval
```

To evaluate an external JSONL scorer:

```bash
pnpm run eval:semantic:system1-eval -- \
  --scorer-id local-model \
  --scorer-version 1 \
  --scorer-command python \
  --scorer-args-json '["path/to/scorer.py"]' \
  --scorer-runtime-json '{"python":"3.12.1","torch":"2.4.0"}' \
  --weights-config path/to/weights-or-config.json \
  --batch-size 64 \
  --batch-timeout-ms 30000
```

The command's arguments are passed directly; shell expansion is not performed. `--scorer-runtime-json` is a nonempty JSON object of scorer runtime/package version strings and is required for external scorers; these appear with a `scorer.` prefix next to the evaluator's Node, V8, TypeScript, and pnpm versions in the manifest. Omitting `--weights-config` records the SHA-256 of a fixed no-config sentinel. The external command is responsible for reporting deterministic scores for the given state records and its declared version/config.

## Baseline scorers

- **`tierA-rank-prior`** maps Tier A ranks 0/1/2 to `0.90`/`0.55`/`0.30`, then divides by `1 + log2(max(candidateCount, 1))`. With candidates it assigns raw `UNKNOWN`/`VERIFY_WITH_LSP` scores `0.25`/`0.75`; with no candidates those scores are `0.80`/`0.10`.
- **`single-rank0`** gives a rank-0 option `0.99` only when exactly one rank-0 candidate exists; other candidates score `0.01`. With candidates, controls rank VERIFY above UNKNOWN: `0.01`/`0.20` when rank 0 is unique, otherwise `0.10`/`0.20`. With no candidate options, `UNKNOWN`/`VERIFY_WITH_LSP` score `0.80`/`0.20`.
- **`always-verify`** scores candidate options and `UNKNOWN` as `0`, and `VERIFY_WITH_LSP` as `1`.

Each scorer is run twice. Correctness-bearing files are SHA-256 hashed on both runs and compared byte-for-byte; timing is written separately and excluded from the hash set. Hash sets and the equality result are recorded in `replay-hashes.json`.

## Calibration and frozen request policy

Only trusted, non-candidate-miss `calibration` candidates with an `ok` scorer response fit the calibration map. The deterministic calibrator is pool-adjacent-violators isotonic regression (`isotonic-pava-v1`): candidate raw scores are grouped by equal value, ordered ascending, and adjacent blocks are pooled until empirical positive rates are nondecreasing. If the calibration set has no positive or no negative candidate outcomes, the map is marked unfitted and raw scores pass through unchanged.

Policy fitting accepts calibration examples only and throws if any train, temporal, or test example is passed to it. For each request-level exact-set precision target (`0.990`, `0.995`, `0.999`), the evaluator considers only calibrated candidate scores observed in calibration, from least strict (lowest observed numeric threshold) to most strict. It does not invent a zero threshold below observed score support. At each threshold it counts trusted calibration requests that accept at least one candidate. A request is correct only if the unique accepted `targetId` set exactly equals the full positive target set. A committed candidate-miss request is therefore a calibration failure. The threshold is certified only when the one-sided 95% Clopper–Pearson lower bound on this exact-set precision reaches the target. With no candidate threshold satisfying that bound, the target is `uncertifiable` and its policy action is `VERIFY_WITH_LSP`.

Before reading temporal or test state/labels, the evaluator writes `policy.json` and `policy.sha256`, then re-reads and verifies the policy bytes. `policy.json` is not rewritten afterward. This frozen hash is required by the held-out accessors and is recorded in metrics and the report.

The calibrator uses a conservative floor map: a raw score maps to the last isotonic block whose minimum score is at most that raw score. Scores in gaps between observed blocks use the lower block, and scores below observed support use the lowest block. This avoids rounding an unseen gap upward into a more confident calibration block.

The request policy is:

1. A non-`ok` response or an uncertifiable precision target yields `VERIFY_WITH_LSP`.
2. Otherwise, `COMMIT` includes **all** Tier A candidates whose calibrated score meets the threshold. It never introduces an option outside the P1 candidate set.
3. If no candidate meets the threshold and the P1 candidate set is nonempty, choose `VERIFY_WITH_LSP` regardless of the scorer's control scores. `UNKNOWN` is available only when the candidate set is empty; there it is chosen only when its raw score is strictly greater than the raw `VERIFY_WITH_LSP` score. A tie or missing control score yields `VERIFY_WITH_LSP`.

`UNKNOWN` means the available Tier A evidence does not support committing to a target; it does not assert that no dependency exists. `VERIFY_WITH_LSP` requests authoritative follow-up. A timeout, error, or OOD status is always `VERIFY_WITH_LSP`, not `UNKNOWN` and not a negative. Both UNKNOWN and VERIFY incur LSP cost and write no edge, so neither action counts as avoided LSP work.

## Sealed access and outputs

`pnpm run eval:semantic:system1-eval` invokes the script with explicit `--final-evaluation` mode. That mode reads and scores calibration, freezes the policy, then evaluates train, temporal, and test. Train is never read by policy fitting. Temporal and test each have a separate accessor: after checking the persisted policy hash, it reads the corresponding P1 seal manifest, hashes the raw state and labels bytes, checks both SHA-256 values and row counts against the seal, and only then parses those files. A seal mismatch aborts evaluation. No held-out rows enter calibration or threshold selection.

For each scorer the output is under `evaluate/results/semantic-corpus/v1/system1-eval/<scorerId>/` (gitignored):

- `scorer-manifest.json` and `scorer-manifest.sha256`;
- frozen `policy.json` and `policy.sha256`;
- one state-only response JSONL per split;
- `metrics.json`, label-aware per-split metrics and verified seal references;
- a per-split `repoFamilyBreakdown` in `metrics.json`, with trusted commit rate and exact-set precision (including intervals) for each family and target;
- `slices.json`, per-slice metrics;
- `report.md`, comparison rows for the precision targets and slice tables;
- `replay-hashes.json`, per-file hashes for both runs; and
- `timing.json`, which is deliberately outside the deterministic hash set.

## Metric definitions and denominators

Labels are trusted only when review status is `confirmed`, oracle status is `resolved`, the positive set is nonempty, and positive/negative target IDs do not conflict. Label conflict takes precedence, followed by review-not-confirmed, oracle-not-resolved, and empty-positive-set. Every excluded row is counted by its first applicable reason. Untrusted rows are excluded from calibration, policy certification, precision, and other label-dependent metric denominators.

- **Commit / LSP avoidance (primary):** committed requests divided by trusted requests. Both UNKNOWN and VERIFY requests remain in this denominator as non-avoided requests because they incur LSP cost and write no edge. The report presents commit rate and LSP avoidance as the same rate, per the #553 comparison contract.
- **Request exact-set precision:** commits whose accepted target-ID set exactly matches all gold positive IDs divided by trusted commits. Its interval is a two-sided 95% Wilson interval.
- **False-safe rate:** committed requests whose accepted set is not exactly the gold set divided by trusted requests. Candidate-miss requests that are committed count as false-safe. `falseSafeAmongCommits` uses trusted commits as the denominator.
- **UNKNOWN, VERIFY, and abstention:** each action divided by trusted requests; abstention is `UNKNOWN + VERIFY_WITH_LSP`.
- **Accepted-decision precision:** accepted candidate options with a gold-positive target divided by all accepted candidate options.
- **Gold-positive coverage:** gold-positive target IDs accepted divided by gold-positive target IDs in trusted, non-candidate-miss requests.
- **Candidate false-positive rate:** accepted negative candidate options divided by all negative Tier A candidate options in trusted, non-candidate-miss requests.
- **Top-1 candidate-selection accuracy:** highest raw-scored candidate target is gold-positive, divided by trusted, non-candidate-miss requests with an `ok` response and at least one candidate. P1 option order breaks score ties.
- **ECE and reliability:** 15 fixed equal-width bins over calibrated candidate scores. Only trusted, non-candidate-miss rows with `ok` responses enter; ECE is the candidate-count-weighted absolute difference between mean calibrated confidence and observed positive rate. Empty bins remain in the reliability table. Reliability observed-rate intervals use Wilson 95% intervals.
- **Confidence intervals:** every reported rate includes a two-sided 95% Wilson interval; calibration certification uses the one-sided 95% Clopper–Pearson lower bound. Counts and ECE are not rates and have no rate interval.
- **Candidate misses:** reported separately as Tier A failures. They are omitted from candidate-level and calibration-fit outcomes because the scorer had no gold candidate option. A committed miss still counts as false-safe in request-level metrics and lowers policy certification precision.

The report does not use aggregate F1 as a headline. `metrics.json` reports denominators and intervals alongside rates so small slices and zero-denominator metrics remain explicit.

Calibration-split ECE is an in-sample diagnostic because the isotonic map was fit on that split; the headline report marks this explicitly. Temporal/test ECE are held-out diagnostics and should be used to judge generalization. Held-out headline rows say `NO` when either the exact-set precision point estimate or its Wilson lower bound is below the certified target; calibration rows are marked `in-sample` and do not claim held-out success.

## Limitations

- Calibration contains only two repository families: `Egonex-AI/Understand-Anything` (1,759 requests) and `403errors/repomind` (1,207 requests). All splits are repo-disjoint, so calibration and held-out behavior can vary by repository family; `metrics.json` exposes exact-set precision and commit rate by family for every split.
- Clopper–Pearson treats requests as independent, but requests are clustered by repository. With only two calibration repository families, the effective number of independent clusters is two, so the request-level confidence bound can overstate cross-repository certainty.
- The least-strict certified threshold is selected on the same calibration split used to fit the isotonic map. That reuse makes the Clopper–Pearson certification bound optimistic even though the held-out rows remain sealed from fitting.
- P1 missing-evidence status is available from syntax and Tier A source reads and can be a strong scorer feature. Missingness differs between candidate ranks/gold status in the corpus, so this is a potential dataset shortcut and should be examined by the missing-evidence slices before interpreting generalization.

## Slice definitions

Slices are multi-label where appropriate and retain not-detected outcomes:

- `ambiguity-class`: every syntax/Tier-A class tag present on a P1 state record;
- `not-detected-class`: every P1 class detector recorded as not detected;
- `repo-family`: Git host plus repository owner (for example, `github.com/acme`);
- `candidate-set-size`: `0`, `1`, `2-4`, `5-8`, `9-16`, `17-32`, or `33+` candidates; and
- `missing-evidence`: `has-missing-evidence` when any candidate has P1 `evidenceStatus: "missing"`, otherwise `no-missing-evidence`.

Every slice carries sample/trusted/candidate-miss counts, ECE/reliability, and the request/candidate metrics for each precision target. Candidate-miss samples remain visible in request-level slices while being excluded from candidate-level denominators as described above.
