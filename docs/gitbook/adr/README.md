# Architectural Decision Records

This section holds Docuvia's ADRs — one file per decision, covering the current architecture (local-first design, git-isomorphic graph, agentic RAG routing, AST microkernel, and more).

## Full ADR Index

| ADR                                                                           | Title                                                            |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| [ADR-001](ADR-001-vscode-client-onboarding.md)                                | VS Code Client Onboarding & Scope Discovery                      |
| [ADR-002](ADR-002-local-first-architecture.md)                                | Local-First Architecture & Graceful Server Degradation           |
| [ADR-003](ADR-003-server-side-zero-to-one.md)                                 | API Server: 0-to-1 Handshake & Multi-tenant Synchronization      |
| [ADR-004](ADR-004-git-isomorphic-graph.md)                                    | Git-Isomorphic Knowledge Graph (Incremental Deltas)              |
| [ADR-005](ADR-005-knowledge-abstraction-strategy.md)                          | Knowledge Abstraction & Architecture Recovery (L3 → L2)          |
| [ADR-006](ADR-006-self-evolution-architecture.md)                             | Self-Evolution & Swarm Intelligence                              |
| [ADR-007](ADR-007-agentic-rag-routing.md)                                     | Agentic RAG 4-Way Routing & Temporal Decay                       |
| [ADR-008](ADR-008-asynchronous-metabolism.md)                                 | Asynchronous Metabolism (Database-Driven Queue)                  |
| [ADR-009](ADR-009-token-management.md)                                        | Token Management & Extraction Efficiency                         |
| [ADR-010](ADR-010-context-compression-and-proxy.md)                           | Context Compression & Proxy Layer                                |
| [ADR-011](ADR-011-two-phase-knowledge-validity.md)                            | Two-Phase Knowledge Validity                                     |
| [ADR-012](ADR-012-document-misc-pool.md)                                      | Document Misc Pool for Unaffiliated Documents                    |
| [ADR-013](ADR-013-adversarial-implementation-protocol.md)                     | Adversarial Implementation Protocol (Team Falsification)         |
| [ADR-014](ADR-014-sql-indexed-graph-and-database-as-ipc.md)                   | SQL-Indexed Graph and Database-as-IPC                            |
| [ADR-015](ADR-015-progressive-enrichment-and-ast-lsp-dual-engine.md)          | Progressive Enrichment & AST/LSP Dual Engine                     |
| [ADR-016](ADR-016-git-blob-native-identity-and-checkout-thrashing-defense.md) | Git Blob-Native Identity & Checkout Thrashing Defense            |
| [ADR-017](ADR-017-tiered-storage-and-orphan-branch-graph-maintenance.md)      | Tiered Storage & Orphan Branch Graph Maintenance                 |
| [ADR-018](ADR-018-temporal-and-conceptual-bidirectional-linking.md)           | Temporal & Conceptual Bidirectional Linking                      |
| [ADR-019](ADR-019-pgvector-migration.md)                                      | PostgreSQL pgvector Migration for Similarity Search              |
| [ADR-020](ADR-020-unified-isomorphic-ast-microkernel.md)                      | Unified Isomorphic AST Microkernel                               |
| [ADR-021](ADR-021-shared-core-api-and-presentation-layers.md)                 | Shared Core API and Presentation Layers (Hexagonal Architecture) |
| [ADR-022](ADR-022-wasm-ast-blast-radius.md)                                   | WebAssembly AST for Git-Native Smart Blast Radius                |
| [ADR-023](ADR-023-granular-markdown-storage.md)                               | JSONL + Granular Markdown for Git-Native Storage                 |
| [ADR-024](ADR-024-cross-project-soft-linking.md)                              | Cross-Project Soft Linking via Global L1 Tags                    |
| [ADR-025](ADR-025-hybrid-temp-file-blast-radius.md)                           | Hybrid Temp-File Blast Radius Overlay & Headless LSP             |
| [ADR-026](ADR-026-multi-provider-llm-abstraction.md)                          | Multi-Provider LLM Abstraction Layer                             |

> **Note:** The legacy decision log (originally arc42 chapter 9) has been archived and removed from this page to prevent numbering conflicts with the modern ADR list above. Concepts from the legacy log (e.g. OpenAI-only LLM interface, MVC UI layers, review-queue gating, cursor-based incremental ingestion, L3 deduplication, L2 bootstrap, Orphan Git Branch) have all been superseded or subsumed by the numbered ADRs above (see in particular ADR-004 through ADR-012, ADR-019, ADR-021, and ADR-026) and by the corresponding system architecture pages.
