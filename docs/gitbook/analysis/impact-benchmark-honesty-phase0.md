# Impact benchmark honesty — Phase 0 metric contract

Source: [#508](https://github.com/dyphn1/Docuvia/issues/508).

This document freezes the evaluator semantics used to harden Docuvia
impact-analysis benchmarks. It extends the Phase 6 reliability work from
#192/#193 without changing production impact behavior.

The central invariant is:

> UNKNOWN is acceptable when evidence is insufficient. A result must never
> convert missing, ambiguous, stale, bounded-candidate, or failed evidence into
> a confident "no impact" claim.

## Scope

Phase 0 changes only benchmark/evaluator contracts and their pure tests.

It does **not**:

- change `docuvia impact` production behavior;
- add new dependency-resolution logic;
- add adversarial corpus fixtures from later phases;
- replace the existing eight positive regression cases;
- define a single blended "overall accuracy" score.

The existing positive benchmark remains a compatibility slice. Phase 0 adds
missing semantics around negative, candidate, unknown, ambiguity, not-found,
and execution-error outcomes.

## Versioned benchmark model

The honesty report uses schema version `1`.

Every benchmark case declares one intent:

- `confirmed-positive`: one or more dependency files are expected as confirmed
  relations. Primary metrics are positive precision, recall, and F1.
- `negative`: the target exists and the correct confirmed dependent set is
  empty. Primary metrics are true-negative and false-positive discrimination.
- `candidate-boundary`: bounded candidates may be surfaced but are not
  confirmed dependencies. Primary metric is candidate-set coverage.
- `epistemic-unknown`: available evidence is insufficient to prove either a
  dependency or a verified negative. Primary metrics are correct-unknown and
  false-safe rates.
- `not-found`: target resolution itself should fail distinctly from zero
  dependents.

An observed result has one of these statuses:

- `resolved`
- `unknown`
- `ambiguous`
- `not-found`
- `error`

`error` is an execution failure. It is never rewritten as UNKNOWN, NOT_FOUND,
or a passing empty result.

Cases that exercise duplicate/same-name resolution may also declare an optional
stable target identity:

- `expectedTargetIdentity`: the target node the golden case intends;
- `observedTargetIdentity`: the target node the analyzer actually resolved.

The identity is evaluator-owned and must be deterministic across clean ingests.
Use a stable source locator (for example repository-relative file path + symbol
kind/name), not a transient database row id.

If a case declares `expectedTargetIdentity` and the analyzer reports
`resolved`, a missing or different `observedTargetIdentity` is a
**wrong-target** result. UNKNOWN/AMBIGUOUS/NOT_FOUND/ERROR remain distinct
abstention/failure states and are not relabeled as wrong-target.

## Evidence channels

Predicted files retain their evidence source:

- `static`: confirmed deterministic/static dependency evidence.
- `lsp-fallback`: dependency recovered through the existing LSP/fallback
  channel.
- `dynamic-candidate`: bounded runtime candidate evidence only, not a
  confirmed dependency.

Positive-set dependency scoring uses `static` and `lsp-fallback`
predictions. A `dynamic-candidate` prediction cannot receive a
confirmed-dependency true positive merely because it contains the expected
file.

Candidate-boundary scoring uses only `dynamic-candidate` predictions. This
separation prevents the evaluator from erasing product provenance.

## Metric semantics

### Positive dependency metrics

For `confirmed-positive` cases:

- TP is a predicted confirmed file that intersects an expected confirmed file.
- FP is a predicted confirmed file absent from expected confirmed files.
- FN is an expected confirmed file absent from predicted confirmed files.
- precision = TP / predicted-confirmed count.
- recall = TP / expected-confirmed count.
- F1 is the harmonic mean of precision and recall.

Existing positive-set empty-denominator behavior remains unchanged for
compatibility.

### Negative discrimination

For `negative` cases:

- a **true-negative case** has status `resolved` and zero confirmed predicted
  files;
- a **false-positive case** has status `resolved` and one or more confirmed
  predicted files;
- specificity = true-negative cases / resolved negative cases;
- false-positive rate = false-positive cases / resolved negative cases.

UNKNOWN, AMBIGUOUS, NOT_FOUND, and ERROR are not silently treated as true
negatives.

A slice with zero resolved negative cases reports `null` metrics rather than
fabricating 0 or 1.

### Target-resolution identity

For cases that declare `expectedTargetIdentity`:

- `resolved` with the exact same observed identity is a correct resolution;
- `resolved` with a missing or different identity is a wrong-target result;
- non-resolved states are not counted as wrong-target bindings because the
  analyzer did not claim a concrete target; those states remain visible in the
  normal status accounting.

The aggregate exposes target-resolution case count, resolved count, correct
count, wrong-target count, and wrong-target rate over resolved identity-checked
cases.

This metric is intentionally independent from dependency-set accuracy. A query
that binds to the wrong same-name symbol must not pass merely because that wrong
symbol happens to have the same (including empty) dependent set.

### Candidate-boundary metrics

For `candidate-boundary` cases:

- expected and covered counts use only `dynamic-candidate` files;
- candidate coverage = covered expected candidates / expected candidate files;
- confirmed predictions remain separately visible and cannot increase
  candidate coverage.

A candidate-only result never receives a confirmed positive TP.

### Provenance metrics

When a case declares expected prediction provenance, the evaluator compares the
observed evidence channel for files that were actually surfaced:

- exact channel match is a provenance success;
- the same file surfaced through a different channel is a provenance mismatch;
- a file not surfaced at all remains an accuracy/coverage miss and is not
  double-counted as a provenance mismatch.

The report exposes provenance checked count, mismatch count, and mismatch rate.
A zero checked denominator reports `null` / `n/a`.

### Epistemic-honesty metrics

For `epistemic-unknown` cases:

- `unknown` or `ambiguous` is a **correct uncertainty** outcome;
- `resolved` with zero confirmed files is a **false-safe** outcome;
- `resolved` with confirmed files is a wrong-certainty outcome but not a
  false-safe;
- `not-found` and `error` remain distinct diagnostic outcomes.

The report exposes correct-unknown count/rate, false-safe count/rate,
wrong-certainty count, and error/not-found counts.

The false-safe denominator is the total `epistemic-unknown` case count.
Execution failures are also reported independently and later gates may reject
any nonzero error count.

### Not-found cases

For `not-found` intent, only observed `not-found` is a correct
target-resolution outcome.

An empty resolved dependency set is not equivalent to target-not-found.

### Errors and denominator honesty

Every report includes total cases, per-intent case counts, errored cases,
unresolved/ambiguous/not-found counts, and scored versus unscored counts for
each metric family.

Metrics that are mathematically inapplicable are `null`, rendered as `n/a`.

Errors may be excluded from a mathematical fraction where that fraction is
undefined, but their case count must remain explicit in the same slice/report.
A later hard gate may reject any nonzero error count; Phase 0 freezes the
accounting semantics.

## Determinism

Normalization is deterministic:

- duplicate file/channel entries are deduplicated;
- files are lexicographically sorted;
- report slices use a fixed order;
- serialization is stable for identical normalized inputs.

Repeated report generation for identical input must be byte-for-byte
identical.

## Phase 0 executable evidence

Pure unit tests must prove:

1. existing positive precision/recall/F1 semantics remain unchanged;
2. a perfect negative differs from a negative false positive;
3. a dynamic candidate cannot become a confirmed TP;
4. UNKNOWN differs from resolved empty/safe;
5. false-safe increments the honesty metric;
6. not-found differs from resolved empty;
7. errors remain visible in total and per-slice counts;
8. zero-denominator metrics render `n/a`;
9. duplicate input entries normalize deterministically;
10. wrong evidence provenance increments the mismatch metric;
11. wrong same-name target binding is detected independently from dependency
    set scoring;
12. ambiguity/abstention is distinct from wrong-target binding;
13. unsupported report schema versions fail closed;
14. intentionally bad control input demonstrably lowers/fails the relevant
    metric.

TDD source markers:

- issue #508
- issue #192
- issue #193
- `docs/gitbook/architecture/testing-and-quality-architecture.md`
- `docs/gitbook/guidelines/phase-based-test-quality-hardening.md`

## Exit gate

Phase 0 is complete when the versioned evaluator contract and pure tests are
implemented, the old eight-case positive benchmark remains behaviorally
unchanged, and no production impact code is modified.

Phase 1 may then add negative and ambiguity fixtures against these frozen
semantics.
