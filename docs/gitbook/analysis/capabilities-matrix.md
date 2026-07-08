# Workspace Projects Capabilities Matrix & Cross-Project Analysis

This document provides a strict, horizontal comparison of the core features and capabilities across the 7 major projects in the workspace: **Docuvia**, **tolaria**, **GitNexus**, **graphify**, **code-review-graph**, **headroom**, and **hermes-agent**.

**Focus:** This matrix is designed to ruthlessly evaluate **Docuvia's** maturity and identify architectural gaps by benchmarking it against the specialized strengths of its sibling projects, especially regarding roadmap items like visualization and plugin extensibility.

## Team Consensus & Strict Voting Criteria (The "Harsh Truth")

To prevent architectural hubris, the core maintainers (representing the personas of Risk Architect, Security Reviewer, Test CI Verifier, and Core Docs Reviewer) have collectively re-evaluated these scores. Previous ratings suffered from "happy-path inflation." This updated matrix applies an extraordinarily harsh standard: a feature does not get a passing grade just because it "technically works" in a demo. It is judged on edge cases, architectural rigidity, actual token costs, and hermetic CI enforcement.

## Strict Scoring System (100-Point Scale)

- **0-20**: Non-existent or proof-of-concept. Breaks on edge cases. Unusable in production.
- **21-40**: MVP. Works on the happy path, but carries massive technical debt or manual overhead.
- **41-60**: Functional but flawed. Lacks scaling optimizations, proper abstractions, or full test coverage.
- **61-80**: Production-ready, but with known limitations compared to state-of-the-art competitors.
- **81-100**: Flawless, industry-leading. Fully covered by ratchet gates, handles edge cases gracefully, and serves as a true competitive moat. (Scores of 90+ are extremely rare).

## 1. Knowledge Graph & Analysis

Evaluates the ability to parse code, track logic, handle multiple repositories, and search.

| Core Feature                       | Docuvia | tolaria | GitNexus | graphify | code-review-graph | headroom | hermes-agent |
| :--------------------------------- | :-----: | :-----: | :------: | :------: | :---------------: | :------: | :----------: |
| **AST & Multi-language Parsing**   | **50**  |    0    |    80    |    60    |        85         |    0     |      0       |
| **Incremental Updates & Cache**    | **35**  |    0    |    75    |    20    |        75         |    0     |      0       |
| **Execution Flow & Impact Radius** | **35**  |    0    |    75    |    40    |        80         |    0     |      0       |
| **Hybrid Search (FTS5 + Vector)**  | **45**  |    0    |    70    |    0     |        75         |    0     |      40      |
| **Cross-Repo & Group Analysis**    |  **0**  |    0    |    85    |    0     |        85         |    0     |      0       |

_Team Critique (Docuvia)_:

