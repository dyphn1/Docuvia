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

| Core Feature | Docuvia | tolaria | GitNexus | graphify | code-review-graph | headroom | hermes-agent |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **AST & Multi-language Parsing** | **50** | 0 | 80 | 60 | 85 | 0 | 0 |
| **Incremental Updates & Cache** | **70** | 0 | 75 | 20 | 75 | 0 | 0 |
| **Execution Flow & Impact Radius** | **35** | 0 | 75 | 40 | 80 | 0 | 0 |
| **Hybrid Search (FTS5 + Vector)** | **45** | 0 | 70 | 0 | 75 | 0 | 40 |
| **Cross-Repo & Group Analysis** | **0** | 0 | 85 | 0 | 85 | 0 | 0 |

### Feature Analysis & Roadmap Mapping

| Core Feature | Related ADRs | Roadmap Features | Current Situation (Critique & Audit) | Recommendations |
| :--- | :--- | :--- | :--- | :--- |
| **AST & Multi-language Parsing** | [ADR-020](../adr/ADR-020-unified-isomorphic-ast-microkernel.md)<br>[ADR-022](../adr/ADR-022-wasm-ast-blast-radius.md) | [AST Microkernel](../roadmap/features/ast-microkernel-architecture.md), [AST Plugin](../roadmap/features/ast-plugin-architecture.md), [TS Implements/Extends Parser](../roadmap/features/typescript-implements-extends-parser.md) | `web-tree-sitter` in worker threads parses 11 grammars. Import-edge extraction works. However, WASM heap management is leak-prone (requires manual `tree.delete()`). Lacks semantic parity vs `code-review-graph`. | Implement strict worker isolation and lazy-loaded grammar plugins. |
| **Incremental Updates & Cache** | [ADR-016](../adr/ADR-016-git-blob-native-identity-and-checkout-thrashing-defense.md)<br>[ADR-027](../adr/ADR-027-sub-second-incremental-watch.md) | [Incremental Update Delta Only](../roadmap/features/incremental-update-delta-only.md), [Sub-Second Incremental Watch](../roadmap/features/sub-second-incremental-watch.md) | Includes LRU+TTL AST parse cache, SHA-256 deduplication, and batch upserts. LSP diff calc selectively applies updates. However, Sub-Second Incremental Watch is a fake implementation (only a comment). | Build true interval-tree indexing and actual hook-driven UI events. |
| **Execution Flow & Impact Radius** | [ADR-015](../adr/ADR-015-progressive-enrichment-and-ast-lsp-dual-engine.md)<br>[ADR-022](../adr/ADR-022-wasm-ast-blast-radius.md)<br>[ADR-025](../adr/ADR-025-hybrid-temp-file-blast-radius.md) | [Smart Blast Radius](../roadmap/features/smart-blast-radius-wasm-semantic-diff.md), [Graph Index](../roadmap/features/graph-index.md), [Headless LSP Manager](../roadmap/features/headless-lsp-manager.md), [Zero-Server Deep Traversal](../roadmap/features/zero-server-deep-traversal.md) | Intentionally TS-only. `ScopeResolver` uses `tsconfig` paths. Relies on basic BFS over import edges. Graph BFS is hardcoded to depth 3. Headless LSP Manager is just a barrel export (fabrication). | Adopt cross-language semantic-pruning approach. Implement real Headless LSP orchestrator. |
| **Hybrid Search (FTS5 + Vector)** | [ADR-014](../adr/ADR-014-sql-indexed-graph-and-database-as-ipc.md)<br>[ADR-019](../adr/ADR-019-pgvector-migration.md)<br>[ADR-029](../adr/ADR-029-local-vector-index-and-natural-language-ui.md) | [Semantic Search](../roadmap/features/semantic-search.md), [Vector Index Search](../roadmap/features/vector-index-search.md), [PGVector Migration](../roadmap/features/pgvector-migration.md) | `pgvector` extension creation was removed. Local execution degrades to SQLite FTS5 (no semantic RAG). Vector chain has zero test coverage and hard-coupled to OpenAI endpoint shape. | Restore pgvector migration script, implement robust local vector fallback, add tests for server-side vector chain. |
| **Cross-Repo & Group Analysis** | [ADR-024](../adr/ADR-024-cross-project-soft-linking.md) | [Cross-Project Linking](../roadmap/features/cross-project-linking.md), [Multi-Root Workspace](../roadmap/features/multi-root-workspace-support.md), [SVN Integration](../roadmap/features/svn-integration.md), [L1 Tagger](../roadmap/features/l1-tagger.md), [L2 Extractor](../roadmap/features/l2-extractor.md), [L3 Generator](../roadmap/features/l3-generator.md), [Orphan Branch R/W](../roadmap/features/orphan-branch-r-w-protocol.md) | Deliberate architectural boundary forbidding inter-project FKs. Cross-project uses embedding similarity instead of L1-tag joins. Schema missing caching topologies. Multi-root hardcodes empty strings. | Enforce L1-tag joins for cross-project, fix L1/L3 schemas, properly implement multi-root slugs. |

