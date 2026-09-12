# Phase-Based Test Quality Hardening Guideline

This guideline implements [PLAT-010 — Phase-Based Test Quality Governance](../adr/platform/PLAT-010-phase-based-test-quality-governance.md).

The purpose is simple: improve Docuvia test quality **one phase at a time**, measure the result with evidence, and never allow a weak subsystem to hide behind a strong repository-wide coverage number.

## 1. Quality target

Every phase uses the following rule:

- **< 80:** FAIL — keep hardening the same phase.
- **80–89.99:** PASS — minimum acceptable completion level.
- **90–94.99:** STRONG — preferred target before moving on.
- **95–100:** EXCELLENT — strong evidence completeness; not mandatory.

A phase may score above 90. Reaching 100 is allowed but must never become the reason for low-value tests.

A phase cannot pass by average alone. **Every scored contract must be >= 80**, the aggregate phase score must be >= 80, and every mandatory gate must pass.

## 2. Default scoring dimensions

Use these dimensions unless an accepted ADR explicitly changes them:

| Dimension           | Weight | What counts as useful evidence                                                                                                  |
| ------------------- | -----: | ------------------------------------------------------------------------------------------------------------------------------- |
| Positive parameters |    15% | valid inputs, happy paths, supported variants                                                                                   |
| Negative parameters |    15% | invalid/rejected parameters, unsupported values, forbidden states                                                               |
| Input completeness  |    15% | empty/min/max/boundary/optional/multi-item inputs relevant to the contract                                                      |
| Output completeness |    15% | full result shape, ordering, metadata, side effects, warnings/errors where applicable                                           |
| Error handling      |    15% | expected failures, dependency failures, fallback errors, cleanup behavior                                                       |
| Unexpected input    |    10% | malformed/unexpected/duplicate/partial data and defensive behavior                                                              |
| Determinism         |    10% | repeated identical input produces identical normalized output and required side effects                                         |
| Source traceability |     5% | executable evidence tied to an ADR, architecture document, requirement, protocol, accepted issue, or other authoritative source |

Coverage percentage is useful supporting evidence, but it is not one of these dimensions and does not replace them.

## 3. The phase map

The current project hardening order is:

| Phase | Responsibility                                    | Primary scope                                        | Test emphasis                                                               |
| ----- | ------------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------- |
| 0     | Scoring framework and evidence rules              | scorer + AST pilot                                   | scorer correctness, negative controls, source traceability                  |
| 1     | Contracts and schema boundaries                   | `lib/contracts`, `lib/schema`                        | contract mapping, schema constraints, migrations, invalid data              |
| 2     | Repository discovery and local source acquisition | `lib/git-local`, discovery/git/process/temp helpers  | repository/path states, filesystem isolation, Git edge cases                |
| 3     | AST and language extraction                       | `lib/ast-core`, `lib/plugins-ast`, core AST/detector | golden/broken/ambiguous/legacy fixtures, parser failures, normalization     |
| 4     | Graph ingestion, persistence and topology         | graph/topology and graph persistence                 | node/edge invariants, re-ingest, delete/update, idempotence, freshness      |
| 5     | Query and retrieval                               | query/search/retrieval                               | match/no-match, ranking/filter behavior, malformed queries                  |
| 6     | Impact analysis and reliability/staleness         | impact + #192/#193 evidence                          | precision/recall/F1, stale-vs-wrong classification, blind spots             |
| 7     | LSP, LLM and remote enrichment                    | LSP, `lib/llm-api`, `lib/remote-api`                 | provider failures, timeout/degradation, normalized deterministic boundaries |
| 8     | Orchestration, registration and UI core           | `lib/ui-core`, registration/factory wiring           | pure mocks, mapping, provider selection, missing/conflicting registrations  |
| 9     | CLI and cross-layer workflows                     | `artifacts/cli`                                      | bootstrap, parsing, exit codes, diagnostics, user-flow smoke/E2E            |

Do not move implementation hardening into a later phase just because a convenient test already touches it. Keep evidence attributable to the active phase.

## 4. One-phase-at-a-time workflow

