# GitHub Actions CI Pipeline Refactoring

- **Status**: ⏳ Todo
- **Phase**: Phase 7: Strict Test Framework & Quality Gates
- **Evidence / Verification Target**: `.github/workflows/ci.yml`
- **ADR**: [ADR-033](../../adr/ADR-033-strict-test-framework-and-quality-gates.md)

## Implementation Details

Overhaul the GitHub Actions pipeline to natively execute parallel test lanes, E2E jobs, and hard-blocking quality/security gates.

### Implementation Tasks

- [x] Update `.github/workflows/ci.yml` to support split `smoke` and `regression` parallel jobs.
- [x] Ensure `Playwright` E2E test runs (for VS Code client and Web UI) are executed natively within the CI pipeline.
- [x] Incorporate automated checks for CodeScene and Codacy inside the CI pipeline, acting as hard blockers for PRs targeting `main`.
- [x] Enforce the code coverage ratchet within the CI coverage step (failing the job if under 85% / 70%).
