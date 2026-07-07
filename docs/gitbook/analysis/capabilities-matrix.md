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
| **AST & Multi-language Parsing**   | **60**  |    0    |    80    |    60    |        85         |    0     |      0       |
| **Incremental Updates & Cache**    | **45**  |    0    |    75    |    20    |        75         |    0     |      0       |
| **Execution Flow & Impact Radius** | **85**  |    0    |    75    |    40    |        80         |    0     |      0       |
| **Hybrid Search (FTS5 + Vector)**  | **40**  |    0    |    70    |    0     |        75         |    0     |      40      |
| **Cross-Repo & Group Analysis**    |  **0**  |    0    |    85    |    0     |        85         |    0     |      0       |

_Team Critique (Docuvia)_:

- **AST Parsing (60)**: `web-tree-sitter` is brittle. We lack true semantic parity across 10+ languages compared to `code-review-graph`'s robust fallbacks.
- **Execution Flow (85)**: Docuvia successfully deployed its `ScopeResolver` (Static Heuristics fallback). It parses `tsconfig.json` path aliases and workspace monorepo globs, allowing offline, instant AST edge resolution without requiring an external LSP cold-start. This brings its reliability on par with `GitNexus`.
- **Cross-Repo (0)**: Docuvia remains rigidly monorepo-bound.

## 2. AI & LLM Ecosystem

Evaluates MCP integration, RAG, Token optimization, Multi-Agent collaboration, and Memory.

| Core Feature                         | Docuvia | tolaria | GitNexus | graphify | code-review-graph | headroom | hermes-agent |
| :----------------------------------- | :-----: | :-----: | :------: | :------: | :---------------: | :------: | :----------: |
| **MCP Server & Tool Support**        | **70**  |    0    |    80    |    30    |        80         |    50    |      85      |
| **Built-in Subagents Workflow**      | **75**  |    0    |    70    |    0     |         0         |    0     |      85      |
| **Agentic RAG**                      | **50**  |    0    |    60    |    0     |        60         |    0     |      0       |
| **Token Optimization & Compression** | **85**  |    0    |    20    |    0     |        60         |    90    |      80      |
| **Cross-Session Memory Persistence** | **20**  |    0    |    0     |    0     |         0         |    0     |      85      |

_Team Critique (Docuvia)_:

- **Token Optimization (85)**: Fixed via the LLM Context Proxy. Docuvia successfully ported `headroom` approach: intercepting outbound RAG payloads, collapsing AST bodies into skeletons, and providing the `docuvia_retrieve_original` MCP tool for the LLM to fetch details on demand. This saves massive API costs.
- **Memory Persistence (20)**: Generating markdown files (`MEMORY.md`) is a primitive mock of real memory. `hermes-agent` integrates actual graph/vector memory backends (mem0, honcho) that survive session restarts cleanly.
- **Agentic RAG (50)**: Our routing lacks true semantic deduplication, often feeding the LLM redundant chunks.

## 3. Architecture & Modern Engineering

Evaluates developer experience, decoupling, extensibility, and productization maturity.

| Core Feature                            | Docuvia | tolaria | GitNexus | graphify | code-review-graph | headroom | hermes-agent |
| :-------------------------------------- | :-----: | :-----: | :------: | :------: | :---------------: | :------: | :----------: |
| **API-First Design & Codegen**          | **80**  |    0    |    40    |    0     |         0         |    0     |      30      |
| **Cross-Platform Native/VS Code**       | **60**  |   80    |    0     |    0     |        40         |    0     |      75      |
| **Telemetry & User Tracking (PostHog)** |  **0**  |   85    |    0     |    0     |         0         |    40    |      0       |
| **Internationalization (i18n/L10n)**    |  **0**  |   85    |    0     |    0     |         0         |    0     |      0       |
| **Plugin & Extension System**           |  **0**  |    0    |    70    |    0     |        70         |    0     |      85      |
| **Background Tasks & Cron Scheduling**  |  **0**  |    0    |    0     |    0     |         0         |    0     |      85      |

_Team Critique (Docuvia)_:

- **API Codegen (80)**: It works, but Orval/Zod bindings still require manual trigger updates and lack strict CI enforcement to prevent drift on uncommitted YAML files.
- **Extensibility (0)**: Docuvia is a monolith. `hermes-agent` manages dynamic plugin loading, chron scheduling, and external API hooks elegantly.
- **Productization (0)**: No PostHog telemetry, no i18n. `tolaria` treats these as day-one requirements for any shipping product.

## 4. QA, CI/CD & Security

Evaluates CI/CD strictness, automation, and defensive guards.

| Core Feature                            | Docuvia | tolaria | GitNexus | graphify | code-review-graph | headroom | hermes-agent |
| :-------------------------------------- | :-----: | :-----: | :------: | :------: | :---------------: | :------: | :----------: |
| **Strict Test Coverage (Ratchet Gate)** | **90**  |   90    |    0     |    0     |        60         |    50    |      80      |
| **E2E Automation (Playwright)**         | **75**  |   80    |    80    |    0     |         0         |    0     |      50      |
| **Code Health Tracking (CodeScene)**    | **80**  |   90    |    0     |    0     |         0         |    0     |      0       |
| **Security Scanning & SBOM (Codacy)**   | **80**  |   90    |    0     |    0     |         0         |    80    |      0       |

_Team Critique (Docuvia)_:

- **Test Coverage (90)**: Docuvia has rapidly matured this quadrant via ADR-033. With a unified Vitest workspace, strict coverage ratchets (85% Backend / 70% Frontend) are now enforced natively within the CI pipeline, acting as hard blockers.
- **E2E Automation (75)**: E2E Playwright jobs now natively test the VS Code Extension with robust iframe locators, and a parallel test lane (Smoke vs. Regression) ensures fast feedback.
- **Security & Health (80)**: Code Health (CodeScene) and Security Scanning (Codacy) integrations are now mandated in the GitHub Actions pipeline, bringing Docuvia's robustness much closer to the enterprise standards set by `tolaria`.

## 5. Visualization & Interactive UX

Evaluates interactive presentation of complex data, graph visualization, and advanced user interfaces.

| Core Feature                        | Docuvia | tolaria | GitNexus | graphify | code-review-graph | headroom | hermes-agent |
| :---------------------------------- | :-----: | :-----: | :------: | :------: | :---------------: | :------: | :----------: |
| **Interactive Graph Visualization** | **60**  |    0    |    75    |    70    |        85         |    0     |      0       |
| **Terminal UI (TUI) & Dashboard**   |  **0**  |    0    |    60    |    0     |         0         |    0     |      85      |

_Team Critique (Docuvia)_:

- **Visualization (60)**: React-Force-Graph is heavy. It chokes on large repositories, rendering indistinguishable hairballs. `code-review-graph`'s native D3 exports handle 10,000+ nodes far more gracefully.
- **TUI (0)**: Docuvia CLI output is purely textual and unstructured. `hermes-agent` provides a rich, responsive Ink-based TUI.

## Critical Shortcomings & Missing Requirements

The following gaps must be prioritized in the roadmap based on the strict evaluation above:

1. **Completed Roadmap Priority: Token Cost & Context Compression**: Fixed. Docuvia successfully implemented the LLM Context Proxy (`llm-proxy.ts` + `compressor.ts`) mapping AST blocks to collapsible skeletons with the `docuvia_retrieve_original` MCP tool, saving immense API costs.
2. **Completed Roadmap Priority: LSP Cold Start Fragility**: Fixed. Docuvia integrated the `ScopeResolver` into `sqlite-graph.repository.ts`, providing offline static heuristics (parsing `tsconfig` and node_modules) exactly like `GitNexus`.
3. **Completed Roadmap Priority: Adopt `tolaria`'s Quality Gates**: Fixed. Docuvia successfully implemented ADR-033, introducing strict test lanes, unified Vitest workspace coverage ratchets, and embedded CodeScene/Codacy gates into its CI pipeline. E2E Web UI coverage will continue to be fleshed out.
4. **Monolithic Rigidity (Score: 0)**: No plugin system, no cross-repo group analysis, and no background task orchestration. The system must be decoupled to match `hermes-agent`.
5. **Product Blindness (Score: 0)**: Without Telemetry (PostHog) or Internationalization, we are building an engine, not a product. These must be integrated following `tolaria`'s exact patterns.
