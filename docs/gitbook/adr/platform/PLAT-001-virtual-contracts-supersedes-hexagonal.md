---
id: PLAT-001
title: Virtual Contracts Supersedes Hexagonal Architecture
status: accepted
date: 2026-07-12
domains: [platform]
supersedes: [legacy/ADR-021]
superseded_by: []
---

# Virtual Contracts Supersedes Hexagonal Architecture

## Context

Previously, Docuvia utilized a Shared Core API and Presentation Layers architecture (Hexagonal Architecture) (ADR-021) to isolate UI from business logic. However, as the system grew, tight coupling still emerged between internal modules (e.g., `lib/schema` depending on `lib/ast-core`), making testing and swapping implementations difficult. The lack of strict isolation in state management also complicated multi-tenancy and testing.

## Decision

We replace the Hexagonal Architecture with the stricter **Virtual Contracts Architecture**.

1. **Interfaces First**: All implementations must map to interfaces defined in `lib/contracts`. Cross-importing between implementation libraries is strictly forbidden.
2. **Factory Registration**: Implementations self-register to `docuviaFactory`.
3. **Transient Instantiation**: Implementations do not manage their own lifecycles. They are instantiated transiently by the Orchestration layer (`lib/ui-core`).
4. **Isolated Config**: Implementations rely on `docuviaMemory` with UUID scoping for configuration and do not read `process.env`.
5. **Strict Error Handling**: All errors must be wrapped in `DocuviaError` and thrown upwards. Only the Presentation layer logs final errors.

## Consequences

- **Positive**: Complete decoupling of implementation libraries. Simplified mocking for tests. Safe multi-tenant state isolation.
- **Negative**: Increased boilerplate (defining interfaces for everything). Steeper learning curve for new developers. Dropped simpler DI containers in favor of strict Factory Lock.