### Step 1 — Define the contract inventory

Before adding tests, list the observable contracts in the phase.

Good contract examples:

- `processFiles(root, files)` returns normalized parsed/failure results.
- a graph re-ingest updates existing entities without duplicating nodes.
- a query with no match returns the documented empty result rather than an exception.
- a provider timeout degrades according to the documented fallback policy.

Avoid scoring entire packages as one contract when they contain unrelated behavior.

### Step 2 — Identify authoritative sources

For every contract, record the source that defines expected behavior. Preferred order:

1. accepted ADR;
2. current architecture document;
3. accepted requirement/specification;
4. accepted issue/decision;
5. documented public contract/type with no conflicting higher-level source.

Do not treat current implementation as the authoritative source when a higher-level source exists.

A useful test suite should include an explicit marker or evidence mapping such as:

```text
TDD-SOURCE: docs/gitbook/architecture/testing-and-quality-architecture.md
TDD-SOURCE: docs/gitbook/adr/impact/IMPT-xxx-....md
TDD-SOURCE: issue #192
```

The exact storage format may evolve, but the mapping must be reviewable and machine-detectable where practical.

### Step 3 — Build the baseline before changing tests

Score the current phase first.

Do not estimate from test count. For each contract and dimension, count required checks and passing checks based on real behavioral evidence.

Example:

| Dimension           | Passing | Required | Result |
| ------------------- | ------: | -------: | -----: |
| Positive parameters |       2 |        2 |   100% |
| Negative parameters |       1 |        2 |    50% |
| Input completeness  |       1 |        3 |  33.3% |
| Output completeness |       2 |        4 |    50% |
| Error handling      |       2 |        3 |  66.7% |
| Unexpected input    |       0 |        2 |     0% |
| Determinism         |       0 |        1 |     0% |
| Source traceability |       0 |        1 |     0% |

The baseline is valuable even when it is low. Do not modify the rubric to make the baseline look better.

### Step 4 — Separate missing evidence from real product defects

A failed/missing check can mean different things:

- **TEST_GAP:** expected behavior appears correct but lacks executable evidence.
- **PRODUCT_DEFECT:** implementation contradicts the authoritative behavior.
- **SOURCE_CONFLICT:** documents/ADRs/requirements disagree and expected behavior is not safely decidable.
- **INFRA_LIMITATION:** the correct test needs an unavailable fixture/tool/environment.

Do not silently turn a product defect into an expected test result.

### Step 5 — Add the smallest meaningful tests

Prefer tests that add new behavioral information:

- boundary values;
- malformed inputs;
- dependency failure behavior;
- output fields previously unasserted;
- ordering/idempotence invariants;
- repeated-run comparison;
- regression fixtures reproducing a known blind spot.

Avoid near-duplicate test cases that exercise the same behavior only to increase a counter.

### Step 6 — Add negative controls where the mechanism can lie

Scoring infrastructure, parsers, evaluators, and benchmark harnesses should prove that they can fail.

Examples:

- remove determinism evidence and verify the score drops/fails;
- inject an unknown dimension and verify the scorer rejects it;
- mark source conformance as conflict and verify a numeric 100 still fails;
- intentionally alter expected benchmark ground truth and verify regression detection triggers.

A quality system that only demonstrates PASS is not yet trustworthy.

### Step 7 — Run the correct test lane

Respect the existing testing architecture:

- `lib/core` and `lib/ui-core`: pure unit tests, no real I/O;
- technology providers such as schema/Git/AST/LLM/remote implementations: isolated integration tests against the real local technology where required;
- CLI: minimal smoke/E2E tests across the assembled stack.

Do not improve a score by violating test isolation.

### Step 8 — Re-score from executed evidence

After tests pass, compute the score from the actual evidence. Do not award points for planned tests, commented tests, skipped tests, or tests that were not executed in the relevant lane.

For each contract:

```text
contract_score =
  sum(dimension_percentage * applicable_weight)
  / sum(applicable_weight)
```

A genuine N/A dimension is removed from the applicable-weight denominator only when it has an explicit rationale.

