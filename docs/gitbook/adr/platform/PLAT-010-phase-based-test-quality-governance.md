---
id: PLAT-010
title: Phase-Based Test Quality Governance
status: accepted
date: 2026-09-12
domains: [platform]
supersedes: []
superseded_by: []
---

# Phase-Based Test Quality Governance

## Context

Docuvia already has a strict testing architecture: orchestration and domain-core code is isolated behind mocks, technology providers are tested against real local integrations, and the CLI is verified through smoke/E2E coverage. That architecture defines **where and how tests run**, but it does not by itself prove that each capability is tested deeply enough.

A single project-wide coverage percentage is not sufficient. Strongly tested modules can hide weak contracts, and line coverage can be increased without proving negative cases, malformed input, deterministic behavior, or source conformance.

Issue #371 therefore introduces a second layer of governance: every major system responsibility is hardened independently, one phase at a time, with an evidence-based TDD quality score.

## Decision

Docuvia SHALL use a **phase-based test quality hardening process**.

### 1. One phase at a time

The project is divided into independently testable phases. Except for documentation/governance changes, implementation work SHALL focus on one active phase at a time. A later phase does not start until the current phase has a recorded final score and all mandatory gates pass.

The initial phase map is:

| Phase | Responsibility | Primary scope |
| --- | --- | --- |
| 0 | Scoring framework and evidence rules | scorer, mandatory gates, AST pilot |
| 1 | Contracts and schema boundaries | `lib/contracts`, `lib/schema` |
| 2 | Repository discovery and local source acquisition | `lib/git-local`, discovery/git/process/temp helpers |
| 3 | AST and language extraction | `lib/ast-core`, `lib/plugins-ast`, `lib/core/src/ast`, related detector behavior |
| 4 | Graph ingestion, persistence and topology | graph/topology plus graph persistence |
| 5 | Query and retrieval | query/search/retrieval capabilities |
| 6 | Impact analysis and reliability/staleness | impact analysis, #192 corpus, #193 freshness behavior |
| 7 | LSP, LLM and remote enrichment providers | LSP, `lib/llm-api`, `lib/remote-api`, provider degradation |
| 8 | Orchestration, registration and UI core | `lib/ui-core`, registration/factory wiring |
| 9 | CLI and cross-layer workflows | `artifacts/cli`, smoke/E2E user flows |

Phase boundaries follow **system responsibility**, not package count. A phase may span several packages when they jointly implement one observable contract.

### 2. Score contracts before aggregating a phase

Each phase SHALL inventory its externally meaningful contracts/capabilities first. Every scored contract receives evidence for the applicable quality dimensions. A phase score must not hide a weak contract behind stronger contracts.

Therefore:

- every applicable scored contract MUST be at least **80/100**;
- the aggregate phase score MUST be at least **80/100**;
- all mandatory gates MUST pass;
- **90+** is the preferred high-quality target;
- 100 is allowed but is not required.

A phase with any contract below 80 is incomplete even if the phase average is above 80.

### 3. Default quality dimensions

Unless an explicit follow-up decision changes the model, the score uses these dimensions:

| Dimension | Weight |
| --- | ---: |
| Positive parameters / happy paths | 15% |
| Negative parameters | 15% |
| Input completeness / boundaries | 15% |
| Output contract completeness | 15% |
| Error handling | 15% |
| Unexpected / malformed input | 10% |
| Determinism / repeatability | 10% |
| Source / requirement traceability | 5% |

For applicable dimensions, the contract score is the weighted normalized percentage of passed required checks.

A dimension may be marked N/A only when the evidence includes a concrete reason. Silent omission is invalid evidence.

### 4. Score bands

| Score | Interpretation |
| --- | --- |
| < 80 | **FAIL** — phase/contract is not hardened |
| 80–89.99 | **PASS** — minimum acceptable hardening |
| 90–94.99 | **STRONG** — preferred quality level |
| 95–100 | **EXCELLENT** — unusually complete evidence |

The score is capped at 100. There is no requirement to reach 100, and no test may be added only to inflate the number.

### 5. Mandatory gates override the numeric score

A numeric score alone can never make a phase pass. The following conditions are mandatory:

1. every applicable dimension has explicit evidence;
2. required checks are not silently removed or converted to N/A;
3. authoritative source/requirement conformance passes;
4. source conflict forces FAIL until resolved;
5. skipped tests are never counted as passing evidence;
6. malformed or unknown scoring evidence is rejected;
7. the scorer itself has negative controls proving that missing evidence can reduce or fail the result;
8. existing tests for the phase remain green unless a documented defect intentionally changes the expected behavior.

### 6. Coverage is supporting evidence, not the score

Line/branch/function coverage remains an existing project quality gate, but coverage percentage is not the phase TDD quality score. The phase score measures behavioral evidence and contract completeness.

A phase with high line coverage can still fail when it lacks negative cases, output assertions, error behavior, determinism, or source traceability.

### 7. Source wins over implementation

When an authoritative ADR, architecture document, requirement, protocol, or accepted issue defines behavior, tests SHALL validate that behavior directly.

If current implementation disagrees with the authoritative source, the result is a source-conformance failure rather than a passing test based on current behavior. The phase must either fix the implementation or explicitly resolve the source conflict.

### 8. No score gaming

The following practices are prohibited:

- duplicate tests with no additional behavioral evidence;
- assertions that only prove execution instead of behavior;
- changing expected values to match a bug without source justification;
- marking difficult dimensions N/A to increase the score;
- weakening mandatory gates because a phase is hard to test;
- combining unrelated components into a broad aggregate that hides a contract below 80;
- changing production behavior solely to make tests easier.

### 9. Required phase evidence

Every completed phase SHALL leave a reviewable record containing:

- scope and contract inventory;
- authoritative source references;
- baseline score;
- missing/high-risk evidence identified from the baseline;
- tests added or corrected;
- negative controls where practical;
- final per-contract scores;
- aggregate phase score;
- mandatory-gate result;
- unresolved gaps and follow-up issues.

The operational format and review procedure are defined by the [Phase-Based Test Quality Hardening Guideline](../../guidelines/phase-based-test-quality-hardening.md).

## Consequences

### Positive

- Weak test areas can no longer hide behind repository-wide coverage.
- Every hardening PR has a measurable before/after result.
- 80 provides a real completion floor while 90+ encourages stronger evidence without forcing artificial 100-point work.
- One-phase-at-a-time execution keeps regressions attributable and reviews small enough to reason about.
- Negative controls make the scoring mechanism itself testable rather than trusted by convention.
- Source traceability reduces the risk of tests faithfully preserving an incorrect implementation.

### Costs and constraints

- Initial baseline work may expose many gaps before production behavior changes.
- Some phases need fixtures, local integration resources, or regression corpora before their score can rise meaningfully.
- The team must maintain score evidence when contracts change.
- A phase may remain below 80 for more than one PR; this is acceptable, but it cannot be declared complete.

### Rejected alternatives

- **One global repository score:** rejected because strong modules can hide weak ones.
- **Coverage-only gating:** rejected because execution coverage does not prove behavioral correctness.
- **Require 100 for every phase:** rejected because it encourages low-value tests and N/A abuse.
- **Run all phases in one hardening PR:** rejected because failures become difficult to localize and review.