## 2. AI & LLM Ecosystem

Evaluates MCP integration, RAG, Token optimization, Multi-Agent collaboration, and Memory.

| Core Feature | Docuvia | tolaria | GitNexus | graphify | code-review-graph | headroom | hermes-agent |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **MCP Server & Tool Support** | **80** | 0 | 80 | 30 | 80 | 50 | 85 |
| **Built-in Subagents Workflow** | **75** | 0 | 70 | 0 | 0 | 0 | 85 |
| **Agentic RAG** | **65** | 0 | 60 | 0 | 60 | 0 | 0 |
| **Token Optimization & Compression** | **85** | 0 | 20 | 0 | 60 | 90 | 80 |
| **Cross-Session Memory Persistence** | **70** | 0 | 0 | 0 | 0 | 0 | 85 |

### Feature Analysis & Roadmap Mapping

| Core Feature | Related ADRs | Roadmap Features | Current Situation (Critique & Audit) | Recommendations |
| :--- | :--- | :--- | :--- | :--- |
| **MCP Server & Tool Support** | [ADR-031](../adr/ADR-031-model-context-protocol-integration.md) | [MCP Route Scaffolding](../roadmap/features/mcp-route-scaffolding.md) | Fully exposes `query`, `impact_analysis`, and `get_dependencies` via robust authenticated MCP routes. Putting it on par with `code-review-graph`. Routing complete but zero integration tests against real DB data. | Write integration tests for MCP routes against real DB. |
| **Built-in Subagents Workflow** | [ADR-032](../adr/ADR-032-agentic-rag-swarm-architecture.md) | [Parallel Swarm Review Concepts](../roadmap/features/parallel-swarm-review-concepts.md), [Tool Maker Auto Trigger](../roadmap/features/tool-maker-auto-trigger.md) | Maintains 10 high-quality subagents in `.github/agents/`. However, `SwarmOrchestrator` / `TaskDispatcher` are completely dead code (zero production imports). The swarm review never actually executes. | Either implement the orchestrator runtime or remove the dead code to rely entirely on external execution. |
| **Agentic RAG** | [ADR-007](../adr/ADR-007-agentic-rag-intent-router.md) | [Agentic RAG Intent Router](../roadmap/features/agentic-rag-intent-router.md), [Background Agentic RAG](../roadmap/features/background-agentic-rag.md), [Semantic Deduplication](../roadmap/features/semantic-deduplication-in-agentic-rag.md) | `intent-router.service.ts` uses `dedupNodes` to filter duplicates via content hashing, but lacks true cosine-similarity semantic deduplication. Routing logic is mocked in tests, fast-path not verified. | Replace mocks in `intent-router` tests with real behavior. Implement true semantic deduplication. |
| **Token Optimization & Compression** | [ADR-009](../adr/ADR-009-token-limits-chunking-configs.md)<br>[ADR-026](../adr/ADR-026-multi-provider-llm-abstraction.md) | [Local Context Compression](../roadmap/features/local-context-compression.md), [Token Limits Chunking Configs](../roadmap/features/token-limits-chunking-configs.md), [LLM Abstraction Layer](../roadmap/features/llm-abstraction-layer.md), [Per-Project Model Switching](../roadmap/features/per-project-model-switching.md), [Noise Detection](../roadmap/features/noise-detection.md) | Proxy maps oversized AST blocks to collapsible skeletons. However, `startTTLJob` is unreachable. Configs for limits are declared but ignored (hardcoded substring truncations). Noise Detection returns hardcoded 0.1. | Wire `startTTLJob`. Replace hardcoded truncations with config-driven limits. Implement actual noise detection logic. |
| **Cross-Session Memory Persistence** | [ADR-010](../adr/ADR-010-local-context-compression.md) | [Temporal Decay Scoring](../roadmap/features/temporal-decay-scoring.md) | Uses dedicated SQLite DB (`shared_agent_memory.db`) with TTL pruning. Temporal decay scoring exists but is duplicated in 4 SQL queries bypassing the central calculator, with zero integration coverage. | Consolidate temporal decay logic into a single calculator. Add integration tests for decay ranking. |

