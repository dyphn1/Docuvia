# Test Lane Segregation

- **Status**: ⏳ Todo
- **Phase**: Phase 7: Strict Test Framework & Quality Gates
- **Evidence / Verification Target**: `package.json` (`test:smoke`, `test`)
- **ADR**: [ADR-033](../../adr/ADR-033-strict-test-framework-and-quality-gates.md)

## Implementation Details

Separate testing into distinct lanes to provide rapid developer feedback (`smoke`) while maintaining comprehensive safety (`regression`).

### Implementation Tasks

- [ ] Define and implement `pnpm run test:smoke`. Curate critical tests (AST extraction, DB init, VS Code welcome view) into this suite. Ensure execution time is under 5 minutes.
- [ ] Refactor existing `pnpm test` to serve as the comprehensive regression lane.
