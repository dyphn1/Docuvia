# Workspace Projects Capabilities Matrix & Cross-Project Analysis

This document provides a strict, horizontal comparison of the core features and capabilities across the 6 major projects in the workspace: **Docuvia**, **tolaria**, **GitNexus**, **graphify**, **code-review-graph**, and **headroom**.

**Focus:** This matrix is designed to ruthlessly evaluate **Docuvia's** maturity and identify architectural gaps by benchmarking it against the specialized strengths of its sibling projects.

## Scoring System (100-Point Strict Scale)

- **0-20**: Non-existent or trivial mock. Completely unusable in production.
- **21-40**: Basic prototype. Brittle, lacks edge-case handling, or relies on heavy manual intervention.
- **41-60**: Functional but mediocre. Meets minimum requirements but lacks optimization or scaling capabilities.
- **61-80**: Mature and robust. Standard production quality, reliable under normal loads.
- **81-100**: Industry-leading/Moat. State-of-the-art implementation, enforced via strict CI/CD gates, serving as the core competitive advantage of the project.

## 1. Knowledge Graph & Analysis

Evaluates the ability to parse code, track logic, and search.

| Core Feature                       | Docuvia | tolaria | GitNexus | graphify | code-review-graph | headroom |
| :--------------------------------- | :-----: | :-----: | :------: | :------: | :---------------: | :------: |
| **AST & Multi-language Parsing**   | **85**  |    0    |    95    |    75    |        95         |    0     |
| **Incremental Updates & Cache**    | **75**  |    0    |    90    |    30    |        90         |    0     |
| **Execution Flow & Impact Radius** | **80**  |    0    |    95    |    50    |        95         |    0     |
| **Hybrid Search (FTS5 + Vector)**  | **75**  |    0    |    90    |    0     |        90         |    0     |

_Docuvia Analysis_: Docuvia uses a **Progressive Enrichment (AST + LSP) Dual Engine**. While the WASM AST provides a fast baseline (85), its `Execution Flow & Impact Radius` scoring is strictly capped (80) compared to GitNexus and `code-review-graph` (95).

- **GitNexus / code-review-graph (95)**: Achieve offline, millisecond-latency blast radius calculations natively in SQLite by utilizing pure static heuristics and bypassing compilers entirely.
- **Docuvia (80)**: Relies on asynchronously booting an external LSP for deep cross-module inference. This introduces a 3-5s cold-start latency and makes the analysis fragile if the user's project has a broken build or missing `node_modules`.

_Architectural Deep Dive:_ For a full breakdown of how Docuvia mitigates these limitations via Fast/Slow path routing, Graceful Degradation, and Cumulative Knowledge Accumulation, see the [Progressive Enrichment Playbook](../development/patterns/progressive-enrichment.md).

## 2. AI & LLM Ecosystem

Evaluates MCP integration, RAG, Token optimization, and Multi-Agent collaboration.

| Core Feature                         | Docuvia | tolaria | GitNexus | graphify | code-review-graph | headroom |
| :----------------------------------- | :-----: | :-----: | :------: | :------: | :---------------: | :------: |
| **MCP Server & Tool Support**        | **90**  |    0    |    95    |    40    |        95         |    60    |
| **Built-in Subagents Workflow**      | **95**  |    0    |    85    |    0     |         0         |    0     |
| **Agentic RAG**                      | **90**  |    0    |    70    |    0     |        70         |    0     |
| **Token Optimization & Compression** | **15**  |    0    |    30    |    0     |        75         |   100    |

_Docuvia Analysis_: Docuvia shines in its orchestration capabilities. Its 4-way Agentic RAG router and structured 10-subagent workflow (`.github/agents/`) are class-leading (90+). However, **Token Optimization is Docuvia's critical vulnerability (15)**. While `headroom` has perfected token compression proxying (100), Docuvia currently lacks serious token budgeting, risking massive LLM costs and context-window blowouts during large monorepo extractions.

## 3. Architecture & Modern Engineering

Evaluates developer experience, decoupling, and productization maturity.

| Core Feature                            | Docuvia | tolaria | GitNexus | graphify | code-review-graph | headroom |
| :-------------------------------------- | :-----: | :-----: | :------: | :------: | :---------------: | :------: |
| **API-First Design & Codegen**          | **95**  |    0    |    50    |    0     |         0         |    0     |
| **Cross-Platform Native/VS Code**       | **75**  |   90    |    0     |    0     |        50         |    0     |
| **Telemetry & User Tracking (PostHog)** |  **0**  |   95    |    0     |    0     |         0         |    50    |
| **Internationalization (i18n/L10n)**    |  **0**  |   95    |    0     |    0     |         0         |    0     |

_Docuvia Analysis_: Docuvia's backend-to-frontend engineering is world-class; its strict `openapi.yaml` -> Orval -> Zod/React Query pipeline guarantees zero type drift (95). VS Code integration is solid (75) but lacks the native desktop polish of `tolaria`. The glaring omissions are **Telemetry (0) and Internationalization (0)**. If Docuvia intends to be a user-facing product rather than just an internal engine, it must adopt `tolaria`'s rigorous productization standards.

## 4. QA, CI/CD & Security

Evaluates CI/CD strictness, automation, and defensive guards.

| Core Feature                            | Docuvia | tolaria | GitNexus | graphify | code-review-graph | headroom |
| :-------------------------------------- | :-----: | :-----: | :------: | :------: | :---------------: | :------: |
| **Strict Test Coverage (Ratchet Gate)** | **50**  |   95    |    0     |    0     |        75         |    60    |
| **E2E Automation (Playwright)**         |  **0**  |   90    |    90    |    0     |         0         |    0     |
| **Code Health Tracking (CodeScene)**    |  **0**  |   95    |    0     |    0     |         0         |    0     |
| **Security Scanning & SBOM (Codacy)**   |  **0**  |   95    |    0     |    0     |         0         |    90    |

_Docuvia Analysis_: **This is Docuvia's weakest quadrant.** While unit tests exist for the API server (50), the system completely lacks E2E automation for its web UI (`kg-engine` has no tests) and VS Code extension (0). Furthermore, it has zero Code Health tracking or Security/SBOM generation, areas where `tolaria` and `headroom` (90+) set strict ratchet gates. Docuvia's CI pipeline needs an immediate overhaul to reach enterprise readiness.

## Actionable Insights for Docuvia

1. **Immediate Risk: Integrate `headroom`'s RTK vs RAM limits**: Docuvia's massive token consumption during AST/RAG operations is unsustainable (Score: 15). We must adopt token compression strategies, but we must rigorously profile the memory cost (1-2GB RAM) of running local LLM healing/compression versus the footprint of the existing LSP daemon.
2. **Technical Debt: Adopt `tolaria`'s Quality Gates**: Docuvia's lack of E2E tests and CodeScene/Codacy security scans (Score: 0) is unacceptable for a full-stack monorepo. We must implement a strict ratchet strategy for coverage and code health.
3. **Productization: Add Telemetry & i18n**: To graduate from an "engine" to a "product", Docuvia needs to observe user behavior (PostHog) and support localization, copying the exact patterns established in `tolaria`.
