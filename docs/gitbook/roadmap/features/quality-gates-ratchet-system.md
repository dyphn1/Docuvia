# Quality Gates & Ratchet System

- **Status**: ⏳ Todo
- **Phase**: Phase 7: Strict Test Framework & Quality Gates
- **Evidence / Verification Target**: `.codescene-thresholds`, `.github/workflows/ci.yml`
- **ADR**: [ADR-033](../../adr/ADR-033-strict-test-framework-and-quality-gates.md)

## Implementation Details

Implement automated quality thresholds that prevent deteriorating code health and declining test coverage from being merged.

### Implementation Tasks

- [ ] Introduce a `.codescene-thresholds` (or equivalent SonarQube/Codacy config) file at the workspace root to track Hotspot and Average Code Health.
- [ ] Establish a test coverage ratchet: backend ≥ 85%, frontend ≥ 70%. Configure CI to block merges if coverage drops.
- [ ] Integrate Codacy security scan into the GitHub Actions CI pipeline.