## 3. Architecture & Modern Engineering

Evaluates developer experience, decoupling, extensibility, and productization maturity.

| Core Feature | Docuvia | tolaria | GitNexus | graphify | code-review-graph | headroom | hermes-agent |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **API-First Design & Codegen** | **80** | 0 | 40 | 0 | 0 | 0 | 30 |
| **Cross-Platform Native/VS Code** | **60** | 80 | 0 | 0 | 40 | 0 | 75 |
| **Telemetry & User Tracking (PostHog)** | **0** | 85 | 0 | 0 | 0 | 40 | 0 |
| **Internationalization (i18n/L10n)** | **0** | 85 | 0 | 0 | 0 | 0 | 0 |
| **Plugin & Extension System** | **0** | 0 | 70 | 0 | 70 | 0 | 85 |
| **Background Tasks & Cron Scheduling** | **30** | 0 | 0 | 0 | 0 | 0 | 85 |

### Feature Analysis & Roadmap Mapping

| Core Feature | Related ADRs | Roadmap Features | Current Situation (Critique & Audit) | Recommendations |
| :--- | :--- | :--- | :--- | :--- |
| **API-First Design & Codegen** | [ADR-021](../adr/ADR-021-shared-core-di-orchestrator.md) | [Presentation Layer DI Composition](../roadmap/features/presentation-layer-di-composition.md), [Shared Core DI Orchestrator](../roadmap/features/shared-core-di-orchestrator.md), [Core DB Schemas Defined](../roadmap/features/core-db-schemas-defined.md) | Works seamlessly with OpenAPI, Orval, Zod. However, the DI Container is completely bypassed in reality (routes use `new ProjectService()`). Monorepo layout has empty stub packages breaking workspace contracts. | Enforce CI drift checks. Refactor routes to use DI container and eliminate direct instantiation. |
| **Cross-Platform Native/VS Code** | - | [Dashboard Stats](../roadmap/features/dashboard-stats.md), [Comprehensive Documentation Alignment](../roadmap/features/comprehensive-documentation-alignment.md), [Cross-Team Subscription](../roadmap/features/cross-team-subscription.md) | VS Code client exists alongside React/Vite frontend. Lacks optimized IPC patterns. "Dashboard Stats" claims unified Core Services, but actually uses fragmented implementations (SQLite vs Postgres). | Standardize the backend layer across all clients to truly unify core services. |
| **Telemetry & User Tracking** | - | [Logging](../roadmap/features/logging.md) | Zero PostHog telemetry implemented. `logging` feature is dead code with zero PII redaction tests. | Remove dead logging code or implement a proper telemetry/logging layer. |
| **Internationalization (i18n/L10n)** | - | - | Zero i18n localization implemented. | Add translation scaffolding if required by productization goals. |
| **Plugin & Extension System** | - | [Domain Plugin Architecture](../roadmap/features/domain-plugin-architecture.md), [Generate Pipeline Orchestrator](../roadmap/features/generate-pipeline-orchestrator.md), [Template Management Inheritance](../roadmap/features/template-management-inheritance.md) | Hardcoded monolith with no dynamic plugin hooks. Template inheritance logic is unreachable dead code. | Clean up dead template inheritance code. Implement actual plugin registry if needed. |
| **Background Tasks & Cron Scheduling** | [ADR-008](../adr/ADR-008-asynchronous-metabolism.md) | [Server-Side Metabolism](../roadmap/features/server-side-metabolism.md), [Standalone Engine Graceful Degradation](../roadmap/features/standalone-engine-graceful-degradation.md), [Tiered Storage Tombstone GC](../roadmap/features/tiered-storage-tombstone-gc.md), [Concurrency Locks](../roadmap/features/concurrency-locks.md), [Export Markdown JSON](../roadmap/features/export-markdown-json.md) | Primitive `JobQueueWorker` using Drizzle optimistic locking. Stalled-job reclaim is stubbed but never executed. DLQ state machine missing required schema fields. | Fully implement DLQ schema fields and job reclaiming to fulfill ADR-008 requirements. |

