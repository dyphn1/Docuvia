# Impact benchmark honesty contract

This document defines the Phase 0 measurement contract for issue #508.

The existing #192 impact benchmark remains the positive-regression baseline. Phase 0 does not change production impact behavior and does not reinterpret the existing 8-case positive F1 history. Instead, it adds a versioned measurement model for cases that positive-set F1 cannot represent honestly.

## 1. Core principle

> Unknown is acceptable; falsely claiming safety is not.

Impact evaluation must distinguish:

| State | Meaning |
| --- | --- |
| `confirmed-positive` | one or more dependents are confirmed |
| `verified-negative` | the target was resolved and sufficient evidence supports zero confirmed dependents |
| `candidate` | one or more bounded candidates are surfaced, but they are not confirmed dependencies |
| `unknown` | available evidence is insufficient to make a safe positive/negative claim |
| `not-found` | target resolution itself failed |
| `error` | evaluation did not complete |

`candidate`, `unknown`, `not-found`, and `error` must never be silently converted to `verified-negative`.

## 2. Case intents

Every honesty-benchmark case declares one intent:

- `confirmed-positive`: confirmed dependents are expected.
- `negative`: the correct confirmed dependent set is empty and the expected outcome is a verified negative.
- `candidate-boundary`: bounded candidates are expected; candidate coverage is measured separately from confirmed-dependency accuracy.
- `epistemic-unknown`: uncertainty/abstention is the correct outcome.
- `not-found`: target resolution should fail distinctly from zero impact.

The intent decides which metrics are applicable. A non-applicable metric is reported as `null` / `n/a`; it is never fabricated as 0 or 1.

## 3. Provenance channels

The evaluator must preserve, rather than flatten, these provenance channels:

- `static`
- `lsp-fallback`
- `dynamic-candidate`
- `unresolved`
- `none`

A `dynamic-candidate` file may contribute to candidate-set coverage, but it must not become a confirmed-dependency true positive.

When a case declares an expected provenance, a mismatched observed provenance is counted explicitly.

## 4. Metric families

### 4.1 Positive accuracy

Applicable only to `confirmed-positive` cases.

Scoring is file-level set precision / recall / F1 over **confirmed files only**.

An errored positive case remains in the denominator as a zero-score case. It must not disappear from the aggregate.

### 4.2 Negative discrimination

Applicable only to `negative` cases.

A case is:

- true negative when the outcome is `verified-negative` and there are no confirmed files;
- false positive when one or more confirmed files are returned, or the evaluator claims `confirmed-positive`;
- abstained otherwise.

Report:

- negative case count;
- true-negative case count;
- false-positive case count;
- abstained negative case count;
- specificity = TN / (TN + FP), or `n/a` when no decision exists;
- false-positive rate = FP / (TN + FP), or `n/a` when no decision exists;
- verified-negative rate = TN / all negative cases.

The verified-negative rate prevents an evaluator from obtaining a perfect specificity value merely by abstaining on every negative case.

### 4.3 Candidate-boundary accuracy

Applicable only to `candidate-boundary` cases.

Measure:

- candidate-set recall against expected candidate files;
- candidate-set size;
- confirmed-file leakage count.

Candidate files are scored in this family only. They do not count as confirmed positive hits.

An errored candidate case contributes zero candidate recall.

### 4.4 Epistemic honesty

Applicable to `epistemic-unknown` cases.

Report:

- correct-unknown count/rate;
- false-safe count/rate;
- other-outcome count/rate.

A false-safe occurs when a case that should be unknown is reported as `verified-negative`.

Errors remain visible and lower correct-unknown rate; they are not classified as correct unknown.

### 4.5 Target-resolution honesty

Applicable to `not-found` cases.

The target must be reported as `not-found`. Zero dependents with `verified-negative` is not equivalent.

### 4.6 Provenance accuracy

For cases that declare expected provenance:

- matching provenance increments the match count;
- mismatch increments the mismatch count;
- errors count as mismatches;
- no applicable cases yields `n/a`.

## 5. Error and denominator policy

Errors must never make a metric look better by disappearing.

Therefore:

- every case remains present in the versioned report;
- `totalCases` and `erroredCases` always include all inputs;
- positive errors contribute zero per-case precision/recall/F1;
- candidate errors contribute zero candidate recall;
- epistemic errors remain in the epistemic denominator and therefore lower correct-unknown rate;
- negative errors remain in the total negative denominator and therefore lower verified-negative rate;
- provenance errors count as mismatches when provenance is expected.

Phase 4 will add hard CI gates. Phase 0 only freezes these semantics and makes them executable.

## 6. Determinism contract

The report schema is versioned.

Serialization must be deterministic:

- cases sorted by scenario, then target;
- file lists deduplicated and sorted;
- aggregate field order fixed by the report model;
- repeated serialization of semantically identical inputs must be byte-for-byte identical.

## 7. Compatibility boundary

Phase 0 must not change:

- production impact analysis;
- the existing #192 8-case corpus;
- the existing positive F1 scorer or its regression threshold.

The new honesty scorer/report is additive. Later phases migrate CI presentation and add adversarial fixtures only after this contract is frozen.

## 8. Phase 0 executable acceptance

The Phase 0 test suite must prove all of the following:

1. existing positive-set F1 math remains unchanged;
2. `expected=[] / predicted=[]` is measurable as a successful negative;
3. a negative false positive lowers specificity and raises FPR;
4. candidate-only evidence cannot become a confirmed TP;
5. `unknown`, `not-found`, and `error` remain distinct;
6. a false-safe result increments the false-safe metric;
7. errors remain visible and cannot improve applicable aggregates by being dropped;
8. an empty metric slice renders `n/a`;
9. provenance mismatches are measurable;
10. report serialization is deterministic.

TDD-SOURCE: issue #508
Related: #192, #193, #263, #393, #506.
