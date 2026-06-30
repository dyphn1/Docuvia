# Conventions & Best Practices

## Project Management & Documentation

- **Roadmap-Design Alignment**: The project roadmap (`docs/roadmap-checklist.md`) must structurally map to the design documents (`docs/design/*.md`). Organize roadmap categories to mirror architecture/design concepts (e.g., "Local-First Architecture", "Agentic RAG Routing") to maintain clear traceability between implementation tasks and architectural intent.
- **ADR Standards**: All Architecture Decision Records (ADRs) must contain consistent header metadata (e.g., `Supersedes`, `Status`, `Date`) and should utilize Mermaid diagrams where applicable to visualize system state or architectural flow.
- **Link Integrity**: Refactoring often breaks relative links in Markdown roadmaps and documentation. Always verify and update broken relative links as part of the documentation consistency check during architectural shifts.

## Testing & Automation

- **3A Pattern**: All unit and integration tests must strictly follow the Arrange-Act-Assert (3A) pattern to ensure clarity, predictability, and maintainability.
- **Failure Path Mocking**: Ensure application resilience by thoroughly testing failure conditions. Use MSW to explicitly mock 4xx and 5xx API failure responses (sad paths) during frontend and integration test execution.
- **DB Test Factory Pattern**: Integration tests should rely on shared database factories (e.g., `CommitFactory`, `DocumentFactory` in `artifacts/api-server/test/support/factories.ts`). This allows deterministic seeding of testing states without duplicating mock objects across suites.

## Frontend & API

- **API-First Enforcement**: Never use manual `fetch()` API calls in the frontend UI. Always utilize the auto-generated Orval React Query hooks (`@workspace/api-client-react`) derived directly from the OpenAPI specification to maintain strict type safety and a single source of truth.

## Database & ORM

- **Explicit Database Indexes**: Always define explicit indexes (using Drizzle's `index()`) for frequently queried fields and foreign keys in database schemas to prevent full table scans and `CASCADE DELETE` performance bottlenecks.
- **Database Transaction Wrappers**: Wrap multi-step database mutations (e.g., generation combined with insertion) inside a transaction block (`await db.transaction(async (tx) => { ... })`). Ensure the transaction object `tx` is explicitly passed down to all nested queries to guarantee atomicity.
