# Docuvia Testcase Roadmap

This roadmap outlines the strategy and execution plan for building a robust, behavior-driven testing framework for Docuvia.

## 1. Architectural Decisions (Approved)
- **Test Runner**: Vitest
- **Database Isolation**: Real PostgreSQL with Transaction Rollback (beforeEach/afterEach).
- **External Dependencies**: Network Interception via `msw` (Mock Service Worker) for APIs like OpenAI and GitHub.
- **Directory Structure (Hybrid)**:
  - **Unit Tests**: Colocated with source code (e.g., `src/lib/parser.unit.test.ts`).
  - **Integration Tests**: Placed in `test/integration/` per package (e.g., `artifacts/api-server/test/integration/ingest.int.test.ts`).
- **Agent Navigation**: Enforced path mapping conventions documented in `AGENTS.md`.

## 2. Infrastructure Setup (Pending)
- [ ] Delete legacy `test/` directory (Feature Contract scripts).
- [ ] Install `supertest`, `@types/supertest`, `msw`.
- [ ] Configure `vitest.config.ts` with global setup files.
- [ ] Implement DB transaction rollback helper.
- [ ] Implement MSW setup and base handlers.
- [ ] Update `AGENTS.md` and `.github/copilot-instructions.md`.

## 3. Test Data & I/O Management (Approved)
- **Strategy**: Hybrid Data Management
  - **External API Mocks (MSW)**: Use static fixtures (JSON files) for large, rigid external responses (e.g., GitHub Commit lists, raw OpenAI responses).
  - **Internal State (DB, Requests)**: Use the **Factory Pattern** to dynamically generate specific states needed for a test (`ProjectFactory.build({ overrides })`).
- **AI Automated Fuzzing / Property-Based Testing**: 
  - Factories must be designed to support randomized dynamic generation (fuzzing) when driven by an AI Agent.
  - The AI Agent can read the schema/contract and use factories to generate randomized valid/invalid inputs for robust boundary testing.
  - Assertions should validate against rule sets/properties rather than hardcoded outputs when random mode is engaged.

## 4. Code Coverage Strategy (Approved)
- **Strategy**: Module-Specific Thresholds + AI-Assisted PR Checks
- **Rules**:
  - High thresholds (e.g., 90%+) for pure business logic and algorithms (`lib/*`, parser logic).
  - Lenient or informational thresholds for UI (`kg-engine`) and external service glue code.
- **Workflow Integration**: 
  - CI generates a coverage report.
  - The `Task Verifier` Agent reads the coverage report specifically looking at the `git diff` boundaries. If newly added logic branches are not covered, the Agent will flag it or automatically generate the missing boundary tests.

## 5. Execution Pipeline
- [ ] **Tracer Bullet**: Implement the first vertical slice integration test (e.g., `GET /mcp/list_projects`).
- [ ] **Core Coverage**: Write tests for essential Git Ingestion and Knowledge Generation pipelines.
- [ ] **CI Integration**: Hook Vitest and Coverage reports into `.github/workflows/ci.yml`.
