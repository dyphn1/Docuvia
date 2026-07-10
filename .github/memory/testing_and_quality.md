# Testing Navigation & Quality Gates

> **ADR-033 Enforcement**: Red-Green-Refactor TDD is mandatory. Before committing, ensure your code passes CodeScene/Codacy checks.

## Test Boundaries

- Unit tests are colocated with source files as `*.unit.test.ts`.
- Package integration tests live under `artifacts/<package>/test/integration/`.
- API integration tests should use `supertest`, factories from `artifacts/api-server/test/support/factories.ts`, and `withRollback(...)` from `artifacts/api-server/test/support/db.ts`.
- Mock external HTTP calls through MSW handlers in `artifacts/api-server/test/setup/msw/handlers.ts`; put large static payloads in `artifacts/api-server/test/setup/msw/fixtures/`.

## Quality Gates & Lanes

- Use `pnpm run test:smoke` to run fast critical path tests (< 5 minutes).
- Run `pnpm test` for the normal suite.
- Run `pnpm run test:coverage` to ensure Backend ≥ 85% and Frontend ≥ 70%.

## CI Pipeline Sequence

The CI pipeline runs this exact sequence (replicate locally when making cross-package changes):

1. **Lint & Code Health**: `pnpm run lint`, CodeScene Hotspot check, and Codacy security scan.
2. **Build**: `pnpm --filter @workspace/api-spec run codegen` -> `pnpm run typecheck` -> `pnpm -r --if-present run build`.
3. **Database**: `pnpm --filter @workspace/db run push` (to a real PostgreSQL instance).
4. **Smoke & E2E**: `pnpm run test:smoke` and Playwright suites for `@workspace/kg-engine` and `docuvia-vscode`.
5. **Coverage Ratchet**: `pnpm run test:coverage` (Fails if Backend < 85% or Frontend < 70%).
