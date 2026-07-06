# Table of contents

- [Docuvia Docs](README.md)
  - [Vision & Competitive Landscape](comparisons/README.md)

## 🚀 Getting Started

- [Installation](getting-started/installation.md)
- [Quick Start](getting-started/quick-start.md)

## 📖 User Guide

- [VS Code Extension](user-guide/vscode-client.md)
- [CLI Commands](user-guide/cli.md)
  - [init](user-guide/cli/init.md)
  - [status](user-guide/cli/status.md)
  - [clean](user-guide/cli/clean.md)
  - [analyze](user-guide/cli/analyze.md)
  - [extract](user-guide/cli/extract.md)
  - [detect-changes](user-guide/cli/detect-changes.md)
  - [query](user-guide/cli/query.md)
  - [sync](user-guide/cli/sync.md)
  - [init-agent](user-guide/cli/init-agent.md)
  - [mcp](user-guide/cli/mcp.md)
- [Configuration](user-guide/configuration.md)

## 💡 Concepts

- [Agentic RAG](comparisons/agentic-rag.md)
- [AST & Semantic Graph](comparisons/ast-semantic-graph.md)
- [MCP AI Interfaces](comparisons/mcp-ai-interfaces.md)
- [IDE & VS Code Client](comparisons/ide-vscode-client.md)
- [Data Pipeline & Sync](comparisons/data-pipeline-sync.md)
- [CLI & Core API Parity](comparisons/cli-core-api.md)

---

## 🛠️ Developer Guide

- [Local Setup & Dev Materials](development/README.md)
  - [Capabilities Matrix](development/capabilities-matrix.md)
  - [Refactoring Plan](development/refactoring-plan.md)
- [Engineering Patterns](development/patterns/README.md)
  - [API-First & Codegen](development/patterns/api-codegen-pipeline.md)
  - [AST Semantic Diff (WASM)](development/patterns/wasm-ast-blast-radius.md)
  - [Progressive Enrichment (AST+LSP)](development/patterns/progressive-enrichment.md)
- [Packages Overview](packages/README.md)
  - [CLI](packages/cli.md)
  - [API Server](packages/api-server.md)
  - [KG Engine](packages/kg-engine.md)
  - [Mockup Sandbox](packages/mockup-sandbox.md)
  - [VS Code Client](packages/vscode-client.md)
- [Coding Guidelines](guidelines/README.md)
  - [TypeScript & React Style](guidelines/typescript-react-style.md)
  - [Architecture & MVC](guidelines/architecture-mvc.md)
  - [POP & SRP](guidelines/pop-and-srp.md)
  - [Clean Code & DRY](guidelines/clean-code.md)
  - [TDD & Testing](guidelines/tdd-and-testing.md)
  - [SRE & Reliability](guidelines/sre-and-reliability.md)
  - [Regression & Parity Testing](guidelines/regression-and-parity-testing.md)
  - [Playbook Standard](guidelines/playbook-standard.md)

## 📐 System Architecture

- [Introduction & Goals](architecture/README.md)
- [Constraints](architecture/constraints.md)
- [Context & Scope](architecture/context-and-scope.md)
- [Solution Strategy](architecture/solution-strategy.md)
- [Building Blocks](architecture/building-blocks.md)
- [Runtime Scenarios](architecture/runtime-scenarios.md)
- [Deployment](architecture/deployment.md)
- [Crosscutting Concepts](architecture/crosscutting-concepts.md)
- [Quality Requirements](architecture/quality-requirements.md)
- [Risks & Technical Debt](architecture/risks-and-debt.md)
- [Glossary](architecture/glossary.md)

## 📝 VS Code Client Internals

- [Design Overview](development/vscode-client/00-router-overview.md)
  - [Knowledge Graph: Init Action](development/vscode-client/knowledge-graph/init-action.md)
  - [Knowledge Graph: Nodes](development/vscode-client/knowledge-graph/nodes.md)
  - [Knowledge Graph: Store](development/vscode-client/knowledge-graph/store.md)
  - [Command Palette: Init Project](development/vscode-client/command-palette/init-project.md)
  - [Command Palette: Add Decision](development/vscode-client/command-palette/add-decision.md)
  - [Command Palette: Run Extraction](development/vscode-client/command-palette/run-extraction.md)
  - [Command Palette: Search](development/vscode-client/command-palette/search.md)
  - [Chat Participant: Slash Commands](development/vscode-client/chat-participant/slash-commands.md)
  - [Configuration: Settings](development/vscode-client/configuration/settings.md)
  - [UI/UX: User Journeys](development/vscode-client/ui-ux/user-journeys.md)
  - [UI/UX: Notifications & Prompts](development/vscode-client/ui-ux/notifications-and-prompts.md)
  - [UI/UX: Webview Panels](development/vscode-client/ui-ux/webview-panels.md)
  - [UI/UX: Editor Integration](development/vscode-client/ui-ux/editor-integration.md)

## 📋 Architecture Decision Records (ADR)