The aggregate phase score is the arithmetic mean of the scored contracts unless a future accepted ADR establishes a different aggregation model. Regardless of the average, any contract below 80 keeps the phase incomplete.

## 5. Mandatory gates

The phase result is FAIL if any of these conditions is true:

- a scored contract is below 80;
- aggregate phase score is below 80;
- an applicable dimension has no evidence and no valid N/A reason;
- source conformance is `SOURCE_CONFLICT` or otherwise fails;
- skipped tests are counted as passing evidence;
- required checks were deleted or weakened without justification;
- the evidence schema contains missing/unknown dimensions that the scorer silently ignores;
- existing regression tests fail without a documented intentional behavior change;
- the test lane violates the project's isolation architecture.

Mandatory gates are not converted into score penalties. They fail the phase directly.

## 6. Phase completion report

Every phase should end with a report in the parent issue or phase issue using this structure:

```markdown
## Phase N — Final quality report

### Scope

- Contract A
- Contract B

### Authoritative sources

- ADR ...
- Architecture ...
- Issue ...

### Baseline

| Contract | Baseline | Main gaps                    |
| -------- | -------: | ---------------------------- |
| A        |    56.25 | determinism, malformed input |
| B        |    82.50 | output completeness          |

### Final score

| Contract | Final | Gate | Remaining gaps              |
| -------- | ----: | ---- | --------------------------- |
| A        | 92.50 | PASS | one low-risk boundary case  |
| B        | 88.75 | PASS | richer diagnostic assertion |

**Phase score:** 90.63
**Phase result:** PASS
**Quality band:** STRONG

### Evidence added

- test ...
- fixture ...
- negative control ...

### Follow-ups

- #...
```

## 7. PR rules

A phase-hardening PR should:

- identify the active phase in the title/body;
- link the parent issue #371 and the active phase issue;
- include baseline and final score evidence;
- stay within the phase boundary unless a cross-phase change is strictly required;
- explain any production change separately from test additions;
- avoid refactors unrelated to the measured contracts;
- keep unresolved gaps visible rather than lowering the rubric.

Recommended title form:

```text
[Test Quality][Phase N] Harden <responsibility> to <score>
```

## 8. When to stop improving a phase

**80 is the required floor, not the default stopping target.**

After reaching 80:

- continue toward 90+ when the remaining gaps are meaningful and reasonably testable;
- stop when remaining points would require duplicate/low-value tests, unstable external infrastructure, or behavior outside the phase responsibility;
- document the remaining gaps and create follow-up issues when they are real but not appropriate for the current PR.

A clean 91 with meaningful behavioral evidence is preferable to an artificial 100.

## 9. Relationship to coverage and benchmarks

Use multiple metrics for different questions:

| Metric                        | Answers                                                                   |
| ----------------------------- | ------------------------------------------------------------------------- |
| line/branch/function coverage | "Was this code executed?"                                                 |
| TDD quality score             | "Did tests prove the important contract behaviors?"                       |
| precision/recall/F1           | "How accurate is this analysis/retrieval behavior against labeled truth?" |
| determinism/repeatability     | "Does the same input produce stable normalized behavior?"                 |
| CI gate result                | "Is this change acceptable to merge?"                                     |

Do not substitute one metric for another.

For Phase 6 impact analysis, precision/recall/F1 are direct behavioral evidence and should feed the relevant contract checks rather than being flattened into code coverage.

## 10. Phase progression checklist

Before moving to the next phase, confirm:

- [ ] contract inventory is recorded;
- [ ] authoritative sources are recorded;
- [ ] baseline score is recorded;
- [ ] gaps are classified as test gap/product defect/source conflict/infra limitation;
- [ ] meaningful missing evidence has been added;
- [ ] negative controls exist where practical;
- [ ] all phase tests execute in the correct lane;
- [ ] every scored contract is >= 80;
- [ ] aggregate phase score is >= 80;
- [ ] all mandatory gates pass;
- [ ] 90+ was pursued when doing so added real behavioral confidence;
- [ ] unresolved gaps have explicit follow-ups;
- [ ] final phase score is posted before the next phase begins.