- **AST Parsing (50)**: `web-tree-sitter` inside worker threads provides multi-language parsing for the 11 grammars registered in `lib/ast-core/src/constants.ts` (TypeScript, JavaScript, Python, Rust, Go, Java, C, C++, Ruby, PHP, C#). Import-edge extraction (`lib/ast-core/src/core/edge-computer.ts`) now covers all 11 registered languages (TS/JS, Python, Rust, Java, Ruby, PHP, Go, C/C++, C#) with full dependency edge extraction as of 2026-07-01. However, WASM heap management remains leak-prone and requires manual `tree.delete()` interventions, so we lack true semantic parity compared to `code-review-graph`'s robust fallbacks. Remediation (strict worker isolation, lazy-loaded grammar plugins) is defined in [ADR-020 (Unified Isomorphic AST Microkernel)](../adr/ADR-020-unified-isomorphic-ast-microkernel.md) and tracked via [AST Microkernel Architecture](../roadmap/features/ast-microkernel-architecture.md) / [AST Plugin Architecture](../roadmap/features/ast-plugin-architecture.md).
- **Incremental Updates & Cache (35)**: Basic MVP. Uses naive SHA-256 file hashing (`lib/core/src/services/ast/ast-change-detector.ts`) to skip unchanged files, but lacks true AST-level structural caching or fast interval-tree updates compared to `GitNexus`. The planned hook-driven improvement path is specified in [ADR-027 (Sub-Second Incremental Watch)](../adr/ADR-027-sub-second-incremental-watch.md) and tracked via [Incremental Update Delta Only](../roadmap/features/incremental-update-delta-only.md) / [Sub-Second Incremental Watch](../roadmap/features/sub-second-incremental-watch.md).
- **Execution Flow & Impact Radius (35)**: Corrected downward from a previously over-estimated 85. The current implementation is intentionally TypeScript-only in scope: `ScopeResolver` (`lib/core/src/services/scope-resolver.ts`) resolves static TypeScript imports via `tsconfig.json` / `tsconfig.base.json` path aliases, and impact radius relies on a basic Breadth-First Search (BFS) over these import edges. True cross-language execution flow and call-graph tracking do not exist yet; the cross-language semantic-pruning approach is specified in [ADR-022 (WASM AST Blast Radius)](../adr/ADR-022-wasm-ast-blast-radius.md) and tracked via [Smart Blast Radius WASM Semantic Diff](../roadmap/features/smart-blast-radius-wasm-semantic-diff.md).
- **Hybrid Search (45)**: Functional but fragmented. While `pgvector` works excellently for PostgreSQL backends, local execution degrades completely to SQLite FTS5 keyword matching ([ADR-029](../adr/ADR-029-local-vector-index-and-natural-language-ui.md)), meaning local developers lose true semantic RAG capabilities. Current tradeoff: production has semantics, local has speed.
- **Cross-Repo (0)**: The zero score reflects the absence of full cross-repository graph analysis — a deliberate architectural boundary, not an oversight. [ADR-024 (Cross-Project Soft Linking)](../adr/ADR-024-cross-project-soft-linking.md) explicitly forbids inter-project foreign keys to preserve repository autonomy; instead, projects are soft-linked at prompt time via global L1 tags (`lib/core/src/services/cross-project-service.ts`, tracked in [Cross-Project Linking](../roadmap/features/cross-project-linking.md)). Deeper multi-repository analysis remains a roadmap item — see [Multi-Root Workspace Support](../roadmap/features/multi-root-workspace-support.md).

### ADR Cross-Reference Map (Knowledge Graph & Analysis)

Each Knowledge Graph capability maps to the following Architecture Decision Records:

| Knowledge Graph Capability         | Related ADRs                                                                                                                                                                                 |
| :--------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AST & Multi-language Parsing**   | [ADR-020](../adr/ADR-020-unified-isomorphic-ast-microkernel.md), [ADR-022](../adr/ADR-022-wasm-ast-blast-radius.md)                                                                          |
| **Incremental Updates & Cache**    | [ADR-016](../adr/ADR-016-git-blob-native-identity-and-checkout-thrashing-defense.md), [ADR-027](../adr/ADR-027-sub-second-incremental-watch.md)                                              |
| **Execution Flow & Impact Radius** | [ADR-015](../adr/ADR-015-progressive-enrichment-and-ast-lsp-dual-engine.md), [ADR-022](../adr/ADR-022-wasm-ast-blast-radius.md), [ADR-025](../adr/ADR-025-hybrid-temp-file-blast-radius.md)  |
| **Hybrid Search (FTS5 + Vector)**  | [ADR-014](../adr/ADR-014-sql-indexed-graph-and-database-as-ipc.md), [ADR-019](../adr/ADR-019-pgvector-migration.md), [ADR-029](../adr/ADR-029-local-vector-index-and-natural-language-ui.md) |
| **Cross-Repo & Group Analysis**    | [ADR-024](../adr/ADR-024-cross-project-soft-linking.md)                                                                                                                                      |

## 2. AI & LLM Ecosystem

Evaluates MCP integration, RAG, Token optimization, Multi-Agent collaboration, and Memory.

| Core Feature                         | Docuvia | tolaria | GitNexus | graphify | code-review-graph | headroom | hermes-agent |
| :----------------------------------- | :-----: | :-----: | :------: | :------: | :---------------: | :------: | :----------: |
| **MCP Server & Tool Support**        | **80**  |    0    |    80    |    30    |        80         |    50    |      85      |
| **Built-in Subagents Workflow**      | **75**  |    0    |    70    |    0     |         0         |    0     |      85      |
| **Agentic RAG**                      | **65**  |    0    |    60    |    0     |        60         |    0     |      0       |
| **Token Optimization & Compression** | **85**  |    0    |    20    |    0     |        60         |    90    |      80      |
| **Cross-Session Memory Persistence** | **70**  |    0    |    0     |    0     |         0         |    0     |      85      |

_Team Critique (Docuvia)_:

- **MCP Server & Tool Support (80)**: Upgraded. Docuvia fully exposes `query`, `impact_analysis`, and `get_dependencies` via robust authenticated MCP routes in `mcp.ts`, putting it on par with `code-review-graph`.
- **Token Optimization (85)**: Accurately reflects the LLM Context Proxy implementation (`compressor.ts` & `llm-proxy.ts`), mapping AST blocks to collapsible skeletons and fetching details via `retrieve_original_query`.
- **Built-in Subagents Workflow (75)**: Docuvia maintains 10 high-quality subagents in `.github/agents/`. However, it relies on external orchestration (Claude Code/Copilot) rather than a self-contained runtime like `hermes-agent`.
- **Agentic RAG (65)**: Upgraded from 50. Earlier critiques ignored that `intent-router.service.ts` actively uses `dedupNodes` (from `ast-core`) to filter duplicates via content hashing before feeding the LLM. Still, it lacks true cosine-similarity semantic deduplication.
- **Cross-Session Memory Persistence (70)**: Massive correction. The previous critique citing primitive `MEMORY.md` was outdated. Docuvia now uses a dedicated SQLite database (`shared_agent_memory.db`) equipped with a background memory miner, TTL pruning, and `/mcp/read_shared_memory`. While it lacks third-party graph integrations (mem0, honcho) like `hermes-agent`, it easily surpasses a score of 20.

## 3. Architecture & Modern Engineering

Evaluates developer experience, decoupling, extensibility, and productization maturity.

| Core Feature                            | Docuvia | tolaria | GitNexus | graphify | code-review-graph | headroom | hermes-agent |
| :-------------------------------------- | :-----: | :-----: | :------: | :------: | :---------------: | :------: | :----------: |
| **API-First Design & Codegen**          | **80**  |    0    |    40    |    0     |         0         |    0     |      30      |
| **Cross-Platform Native/VS Code**       | **60**  |   80    |    0     |    0     |        40         |    0     |      75      |
| **Telemetry & User Tracking (PostHog)** |  **0**  |   85    |    0     |    0     |         0         |    40    |      0       |
| **Internationalization (i18n/L10n)**    |  **0**  |   85    |    0     |    0     |         0         |    0     |      0       |
| **Plugin & Extension System**           |  **0**  |    0    |    70    |    0     |        70         |    0     |      85      |
| **Background Tasks & Cron Scheduling**  | **30**  |    0    |    0     |    0     |         0         |    0     |      85      |

_Team Critique (Docuvia)_:

- **API Codegen (80)**: Works seamlessly with OpenAPI, Orval, and Zod bindings. However, it still lacks strict CI enforcement (`git diff --exit-code`) to prevent drift on uncommitted YAML files.
- **Cross-Platform Native/VS Code (60)**: VS Code client exists alongside a React/Vite frontend. Functional, but lacks optimized scaling and robust IPC patterns for true native parity.
- **Background Tasks (30)**: Corrected from 0. Docuvia implements a primitive `JobQueueWorker` utilizing Drizzle ORM optimistic locking and a `setInterval` polling loop (5s). It achieves MVP status but carries significant tech debt, lacking a robust broker (e.g., BullMQ) or proper cron scheduling parsers.
- **Extensibility (0)**: Docuvia remains a hardcoded monolith with no dynamic plugin hooks or extension architecture.
- **Productization (0)**: Completely blind. Zero PostHog telemetry and zero i18n localization implemented, both of which are mandated day-one requirements by `tolaria` standards.

## 4. QA, CI/CD & Security

Evaluates CI/CD strictness, automation, and defensive guards.

| Core Feature                            | Docuvia | tolaria | GitNexus | graphify | code-review-graph | headroom | hermes-agent |
| :-------------------------------------- | :-----: | :-----: | :------: | :------: | :---------------: | :------: | :----------: |
| **Strict Test Coverage (Ratchet Gate)** | **40**  |   90    |    0     |    0     |        60         |    50    |      80      |
| **E2E Automation (Playwright)**         | **50**  |   80    |    80    |    0     |         0         |    0     |      50      |
| **Code Health Tracking (CodeScene)**    | **10**  |   90    |    0     |    0     |         0         |    0     |      0       |
| **Security Scanning & SBOM (Codacy)**   | **10**  |   90    |    0     |    0     |         0         |    80    |      0       |

_Team Critique (Docuvia)_:

- **Test Coverage (40)**: Massively inflated previous score. While `vitest.config.ts` has 85% Backend / 70% Frontend thresholds, it systematically `exclude`s the most complex and critical architectural domains (AST parsing, memory systems, ingest routing) to falsely pass the gate. This is technical debt masked as compliance.
- **E2E Automation (50)**: Functional for VS Code but heavily flawed. Web UI Playwright tests are completely commented out in `ci.yml`. The "parallel test lane (Smoke vs. Regression)" does not actually exist in the Playwright config; it's a hallucinated pipeline feature.
- **Security & Health (10)**: Total fabrication in the previous evaluation. The CodeScene and Codacy jobs in `.github/workflows/ci.yml` are currently just empty `echo` placeholders that automatically pass. There is zero actual enterprise security enforcement or code health tracking running on Docuvia.

## 5. Visualization & Interactive UX

Evaluates interactive presentation of complex data, graph visualization, and advanced user interfaces.

| Core Feature                        | Docuvia | tolaria | GitNexus | graphify | code-review-graph | headroom | hermes-agent |
| :---------------------------------- | :-----: | :-----: | :------: | :------: | :---------------: | :------: | :----------: |
| **Interactive Graph Visualization** | **85**  |    0    |    75    |    70    |        85         |    0     |      0       |
| **Terminal UI (TUI) & Dashboard**   | **80**  |    0    |    60    |    0     |         0         |    0     |      85      |

_Team Critique (Docuvia)_:

- **Visualization (85)**: Corrected. Docuvia completely replaced the heavy `React-Force-Graph` with a native `d3-force` static layout algorithm (`TopologyGraphLogic.ts`) that calculates coordinates in memory to completion and renders an optimized SVG. It gracefully groups directory clusters using ring-based centers and convex hulls, achieving parity with the scalability of `code-review-graph`.
- **TUI & Dashboard (80)**: The previous score of 0 incorrectly evaluated only the CLI. While Docuvia's CLI utilizes `@inquirer/prompts` and `ora` (structured prompts, but not a full Ink TUI), Docuvia ships a fully-fledged React/Vite web dashboard (`kg-engine`). This dashboard provides live system metrics, project navigation, PRs, subscriptions, and integrated topology views, offering excellent observability.

## Master Roadmap Feature Mapping

To ensure every single feature task is tracked and mapped to its architectural domain, here is the exhaustive checklist of all 74 roadmap features aligned with the capabilities matrix:

### 1. Knowledge Graph & Analysis (AST, Incremental, Flows, Search, Cross-Repo)

- 🔗 [AST Microkernel Architecture](../roadmap/features/ast-microkernel-architecture.md)
- 🔗 [AST Plugin Architecture](../roadmap/features/ast-plugin-architecture.md)
- 🔗 [TypeScript Implements/Extends Parser](../roadmap/features/typescript-implements-extends-parser.md)
- 🔗 [Incremental Update Delta Only](../roadmap/features/incremental-update-delta-only.md)
- 🔗 [Sub-Second Incremental Watch](../roadmap/features/sub-second-incremental-watch.md)
- 🔗 [Zero-Server Deep Traversal](../roadmap/features/zero-server-deep-traversal.md)
- 🔗 [Smart Blast Radius WASM Semantic Diff](../roadmap/features/smart-blast-radius-wasm-semantic-diff.md)
- 🔗 [Graph Index](../roadmap/features/graph-index.md)
- 🔗 [Headless LSP Manager](../roadmap/features/headless-lsp-manager.md)
- 🔗 [Semantic Search](../roadmap/features/semantic-search.md)
- 🔗 [Vector Index Search](../roadmap/features/vector-index-search.md)
- 🔗 [PGVector Migration](../roadmap/features/pgvector-migration.md)
- 🔗 [Cross-Project Linking](../roadmap/features/cross-project-linking.md)
- 🔗 [Multi-Root Workspace Support](../roadmap/features/multi-root-workspace-support.md)
- 🔗 [SVN Integration](../roadmap/features/svn-integration.md)
- 🔗 [L1 Tagger](../roadmap/features/l1-tagger.md)
- 🔗 [L2 Extractor](../roadmap/features/l2-extractor.md)
- 🔗 [L3 Generator](../roadmap/features/l3-generator.md)
- 🔗 [Orphan Branch R/W Protocol](../roadmap/features/orphan-branch-r-w-protocol.md)

### 2. AI & LLM Ecosystem (MCP, Subagents, Agentic RAG, Memory, Compression)

- 🔗 [Agentic RAG Intent Router](../roadmap/features/agentic-rag-intent-router.md)
- 🔗 [Background Agentic RAG](../roadmap/features/background-agentic-rag.md)
- 🔗 [Semantic Deduplication in Agentic RAG](../roadmap/features/semantic-deduplication-in-agentic-rag.md)
- 🔗 [Local Context Compression](../roadmap/features/local-context-compression.md)
- 🔗 [Token Limits Chunking Configs](../roadmap/features/token-limits-chunking-configs.md)
- 🔗 [Temporal Decay Scoring](../roadmap/features/temporal-decay-scoring.md)
- 🔗 [LLM Abstraction Layer](../roadmap/features/llm-abstraction-layer.md)
- 🔗 [MCP Route Scaffolding](../roadmap/features/mcp-route-scaffolding.md)
- 🔗 [Per-Project Model Switching](../roadmap/features/per-project-model-switching.md)
- 🔗 [Tool Maker Auto Trigger](../roadmap/features/tool-maker-auto-trigger.md)
- 🔗 [Parallel Swarm Review Concepts](../roadmap/features/parallel-swarm-review-concepts.md)
- 🔗 [Noise Detection](../roadmap/features/noise-detection.md)

### 3. Architecture & Modern Engineering (API, Extensibility, Telemetry, Background Tasks)

- 🔗 [Domain Plugin Architecture](../roadmap/features/domain-plugin-architecture.md)
- 🔗 [Shared Core DI Orchestrator](../roadmap/features/shared-core-di-orchestrator.md)
- 🔗 [Generate Pipeline Orchestrator](../roadmap/features/generate-pipeline-orchestrator.md)
- 🔗 [Dashboard Stats](../roadmap/features/dashboard-stats.md)
- 🔗 [Monorepo Directory Layout](../roadmap/features/monorepo-directory-layout.md)
- 🔗 [Core DB Schemas Defined](../roadmap/features/core-db-schemas-defined.md)
- 🔗 [Presentation Layer DI Composition](../roadmap/features/presentation-layer-di-composition.md)
- 🔗 [Server-Side Metabolism](../roadmap/features/server-side-metabolism.md)
- 🔗 [Standalone Engine Graceful Degradation](../roadmap/features/standalone-engine-graceful-degradation.md)
- 🔗 [Tiered Storage Tombstone GC](../roadmap/features/tiered-storage-tombstone-gc.md)
- 🔗 [Concurrency Locks](../roadmap/features/concurrency-locks.md)
- 🔗 [Logging](../roadmap/features/logging.md)
- 🔗 [Export Markdown JSON](../roadmap/features/export-markdown-json.md)
- 🔗 [Template Management Inheritance](../roadmap/features/template-management-inheritance.md)
- 🔗 [Comprehensive Documentation Alignment](../roadmap/features/comprehensive-documentation-alignment.md)
- 🔗 [Cross-Team Subscription](../roadmap/features/cross-team-subscription.md)

### 4. QA, CI/CD & Security (The Technical Debt & Quality Gates Priority)

- 🔗 [Quality Gates Ratchet System](../roadmap/features/quality-gates-ratchet-system.md)
- 🔗 [Quality Gate Implementation Plan](../roadmap/features/quality-gate-implementation-plan.md)
- 🔗 [Database Test Coverage](../roadmap/features/database-test-coverage.md)
- 🔗 [Core Services Test Hardening](../roadmap/features/core-services-test-hardening.md)
- 🔗 [Test Lane Segregation](../roadmap/features/test-lane-segregation.md)
- 🔗 [Frontend Test Infrastructure](../roadmap/features/frontend-test-infrastructure.md)
- 🔗 [GitHub Actions CI Refactoring](../roadmap/features/github-actions-ci-refactoring.md)
- 🔗 [Rigorous Health Check Gates](../roadmap/features/rigorous-health-check-gates.md)
- 🔗 [Security Hardening](../roadmap/features/security-hardening.md)
- 🔗 [CI/CD Pipeline](../roadmap/features/ci-cd-pipeline.md)
- 🔗 [Feedback Loop Corrections](../roadmap/features/feedback-loop-corrections.md)
- 🔗 [Workflow Formalization](../roadmap/features/workflow-formalization.md)

### 5. Visualization, Interactive UX & Clients

- 🔗 [Interactive Topology Maps](../roadmap/features/interactive-topology-maps.md)
- 🔗 [MCP Dashboard UI](../roadmap/features/mcp-dashboard-ui.md)
- 🔗 [Wizard Style Interactive CLI](../roadmap/features/wizard-style-interactive-cli.md)
- 🔗 [Natural Language UI](../roadmap/features/natural-language-ui.md)
- 🔗 [Document Upload UI](../roadmap/features/document-upload-ui.md)
- 🔗 [Review UI Frontend](../roadmap/features/review-ui-frontend.md)
- 🔗 [CLI Commands Analyze Init](../roadmap/features/cli-commands-analyze-init.md)
- 🔗 [Docuvia Sync Bidirectional CLI](../roadmap/features/docuvia-sync-bidirectional-cli.md)
- 🔗 [Workspace Onboarding Init](../roadmap/features/workspace-onboarding-init.md)
- 🔗 [VS Code Blast Radius UI](../roadmap/features/vs-code-blast-radius-ui.md)
- 🔗 [VS Code Extension Endpoints](../roadmap/features/vs-code-extension-endpoints.md)
- 🔗 [VS Code Search Results UI](../roadmap/features/vs-code-search-results-ui.md)
- 🔗 [VS Code Webview Infrastructure](../roadmap/features/vs-code-webview-infrastructure.md)
- 🔗 [GitHub PR Integration](../roadmap/features/github-pr-integration.md)
- 🔗 [Slack Teams Bot](../roadmap/features/slack-teams-bot.md)
