# Docuvia — Software Architecture & Design Documentation

> Universal VCS Knowledge Graph Engine: ingest commit history, construct a three-tier knowledge graph, and expose it via REST, MCP, and VS Code UI.

## About This Documentation

This suite documents the **post-implementation architecture** of Docuvia v1.0. It follows the [arc42](https://arc42.org/) structure (sections 1–12), adapted for a TypeScript monorepo. All 42 planned roadmap items are complete at the time of writing.

This is the authoritative design record for engineers joining the project, AI agents requiring architectural context, and operators deploying the system.

---

## Documentation Index

| #   | Document                                                                         | Description                                       |
| --- | -------------------------------------------------------------------------------- | ------------------------------------------------- |
| —   | [00-architecture-index.md](00-architecture-index.md)                             | Master index (this file)                          |
| 1   | [01-introduction-and-goals.md](01-introduction-and-goals.md)                     | Vision, quality goals, stakeholders               |
| 2   | [02-constraints.md](02-constraints.md)                                           | Technical, org, regulatory constraints            |
| 3   | [03-context-and-scope.md](03-context-and-scope.md)                               | System boundary, external interfaces              |
| 4   | [04-solution-strategy.md](04-solution-strategy.md)                               | Key technology choices and rationale              |
| 5   | [05-building-blocks.md](05-building-blocks.md)                                   | Monorepo packages, module responsibilities        |
| 6   | [06-runtime-scenarios.md](06-runtime-scenarios.md)                               | Key runtime flows (ingest, generate, query)       |
| 7   | [07-deployment.md](07-deployment.md)                                             | Deployment topology, environments                 |
| 8   | [08-crosscutting-concepts.md](08-crosscutting-concepts.md)                       | Domain model, architecture patterns, Coding Rules |
| 9   | [09-architectural-decisions.md](09-architectural-decisions.md)                   | ADR index + key decisions                         |
| 10  | [10-quality-requirements.md](10-quality-requirements.md)                         | Quality goals, NFRs, performance targets          |
| 11  | [11-risks-and-debt.md](11-risks-and-debt.md)                                     | Known gaps and technical debt                     |
| 12  | [12-glossary.md](12-glossary.md)                                                 | Full product terminology                          |
| 13  | [13-vision-and-competitive-landscape.md](13-vision-and-competitive-landscape.md) | Vision and competitive landscape                  |

---

## High-Level Mechanisms (ADRs)

The detailed Agentic OS mechanisms are codified as Architecture Decision Records (ADRs) under `adrs/`:

| ADR       | Mechanism                                                                                                                        |
| :-------- | :------------------------------------------------------------------------------------------------------------------------------- |
| `ADR-001` | [VS Code Client Onboarding](adrs/ADR-001-vscode-client-onboarding.md)                                                            |
| `ADR-002` | [Local-First Architecture](adrs/ADR-002-local-first-architecture.md)                                                             |
| `ADR-003` | [Server-Side Zero-to-One](adrs/ADR-003-server-side-zero-to-one.md)                                                               |
| `ADR-004` | [Git-Isomorphic Graph](adrs/ADR-004-git-isomorphic-graph.md)                                                                     |
| `ADR-005` | [Knowledge Abstraction Strategy](adrs/ADR-005-knowledge-abstraction-strategy.md)                                                 |
| `ADR-006` | [Self-Evolution Architecture](adrs/ADR-006-self-evolution-architecture.md)                                                       |
| `ADR-007` | [Agentic RAG Routing](adrs/ADR-007-agentic-rag-routing.md)                                                                       |
| `ADR-008` | [Asynchronous Metabolism](adrs/ADR-008-asynchronous-metabolism.md)                                                               |
| `ADR-009` | [Token Management](adrs/ADR-009-token-management.md)                                                                             |
| `ADR-010` | [Context Compression & Proxy](adrs/ADR-010-context-compression-and-proxy.md)                                                     |
| `ADR-011` | [Two-Phase Knowledge Validity](adrs/ADR-011-two-phase-knowledge-validity.md)                                                     |
| `ADR-012` | [Document Misc Pool](adrs/ADR-012-document-misc-pool.md)                                                                         |
| `ADR-013` | [Adversarial Implementation Protocol](adrs/ADR-013-adversarial-implementation-protocol.md)                                       |
| `ADR-014` | [SQL-Indexed Graph and Database-as-IPC](adrs/ADR-014-sql-indexed-graph-and-database-as-ipc.md)                                   |
| `ADR-015` | [Progressive Enrichment & AST/LSP Dual Engine](adrs/ADR-015-progressive-enrichment-and-ast-lsp-dual-engine.md)                   |
| `ADR-016` | [Git Blob-Native Identity & Checkout Thrashing Defense](adrs/ADR-016-git-blob-native-identity-and-checkout-thrashing-defense.md) |
| `ADR-017` | [Tiered Storage & Orphan Branch Graph Maintenance](adrs/ADR-017-tiered-storage-and-orphan-branch-graph-maintenance.md)           |
| `ADR-018` | [Temporal & Conceptual Bidirectional Linking](adrs/ADR-018-temporal-and-conceptual-bidirectional-linking.md)                     |

---

## VS Code Extension Design (Supplementary)

The VS Code extension has its own detailed design documentation under [`docs/design/vscode-client/`](vscode-client/). See the authoritative [VS Code Roadmap](../roadmap/vscode-roadmap.md) for the implementation standards and [00-router-overview.md](vscode-client/00-router-overview.md) for the component structure.

- **Routing & Core:**
  - [00-router-overview.md](vscode-client/00-router-overview.md) — Extension routing architecture (authoritative)
  - [knowledge-graph/store.md](vscode-client/knowledge-graph/store.md) — Core Concepts: KnowledgeStore
- **Command Palette Flows:**
  - [command-palette/init-project.md](vscode-client/command-palette/init-project.md) — Init Project workflow
  - [command-palette/add-decision.md](vscode-client/command-palette/add-decision.md) — Add Decision workflow
  - [command-palette/run-extraction.md](vscode-client/command-palette/run-extraction.md) — Run Extraction workflow
  - [command-palette/search.md](vscode-client/command-palette/search.md) — Cross-Project Search workflow
- **Chat Participant:**
  - [chat-participant/slash-commands.md](vscode-client/chat-participant/slash-commands.md) — Chat Participant: @docuvia
- **Knowledge Graph View:**
  - [knowledge-graph/init-action.md](vscode-client/knowledge-graph/init-action.md) — Initialization & Onboarding
  - [knowledge-graph/nodes.md](vscode-client/knowledge-graph/nodes.md) — Tree Nodes & Structure
- **UI/UX & Config:**
  - [configuration/settings.md](vscode-client/configuration/settings.md) — Docuvia Configuration Settings
  - [ui-ux/user-journeys.md](vscode-client/ui-ux/user-journeys.md) — User Journeys & Scenarios
  - [ui-ux/editor-integration.md](vscode-client/ui-ux/editor-integration.md) — Editor Integration (CodeLens/Hover)
  - [ui-ux/notifications-and-prompts.md](vscode-client/ui-ux/notifications-and-prompts.md) — Notifications & Prompts
  - [ui-ux/webview-panels.md](vscode-client/ui-ux/webview-panels.md) — Webview Panels

---

## Related Documents

| Document                                                       | Purpose                                                       |
| -------------------------------------------------------------- | ------------------------------------------------------------- |
| [docs/roadmap/master-roadmap.md](../roadmap/master-roadmap.md) | Single Source of Truth (SSOT) tracking all development phases |
| [AGENTS.md](../../AGENTS.md)                                   | AI developer guide — commands, conventions, agent definitions |
| `ADR-019` | [PostgreSQL pgvector Migration](adrs/ADR-019-pgvector-migration.md)                                                                |
| `ADR-020` | [Unified Isomorphic AST Microkernel](adrs/ADR-020-unified-isomorphic-ast-microkernel.md)                                           |