## 4. QA, CI/CD & Security

Evaluates CI/CD strictness, automation, and defensive guards.

| Core Feature | Docuvia | tolaria | GitNexus | graphify | code-review-graph | headroom | hermes-agent |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Strict Test Coverage (Ratchet Gate)** | **40** | 90 | 0 | 0 | 60 | 50 | 80 |
| **E2E Automation (Playwright)** | **50** | 80 | 80 | 0 | 0 | 0 | 50 |
| **Code Health Tracking (CodeScene)** | **10** | 90 | 0 | 0 | 0 | 0 | 0 |
| **Security Scanning & SBOM (Codacy)** | **10** | 90 | 0 | 0 | 0 | 80 | 0 |

### Feature Analysis & Roadmap Mapping

| Core Feature | Related ADRs | Roadmap Features | Current Situation (Critique & Audit) | Recommendations |
| :--- | :--- | :--- | :--- | :--- |
| **Strict Test Coverage (Ratchet Gate)** | [ADR-033](../adr/ADR-033-strict-test-framework-and-quality-gates.md) | [Quality Gates Ratchet System](../roadmap/features/quality-gates-ratchet-system.md), [Quality Gate Implementation Plan](../roadmap/features/quality-gate-implementation-plan.md), [Database Test Coverage](../roadmap/features/database-test-coverage.md), [Core Services Test Hardening](../roadmap/features/core-services-test-hardening.md) | Massively inflated score. `vitest.config.ts` systematically excludes the most critical domains (`lib/core`). `lib/core` has no test script. Tests crash with OOM. Many tests are fake `expect(1).toBe(1)`. | **Priority 0:** Remove exclusions from coverage. Fix OOM tests. Enforce strict TDD for core services. |
| **E2E Automation (Playwright)** | - | [Test Lane Segregation](../roadmap/features/test-lane-segregation.md), [Frontend Test Infrastructure](../roadmap/features/frontend-test-infrastructure.md), [Feedback Loop Corrections](../roadmap/features/feedback-loop-corrections.md), [Workflow Formalization](../roadmap/features/workflow-formalization.md) | Web UI Playwright tests are commented out in `ci.yml`. Parallel test lanes (Smoke vs Regression) are hallucinated. Feedback loop corrections have zero coverage and lose data. | Restore Playwright tests in CI. Implement actual Smoke vs Regression test lanes. |
| **Code Health Tracking (CodeScene)** | [ADR-033](../adr/ADR-033-strict-test-framework-and-quality-gates.md) | [Rigorous Health Check Gates](../roadmap/features/rigorous-health-check-gates.md), [GitHub Actions CI Refactoring](../roadmap/features/github-actions-ci-refactoring.md), [CI/CD Pipeline](../roadmap/features/ci-cd-pipeline.md) | Total fabrication. CodeScene job in `.github/workflows/ci.yml` is an empty `echo` placeholder that auto-passes. | Integrate real CodeScene analysis into the CI pipeline. |
| **Security Scanning & SBOM (Codacy)** | [ADR-033](../adr/ADR-033-strict-test-framework-and-quality-gates.md) | [Security Hardening](../roadmap/features/security-hardening.md) | Total fabrication. Codacy job in CI is an `echo` placeholder. `checkProjectOwnership` middleware exists, but auth always resolves to `userId=1` (inert check). | Wire up real Codacy scanning. Fix auth mock to enable real ownership checks. |

