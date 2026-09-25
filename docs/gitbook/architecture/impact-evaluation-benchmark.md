# Impact Evaluation Benchmark Semantics

> **Status:** Phase 0 contract for issue #508.  
> **Scope:** evaluator/scorer/reporting semantics only. This document does not change production `docuvia impact` behavior.

The impact benchmark must distinguish **what the product knows** from **what the benchmark can prove**. A single positive-set F1 score is retained for the existing positive regression corpus, but it is not an overall correctness or safety score.

## 1. Case families

Every version-2 benchmark case declares one metric family:

| Family      | Purpose                                                                                | Primary evidence                                         |
| ----------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `positive`  | One or more confirmed dependents are expected                                          | precision / recall / F1                                  |
| `negative`  | The target is valid and the confirmed dependent set is expected to be empty            | case-level true-negative / false-positive discrimination |
| `candidate` | A bounded candidate set is expected, but the candidates are not confirmed dependencies | candidate coverage (introduced by a later phase)         |
| `epistemic` | Available evidence is insufficient for a verified answer                               | correct abstention / false-safe behavior                 |
| `ambiguity` | Multiple target interpretations are plausible                                          | wrong-target / abstention behavior                       |

The existing eight #192 regression cases remain `positive` cases. Phase 0 does not rewrite their historical F1 semantics.

## 2. Decisions are not interchangeable

The evaluator recognizes these decisions:

- `confirmed-positive`: one or more dependents are asserted as confirmed.
- `verified-negative`: the evaluator asserts that the confirmed dependent set is empty.
- `unknown`: evidence is insufficient; the evaluator abstains.
- `ambiguous`: target resolution is not unique enough to claim one answer.
- `stale`: the graph is known to be older than the source state being judged.
- `incomplete`: required analysis/ingestion evidence is incomplete.
- `error`: the benchmark/product path failed to produce a valid result.

`unknown`, `ambiguous`, `stale`, and `incomplete` are explicit uncertainty states. They must never be normalized into `verified-negative`.

## 3. Positive-set metrics

Positive cases retain file-level set scoring:

```text
precision = TP / predicted
recall    = TP / expected
F1        = harmonic_mean(precision, recall)
```

Empty positive predictions score zero rather than NaN. Errors stay visible and count as zero contribution in the version-2 positive aggregate, so a crashing case cannot make the mean look better by disappearing.

The legacy #192 scorer remains available for backwards-compatible reports until the version-2 report fully replaces it.

## 4. Negative discrimination

Positive-set F1 is **not** used for a pure negative case.

For each `negative` case:

- `predicted=[]` with decision `verified-negative` is a **true-negative case**.
- any predicted dependent is a **false-positive case**.
- an error is neither a true negative nor a successful negative; it remains a visible failed case.

The report publishes case-level:

```text
negative specificity = true_negative_cases / all_negative_cases
false-positive rate   = false_positive_cases / all_negative_cases
```

These are explicitly **case-level** rates, not file-universe specificity. The benchmark does not claim knowledge of every possible non-dependent file in a repository.

## 5. False-safe invariant

The benchmark treats the following as a false-safe result:

> the observed decision is `verified-negative`, but the case contract does not expect `verified-negative`.

This covers the dangerous class where a known positive, uncertain, ambiguous, stale, or incomplete situation is presented as confidently safe.

The deterministic synthetic honesty gate requires:

```text
false-safe rate = 0
```

Unknown/abstention is allowed when the case contract expects uncertainty. Fabricated safety is not.

## 6. Correct abstention

For `epistemic` cases, the expected decision may be `unknown`, `stale`, or `incomplete`.

A result is a correct abstention only when the observed decision matches that expected uncertainty state. A later phase may add policy-level equivalence classes; Phase 0 deliberately keeps the comparison exact so the benchmark cannot silently weaken semantics.

## 7. Ambiguity and wrong-target accounting

An ambiguity case may carry an expected target identity and an observed resolved target identity.

A **wrong-target** event occurs when both identities are known and differ. Returning `ambiguous`/abstaining is distinct from silently binding to the wrong target.

Synthetic ambiguity fixtures added in Phase 1 must keep the wrong-target rate at zero.

## 8. Error and denominator policy

Errors are never silently dropped.

Version-2 aggregates always expose:

- total case count;
- per-family case count;
- error count and error rate;
- the denominator used by every metric.

For positive means, an errored positive case contributes zero. For other families, the errored case remains in the family denominator and separately increments the error count. The hard gate rejects any non-zero error count.

A metric with zero applicable cases renders `n/a`; it must not fabricate `0` or `1`.

## 9. Reporting rules

The report must keep these slices separate:

- positive precision / recall / F1;
- negative specificity / false-positive rate;
- false-safe / correct-abstention;
- ambiguity / wrong-target;
- errors.

Do not combine them into a single overall accuracy number. One strong slice must not compensate for a dangerous failure in another slice.

The report schema is versioned so downstream CI can distinguish historical #192 output from the honesty-aware format.

## 10. Negative controls

The benchmark mechanism must prove that it can fail. Phase 0 unit tests therefore include deliberate controls showing that:

- a false-positive negative lowers negative specificity;
- a false-safe decision trips the honesty gate;
- a wrong-target resolution trips the ambiguity gate;
- an execution error cannot improve an aggregate by being omitted;
- zero-case slices report `n/a`.

## 11. Source traceability

- Issue #192 — original impact accuracy corpus and positive F1 regression gate.
- Issue #193 — graph freshness/staleness visibility.
- Issue #508 — benchmark honesty hardening and this metric contract.
- `docs/gitbook/guidelines/phase-based-test-quality-hardening.md` — mandatory source-first TDD and negative-control policy.
