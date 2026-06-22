# Conventions & Best Practices

## Project Management & Documentation

- **Roadmap-Design Alignment**: The project roadmap (`docs/roadmap-checklist.md`) must structurally map to the design documents (`docs/design/*.md`). Organize roadmap categories to mirror architecture/design concepts (e.g., "Local-First Architecture", "Agentic RAG Routing") to maintain clear traceability between implementation tasks and architectural intent.

## Testing & Automation

- **DB Test Factory Pattern**: Integration tests should rely on shared database factories (e.g., `CommitFactory`, `DocumentFactory` in `artifacts/api-server/test/support/factories.ts`). This allows deterministic seeding of testing states without duplicating mock objects across suites.
