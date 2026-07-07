# Quality Gates & Local Workflow Implementation Plan

- **Status**: ⏳ Todo
- **Phase**: Phase 7: Strict Test Framework & Quality Gates
- **Evidence / Verification Target**: `AGENTS.md`, `.husky/pre-commit`, `.husky/pre-push`, `.codescene-thresholds`, `.github/workflows/ci.yml`
- **Related Roadmap Docs**:
  - `phase-7-test-framework-quality-gates.md`
  - `quality-gates-ratchet-system.md`
  - `workflow-formalization.md`

## Goal

Create an operational implementation plan for Phase 7 that turns Docuvia's current roadmap into concrete, enforceable quality gates and local workflow rules.

## Implementation Plan

### 1. Enforce Code Health and Security Gates

- [ ] Add a workspace-level ratchet configuration file for code health checks.
  - Prefer `.codescene-thresholds` or equivalent file.
  - Track Hotspot and Average Code Health targets.
- [ ] Wire CodeScene health checks into GitHub Actions.
  - Ensure the gate fails when quality drops below target.
- [ ] Integrate Codacy security scans into GitHub Actions.
  - Ensure the gate fails on Critical/High findings.

### 2. Formalize Coverage Ratchet Enforcement

- [ ] Confirm and enforce backend coverage `>= 85%`.
- [ ] Confirm and enforce frontend coverage `>= 70%`.
- [ ] Update CI to fail on coverage regression.
- [ ] Add explicit coverage upload or reporting step as needed.

### 3. Strengthen Local Git Hook Policy

- [ ] Add a `.husky/pre-push` hook that runs the critical verification commands before pushing.
- [ ] Extend `.husky/pre-commit` beyond lint-staged if necessary.
- [ ] Document the expected local gate behavior in `AGENTS.md`.

### 4. Improve CI Pipeline and Workflow Formalization

- [ ] Refactor `.github/workflows/ci.yml` to clearly separate: lint/security, typecheck/build, smoke, regression, and e2e lanes.
- [ ] Add documentation-check or docs gating if applicable.
- [ ] Ensure the CI job names and failure conditions match the roadmap.

### 5. Document Team and AI Developer Expectations

- [ ] Update `AGENTS.md` with a Phase 7 workflow checklist.
- [ ] Include mandatory TDD and quality-gate compliance language.
- [ ] Add a small developer guidance section for local pre-push validation.

## Verification

- [ ] `pnpm test:smoke` passes.
- [ ] `pnpm test:coverage` passes with ratcheted thresholds.
- [ ] GitHub Actions CI runs include the new code health and security gates.
- [ ] Local commit and push hooks operate and block when a gate fails.

## Notes

- This plan should be implemented incrementally in Phase 7.
- If CodeScene cannot be enabled immediately, replace with a clear equivalent and document the alternate tool.
