# Docuvia — Software Architecture & Design Documentation

> Universal VCS Knowledge Graph Engine: ingest commit history, construct a three-tier knowledge graph, and expose it via REST, MCP, and VS Code UI.

## About This Documentation

This suite documents the **post-implementation architecture** of Docuvia v1.0. It follows the [arc42](https://arc42.org/) structure (sections 1–12), adapted for a TypeScript monorepo. All 42 planned roadmap items are complete at the time of writing.

This is the authoritative design record for engineers joining the project, AI agents requiring architectural context, and operators deploying the system.

---

## Documentation Index

| #   | Document                                                       | Description                                       |
| --- | -------------------------------------------------------------- | ------------------------------------------------- |
| —   | [00-architecture-index.md](00-architecture-index.md)           | Master index (this file)                          |
| 1   | [01-introduction-and-goals.md](01-introduction-and-goals.md)   | Vision, quality goals, stakeholders               |
| 2   | [02-constraints.md](02-constraints.md)                         | Technical, org, regulatory constraints            |
| 3   | [03-context-and-scope.md](03-context-and-scope.md)             | System boundary, external interfaces              |
| 4   | [04-solution-strategy.md](04-solution-strategy.md)             | Key technology choices and rationale              |
| 5   | [05-building-blocks.md](05-building-blocks.md)                 | Monorepo packages, module responsibilities        |
| 6   | [06-runtime-scenarios.md](06-runtime-scenarios.md)             | Key runtime flows (ingest, generate, query)       |
| 7   | [07-deployment.md](07-deployment.md)                           | Deployment topology, environments                 |
| 8   | [08-crosscutting-concepts.md](08-crosscutting-concepts.md)     | Domain model, architecture patterns, Coding Rules |
| 9   | [09-architectural-decisions.md](09-architectural-decisions.md) | ADR index + key decisions                         |
| 10  | [10-quality-requirements.md](10-quality-requirements.md)       | Quality goals, NFRs, performance targets          |
| 11  | [11-risks-and-debt.md](11-risks-and-debt.md)                   | Known gaps and technical debt                     |
| 12  | [12-glossary.md](12-glossary.md)                               | Full product terminology                          |

---

## High-Level Mechanisms (ADRs)

The detailed Agentic OS mechanisms are codified as Architecture Decision Records (ADRs) under `adrs/`:

| ADR | Mechanism |
| :-- | :-- |
| `ADR-001` | [VS Code Client Onboarding](adrs/ADR-001-vscode-client-onboarding.md) |
| `ADR-002` | [Local-First Architecture](adrs/ADR-002-local-first-architecture.md) |
| `ADR-003` | [Server-Side Zero-to-One](adrs/ADR-003-server-side-zero-to-one.md) |
| `ADR-004` | [Git-Isomorphic Graph](adrs/ADR-004-git-isomorphic-graph.md) |
| `ADR-005` | [Knowledge Abstraction Strategy](adrs/ADR-005-knowledge-abstraction-strategy.md) |
| `ADR-006` | [Self-Evolution Architecture](adrs/ADR-006-self-evolution-architecture.md) |
| `ADR-007` | [Agentic RAG Routing](adrs/ADR-007-agentic-rag-routing.md) |
| `ADR-008` | [Asynchronous Metabolism](adrs/ADR-008-asynchronous-metabolism.md) |
| `ADR-009` | [Token Management](adrs/ADR-009-token-management.md) |

---

## VS Code Extension Design (Supplementary)

The VS Code extension has its own detailed design documentation under [`artifacts/vscode-client/design/`](../../artifacts/vscode-client/design/):

- [00-router-overview.md](../../artifacts/vscode-client/design/00-router-overview.md) — Extension routing architecture (authoritative)
- [chat-participant/slash-commands.md](../../artifacts/vscode-client/design/chat-participant/slash-commands.md)
- [command-palette/run-extraction.md](../../artifacts/vscode-client/design/command-palette/run-extraction.md)
- [knowledge-graph/store.md](../../artifacts/vscode-client/design/knowledge-graph/store.md)
- [ui-ux/user-journeys.md](../../artifacts/vscode-client/design/ui-ux/user-journeys.md)

---

## Related Documents

| Document                                                           | Purpose                                                       |
| ------------------------------------------------------------------ | ------------------------------------------------------------- |
| [docs/roadmap/master-roadmap.md](../roadmap/master-roadmap.md)     | Single Source of Truth (SSOT) tracking all development phases |
| [AGENTS.md](../../AGENTS.md)                                       | AI developer guide — commands, conventions, agent definitions |
