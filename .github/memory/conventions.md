# Conventions & Best Practices

## Coding Standards & Guidelines

To maintain codebase health, all agents and developers must adhere to the core guidelines detailed in the `docs/gitbook/guidelines/` directory. **You MUST read the relevant documents in `docs/gitbook/guidelines/` before starting implementation.**

- **[01-typescript-react-style.md](../../docs/gitbook/guidelines/01-typescript-react-style.md)**: Naming conventions (kebab-case vs PascalCase) and React component rules.
- **[02-architecture-mvc.md](../../docs/gitbook/guidelines/02-architecture-mvc.md)**: Strict MVC boundaries and placing shared logic in `lib/`.
- **[03-pop-and-srp.md](../../docs/gitbook/guidelines/03-pop-and-srp.md)**: Protocol-Oriented Programming, depending on abstractions, and Single Responsibility Principle.
- **[04-clean-code.md](../../docs/gitbook/guidelines/04-clean-code.md)**: DRY principle, avoiding duplicated logic, centralized constants, and defensive programming.
- **[05-tdd-and-testing.md](../../docs/gitbook/guidelines/05-tdd-and-testing.md)**: Red-Green-Refactor workflow and testing standards.
- **[06-sre-and-reliability.md](../../docs/gitbook/guidelines/06-sre-and-reliability.md)**: Monitoring, circuit breakers, rate limiting, and zero-downtime deployments.

## Project Management & Documentation

- **Roadmap-Design Alignment**: The project roadmap (`docs/gitbook/roadmap/README.md`) must structurally map to the design documents (`docs/gitbook/architecture/*.md`). Organize roadmap categories to mirror architecture/design concepts (e.g., "Local-First Architecture", "Agentic RAG Routing") to maintain clear traceability between implementation tasks and architectural intent.
- **ADR Standards**: All Architecture Decision Records (ADRs) must contain consistent header metadata (e.g., `Supersedes`, `Status`, `Date`) and should utilize Mermaid diagrams where applicable to visualize system state or architectural flow.
- **Link Integrity**: Refactoring often breaks relative links in Markdown roadmaps and documentation. Always verify and update broken relative links as part of the documentation consistency check during architectural shifts.

## Testing & Automation

- **3A Pattern**: All unit and integration tests must strictly follow the Arrange-Act-Assert (3A) pattern to ensure clarity, predictability, and maintainability.
- **Worker Thread Testability**: Never write business logic directly inside `worker_threads` entry points. By delegating to a separate module (e.g., `ast-ingestion-task.ts`), business logic can be unit-tested directly in the main thread context without requiring complex worker mocking.
- **Failure Path Mocking**: Ensure application resilience by thoroughly testing failure conditions. Use MSW to explicitly mock 4xx and 5xx API failure responses (sad paths) during frontend and integration test execution.
- **DB Test Factory Pattern**: Integration tests should rely on shared database factories (e.g., `CommitFactory`, `DocumentFactory` in `artifacts/api-server/test/support/factories.ts`). This allows deterministic seeding of testing states without duplicating mock objects across suites.

## Frontend & API

- **Component Colocation (SRP)**: Complex frontend pages (e.g., `ProjectDetail.tsx`, `Integrations.tsx`, `Pipeline.tsx`, `PullRequests.tsx`, `Review.tsx`) must avoid becoming monolithic by extracting feature-specific elements (like L2 directory logic, commits, header logic, list views, detail views, statistics/stats cards, configuration forms, and dialogs) into a colocated `components/` subdirectory (e.g., `pages/projects/components/`, `pages/integrations/components/`, `pages/pipeline/components/`, `pages/pull-requests/components/`, `pages/review/components/`).
- **API-First Enforcement**: Never use manual `fetch()` API calls in the frontend UI. Always utilize the auto-generated Orval React Query hooks (`@workspace/api-client-react`) derived directly from the OpenAPI specification to maintain strict type safety and a single source of truth.

## Database & ORM

- **Explicit Database Indexes**: Always define explicit indexes (using Drizzle's `index()`) for frequently queried fields and foreign keys in database schemas to prevent full table scans and `CASCADE DELETE` performance bottlenecks.
- **Database Transaction Wrappers**: Wrap multi-step database mutations (e.g., generation combined with insertion) inside a transaction block (`await db.transaction(async (tx) => { ... })`). Ensure the transaction object `tx` is explicitly passed down to all nested queries to guarantee atomicity.