## 5. Visualization & Interactive UX

Evaluates interactive presentation of complex data, graph visualization, and advanced user interfaces.

| Core Feature | Docuvia | tolaria | GitNexus | graphify | code-review-graph | headroom | hermes-agent |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Interactive Graph Visualization** | **85** | 0 | 75 | 70 | 85 | 0 | 0 |
| **Terminal UI (TUI) & Dashboard** | **80** | 0 | 60 | 0 | 0 | 0 | 85 |

### Feature Analysis & Roadmap Mapping

| Core Feature | Related ADRs | Roadmap Features | Current Situation (Critique & Audit) | Recommendations |
| :--- | :--- | :--- | :--- | :--- |
| **Interactive Graph Visualization** | - | [Interactive Topology Maps](../roadmap/features/interactive-topology-maps.md), [VS Code Blast Radius UI](../roadmap/features/vs-code-blast-radius-ui.md), [VS Code Webview Infrastructure](../roadmap/features/vs-code-webview-infrastructure.md) | Replaced `React-Force-Graph` with native `d3-force` optimized SVG. Gracefully groups clusters. Hover provider runs BFS but swallows all errors silently. VS Code webview hardcodes `filePath` to `""`, making the handler dead. | Fix silent error swallowing in Hover provider. Fix hardcoded empty strings in local-snapshot-service to make Webview functional. |
| **Terminal UI (TUI) & Dashboard** | - | [MCP Dashboard UI](../roadmap/features/mcp-dashboard-ui.md), [Wizard Style Interactive CLI](../roadmap/features/wizard-style-interactive-cli.md), [Natural Language UI](../roadmap/features/natural-language-ui.md), [Document Upload UI](../roadmap/features/document-upload-ui.md), [Review UI Frontend](../roadmap/features/review-ui-frontend.md), [CLI Commands Analyze Init](../roadmap/features/cli-commands-analyze-init.md), [Docuvia Sync Bidirectional CLI](../roadmap/features/docuvia-sync-bidirectional-cli.md), [Workspace Onboarding Init](../roadmap/features/workspace-onboarding-init.md), [VS Code Search Results UI](../roadmap/features/vs-code-search-results-ui.md), [VS Code Extension Endpoints](../roadmap/features/vs-code-extension-endpoints.md), [GitHub PR Integration](../roadmap/features/github-pr-integration.md), [Slack Teams Bot](../roadmap/features/slack-teams-bot.md) | CLI uses `@inquirer/prompts`. Web dashboard provides metrics and navigation. Workspace init only has scaffolding (empty SQLite schema). Sync CLI errors out on `--local`. Slack bot has invisible failures (fire-and-forget). VS Code Search UI is not wired up. | Build real workspace init flow. Wire up sync CLI `--local` mode. Add error handling and tracking to Slack bot integration. |
