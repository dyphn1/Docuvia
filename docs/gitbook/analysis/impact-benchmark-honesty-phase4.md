# Impact benchmark honesty — Phase 4 CI report and hard regression gates

Source: [#508](https://github.com/dyphn1/Docuvia/issues/508).

Phase 4 turns the Phase 0–3 evaluator contracts into one versioned CI artifact
and one human-readable summary. The report is deliberately sliced: a perfect
legacy positive F1 is evidence about that positive slice only, never a claim
that impact analysis is correct in every metric family.

## Scope and inputs

The report consumes the existing evaluators and their normalized outputs. It
does not recalculate Phase 0–3 scoring semantics, change their goldens, or
replace their gates.

The fixed slice order is:

1. `legacy-positive-regression` — the existing eight #192 cases.
2. `phase1-negative-ambiguity` — Phase 1 negative and target-identity cases.
3. `phase2-epistemic-candidate-boundary` — Phase 2 epistemic, dynamic-boundary,
   provenance, and candidate-set cases.
4. `phase3-state-transition` — Phase 3 stale/fresh/state-transition records.

Every slice is labeled with its scope, case family, and case sample count.
Errored, missing, and excluded cases remain in the report inventory. They are
never silently removed to improve a rate. Registered known-defect checkpoints
remain in the per-case JSON and are listed as exclusions, but are excluded from
every Phase 4 metric-family headline and hard gate.

The machine-readable report has an explicit `schemaVersion`. The current
report schema is version `1`; readers must reject unsupported versions rather
than guessing at the shape.

## Metric contract

### Legacy positive regression

This section reports the eight-case compatibility slice using the existing
Phase 6 scorer and regression floor. It shows cases, errors, precision, recall,
and F1 with explicit confusion counts. Precision is `TP/(TP+FP)` and recall is
`TP/(TP+FN)` over all scored legacy files; F1 is shown as `TP`, `FP`, and `FN`
counts. `F1=1.000` here means that the scored
legacy positive cases matched their labeled confirmed dependents. It does not
measure negative discrimination, target identity, uncertainty honesty,
candidate boundaries, provenance, or graph state transitions.

### Confirmed dependency accuracy

This section uses confirmed-positive records from the Phase 0 scorer. Static
and LSP-fallback evidence can contribute confirmed predictions; a
`dynamic-candidate` entry cannot. It reports cases, errors, precision, recall,
and F1 with the same global confusion-count contract: precision is
`TP/(TP+FP)`, recall is `TP/(TP+FN)`, and F1 is printed with `TP`, `FP`, and
`FN` rather than a rate fraction.

### Negative discrimination

For deterministic true-negative fixtures, a resolved result with no confirmed
dependents is a true negative. A resolved result with any confirmed dependent
is a false positive. UNKNOWN, AMBIGUOUS, NOT_FOUND, and ERROR remain visible
and are not converted into true negatives. The report shows resolved negative
cases, specificity, and false-positive case rate as numerator/denominator
fractions.

### Ambiguity and target identity

Identity-checked cases compare the observed deterministic `node_key` with the
golden identity. A resolved mismatch is a wrong-target binding. An abstention
is not silently relabeled as a wrong target; it remains in its own status
count. The report shows checked cases, wrong-target count, and wrong-target
rate.

### Candidate-boundary quality

Candidate evidence is reported separately from confirmed dependency accuracy.
The report shows candidate cases, gold-in-candidate-set coverage, median and
maximum candidate-set size, and overflow/unresolved counts. Candidate presence
does not receive confirmed-dependency credit. A zero denominator renders
`n/a`, never `0.000` or `NaN`.

### Epistemic honesty

An UNKNOWN or AMBIGUOUS result is correct when the case requires uncertainty.
A resolved empty result for an epistemic-unknown case is false-safe. A
resolved non-empty result is wrong-certainty. The report shows unknown-required
cases, correct-unknown rate, false-safe count/rate, and provenance checked and
mismatch counts/rate.

### State robustness

State-transition rows are sourced from the Phase 3 evaluation. The summary
reports pass/fail counts per transition kind and stale-edge/stale-record
violations. Registered known-defect transitions add an explicit excluded count
and defect id, while passing and failing counts exclude those observations. The
Phase 3 state-diff, freshness, oracle, accumulation, and determinism gates
remain authoritative; this report does not create a second state-transition
scorer.

### Errors, exclusions, and known defects

The report includes every error, `n/a`, and exclusion with an explicit reason.
Registered product defects remain visible as open items with their checkpoint
and issue number and are also listed explicitly in the exclusions line. The
current Phase 3 registry includes D10 → #522 and D12 → #521. A registry entry
whose checkpoint now passes is still a hard failure: the entry must be removed
when the defect is fixed. An entry without an issue number is also a hard
failure. An unregistered failing checkpoint remains a hard failure.

## Human summary layout

The Markdown renderer emits these sections in this fixed order:

1. Legacy positive regression
2. Confirmed dependency accuracy
3. Negative discrimination
4. Ambiguity / target identity
5. Candidate-boundary quality
6. Epistemic honesty
7. State robustness
8. Errors, N/A and exclusions
9. Known product defects
10. What these metrics do NOT prove

Every precision, recall, and other rate is printed as
`0.000 (numerator/denominator)` or `n/a` for an empty denominator. F1 is printed
as `0.000 (TP=n, FP=n, FN=n)`, not as a misleading rate fraction. No blended
accuracy value is emitted. The per-case rows remain available in the JSON
artifact for diagnosis.

## Hard gates

The Phase 4 gate consumes the existing Phase 1–3 gate results and the existing
Phase 0/legacy aggregates. Registered known-defect checkpoints are excluded
from every metric-family gate and headline metric; the separate registry gate
requires each registered checkpoint to continue failing. It fails closed for:

- any error or dropped case, including a slice inventory mismatch;
- false-safe cases, provenance mismatches, wrong-target bindings, or replay
  mismatches;
- negative specificity below `1.000` or false-positive rate above `0`;
- a missing or regressed legacy case;
- a Phase 1–3 gate that was green for the unpoisoned corpus but is no longer
  green;
- a known-defect registry entry that is invalid or whose checkpoint now passes.

Each violation names a stable gate id, slice, offending case/checkpoint ids,
and the measured numbers. The unpoisoned golden report must pass all gates.
The evaluator tests inject one failure at a time to prove that each gate is
non-vacuous.

## Evidence boundary and limitations

The current report measures synthetic TypeScript fixtures only. No real
repository corpus or additional language family is claimed; that evidence is
pending Phase 5 / #506. UNKNOWN/abstention is scored as honest when the golden
case requires uncertainty, not as a positive or negative dependency result.

Known open limitations remain visible:

- #516 — dynamic evidence is not preserved through the snapshot/clean/
  auto-hydrate round trip;
- #518 — rust-analyzer live-test `content modified` flake;
- #521 — D12 full-ingestion rewind stale-record defect;
- #522 — D10 oversized-delta stale-record defect;
- #523 — dirty working-tree changes are outside HEAD-sha freshness semantics;
- #524 — generated benchmark artifacts must stay excluded from the corpus.

The Phase 4 report does not prove real-repository accuracy, coverage of other
languages, correctness of unobserved runtime edges, or absence of product
defects outside the registered checkpoints. It makes the measured evidence
and its denominators explicit so those claims cannot be inferred from one
positive F1 value.

## CI and runtime

The six-test Phase 4 corpus integration file is an opt-in lane, not part of the default
`pnpm run test` suite. The default suite visibly skips that describe while retaining the Phase 4
unit tests. `pnpm run eval:impact:honesty` is the authoritative corpus gate: it passes the normal
cross-platform Vitest `--mode phase4-honesty` argument, and `artifacts/cli/vitest.config.ts`
converts that argument into a test define because Vitest workspace projects keep
`import.meta.env.MODE` at `test`. This avoids POSIX-only environment assignment syntax and keeps
the same command shape on Windows and POSIX hosts.

The eval job runs the full honesty report, uploads the versioned JSON and
Markdown artifacts, preserves the existing CSV/summary artifacts, writes the
same Markdown to `$GITHUB_STEP_SUMMARY`, and posts the PR comment on a
non-blocking basis. The report gate itself is blocking. No new secret or
permission is required.

Corpus replay determinism is covered by the Phase 3 evaluator's two independent
corpus runs. The Phase 4 `[stress]` test is narrower: it verifies that the
renderer produces identical JSON and Markdown for identical in-memory input; it
is not a second corpus replay. The host acceptance run compared both
`evaluate/results/impact_honesty_phase4.json` and
`evaluate/results/impact_honesty_phase4.summary.md` from two complete
report-command runs byte-for-byte. No run metadata fields were excluded from
either comparison: neither output contains timestamps, durations, or SHAs.

The full Phase 4 report command was attempted locally on 2026-09-28, but the
sandbox blocked the first `tsx` subprocess before corpus evaluation:
`listen EPERM: operation not permitted .../tsx-501/33606.pipe`. The measured
time to that BLOCKED-ENV result was under one second. The host acceptance run
completed the report in approximately 117 seconds; full corpus runtime is
therefore host-only evidence in this sandbox. The command is capped at ten
minutes.
