# Frontend Test Infrastructure

- **Status**: ⏳ Todo
- **Phase**: Phase 7: Strict Test Framework & Quality Gates
- **Evidence / Verification Target**: `artifacts/kg-engine/vitest.config.ts`, `artifacts/kg-engine/tests/`
- **ADR**: [ADR-033](../../adr/ADR-033-strict-test-framework-and-quality-gates.md)

## Implementation Details

Establish a robust testing foundation for the `@workspace/kg-engine` React frontend to prevent UI regressions and ensure component reliability.

### Implementation Tasks

- [x] Configure Vitest and React Testing Library for `@workspace/kg-engine`.
- [x] Write unit tests for core hooks (e.g., intent-router integration) and UI components (e.g., `UploadTab`, `MiscPoolTab`).
- [x] Add a Playwright suite specifically for the Web UI.