- [ADR Index](adr/README.md)
- [ADR-001: VS Code Client Onboarding](adr/ADR-001-vscode-client-onboarding.md)
- [ADR-002: Local-First Architecture](adr/ADR-002-local-first-architecture.md)
- [ADR-003: Server-Side Zero-to-One](adr/ADR-003-server-side-zero-to-one.md)
- [ADR-004: Git-Isomorphic Graph](adr/ADR-004-git-isomorphic-graph.md)
- [ADR-005: Knowledge Abstraction Strategy](adr/ADR-005-knowledge-abstraction-strategy.md)
- [ADR-006: Self-Evolution Architecture](adr/ADR-006-self-evolution-architecture.md)
- [ADR-007: Agentic RAG Routing](adr/ADR-007-agentic-rag-routing.md)
- [ADR-008: Asynchronous Metabolism](adr/ADR-008-asynchronous-metabolism.md)
- [ADR-009: Token Management](adr/ADR-009-token-management.md)
- [ADR-010: Context Compression and Proxy](adr/ADR-010-context-compression-and-proxy.md)
- [ADR-011: Two-Phase Knowledge Validity](adr/ADR-011-two-phase-knowledge-validity.md)
- [ADR-012: Document Misc Pool](adr/ADR-012-document-misc-pool.md)
- [ADR-013: Adversarial Implementation Protocol](adr/ADR-013-adversarial-implementation-protocol.md)
- [ADR-014: SQL-Indexed Graph and Database-as-IPC](adr/ADR-014-sql-indexed-graph-and-database-as-ipc.md)
- [ADR-015: Progressive Enrichment and AST/LSP Dual Engine](adr/ADR-015-progressive-enrichment-and-ast-lsp-dual-engine.md)
- [ADR-016: Git Blob-Native Identity](adr/ADR-016-git-blob-native-identity-and-checkout-thrashing-defense.md)
- [ADR-017: Tiered Storage and Orphan Branch Graph Maintenance](adr/ADR-017-tiered-storage-and-orphan-branch-graph-maintenance.md)
- [ADR-018: Temporal and Conceptual Bidirectional Linking](adr/ADR-018-temporal-and-conceptual-bidirectional-linking.md)
- [ADR-019: pgvector Migration](adr/ADR-019-pgvector-migration.md)
- [ADR-020: Unified Isomorphic AST Microkernel](adr/ADR-020-unified-isomorphic-ast-microkernel.md)
- [ADR-021: Shared Core API and Presentation Layers](adr/ADR-021-shared-core-api-and-presentation-layers.md)
- [ADR-022: WASM AST Blast Radius](adr/ADR-022-wasm-ast-blast-radius.md)
- [ADR-023: Granular Markdown Storage](adr/ADR-023-granular-markdown-storage.md)
- [ADR-024: Cross-Project Soft Linking](adr/ADR-024-cross-project-soft-linking.md)
- [ADR-025: Hybrid Temp-File Blast Radius](adr/ADR-025-hybrid-temp-file-blast-radius.md)
- [ADR-026: Multi-Provider LLM Abstraction](adr/ADR-026-multi-provider-llm-abstraction.md)

## 📊 Evaluation & Benchmarks

- [Evaluation Registry](evaluate/README.md)
- [Data Pipeline: AST Extraction Sync](evaluate/local-ast-extraction-sync.md)
- [Local Storage: SQLite Write Pipeline](evaluate/local-sqlite-write-pipeline.md)
- [Parsing Perf: Native Parsing Fallback](evaluate/native-parsing-fallback.md)
- [Worker Mgmt: Worker Pool Concurrency](evaluate/worker-pool-concurrency.md)
- [Token Opt: Local BFS Blast Radius](evaluate/local-bfs-blast-radius.md)
- [AST Precision: Dependency Edge Creation](evaluate/ast-dependency-edge-creation.md)
- [Local UI: HTML Visualization](evaluate/local-html-visualization.md)
- [IDE UI: VS Code Webview Topology](evaluate/vscode-webview-topology.md)
- [Realtime UX: Sub-second Save Updates](evaluate/sub-second-save-updates.md)
- [Diff Opt: File-hash Delta Detection](evaluate/file-hash-delta-detection.md)

## 🗺️ Work Dashboard & Roadmap

- [Master Dashboard](roadmap/README.md)
  - [Phase 1: Core API & Database (The Metabolism Engine)](roadmap/phase-1-core-api-database-the-metabolism-engine.md)
  - [Phase 2: AST Microkernel & Semantic Diffing](roadmap/phase-2-ast-microkernel-semantic-diffing.md)
  - [Phase 3: Agentic RAG & MCP Interfaces](roadmap/phase-3-agentic-rag-mcp-interfaces.md)
  - [Phase 4: Git-Isomorphic Sync & Temporal Knowledge](roadmap/phase-4-git-isomorphic-sync-temporal-knowledge.md)
  - [Phase 5: Local-First VS Code Client & Web UI](roadmap/phase-5-local-first-vs-code-client-web-ui.md)
  - [Phase 6: Architecture Hardening & Security](roadmap/phase-6-architecture-hardening-security.md)
