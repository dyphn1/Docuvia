---
Date: 2026-07-07
Status: Superseded
Supersedes: None
---

# ADR-033: Strict Test Framework and Quality Gates Alignment

## Context

Following an active audit comparing Docuvia's test framework completeness against the `tolaria` project, a significant gap in testing discipline and quality gating was identified.
Currently, Docuvia lacks:

1. Formalized TDD mandates (Red-Green-Refactor).
2. Explicit code health tracking (e.g., CodeScene/Codacy).
3. Monitored coverage ratchets (blocking deployments if coverage drops).
4. Testing coverage for the `kg-engine` React frontend.
5. Strict separation between fast Smoke tests (< 5 mins) and comprehensive Regression test suites.

To ensure Docuvia scales reliably as a multi-environment (VS Code, Web, CLI) agentic tool, we must adopt Tolaria's testing rigor.

## Decision

We will align Docuvia's test framework and CI/CD pipelines with the Tolaria project's standard:

1. **Mandatory TDD & Coverage Ratchet**:
   - All tasks must follow the Red-Green-Refactor loop.
   - Core/Backend coverage must stay ≥ 85%.
   - Frontend (`kg-engine`) coverage must stay ≥ 70%.
   - A `.coverage-thresholds` or `.codescene-thresholds` ratchet will be enforced.

2. **Test Lane Segregation**:
   - Introduce `pnpm run test:smoke` for core user workflows. Must complete in under 5 minutes.
   - Retain `pnpm run test` for full regression.

3. **Frontend Testing Implementation**:
   - Add Vitest and React Testing Library to `@workspace/kg-engine`.
   - Add Playwright E2E testing for critical path Web UI flows.

4. **Code Health & Security Gates**:
   - Introduce Code Health scanning for Hotspot/Average code health (via CodeScene or equivalent static analysis).
   - Integrate Codacy or equivalent for mandatory security analysis on pre-push.

5. **GitHub Actions CI Pipeline Overhaul**:
   - Update `.github/workflows/ci.yml` to split test jobs into `smoke` and `regression` lanes.
   - Embed CodeScene and Codacy verification jobs directly into the GitHub Actions workflow.
   - Enforce CI status checks: PRs and pushes to `main` MUST be blocked if the coverage ratchet or security/health checks fail.
   - Introduce E2E Playwright jobs for both the VS Code Extension (`docuvia-vscode`) and the Web UI (`kg-engine`).

## Consequences

- **Positive**: Higher reliability, fewer regressions, deterministic quality metrics, and better developer confidence when agents refactor code.
- **Negative**: Increased initial overhead for developers and AI agents to write tests for UI components and maintain the strict coverage ratchet. Slower CI pipelines due to the addition of security and code health checks.
