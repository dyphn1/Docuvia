# Workspace Projects Capabilities Matrix & Cross-Project Analysis

This document provides a strict, horizontal comparison of the core features and capabilities across the 7 major projects in the workspace: **Docuvia**, **tolaria**, **GitNexus**, **graphify**, **code-review-graph**, **headroom**, and **hermes-agent**.

**Focus:** This matrix is designed to ruthlessly evaluate **Docuvia's** maturity and identify architectural gaps by benchmarking it against the specialized strengths of its sibling projects, especially regarding roadmap items like visualization and plugin extensibility.

## Scoring System (100-Point Strict Scale)

- **0-20**: Non-existent or trivial mock. Completely unusable in production.
- **21-40**: Basic prototype. Brittle, lacks edge-case handling, or relies on heavy manual intervention.
- **41-60**: Functional but mediocre. Meets minimum requirements but lacks optimization or scaling capabilities.
- **61-80**: Mature and robust. Standard production quality, reliable under normal loads.
- **81-100**: Industry-leading/Moat. State-of-the-art implementation, enforced via strict CI/CD gates, serving as the core competitive advantage of the project.

## 1. Knowledge Graph & Analysis

Evaluates the ability to parse code, track logic, handle multiple repositories, and search.

| Core Feature                       | Docuvia | tolaria | GitNexus | graphify | code-review-graph | headroom | hermes-agent |
| :--------------------------------- | :-----: | :-----: | :------: | :------: | :---------------: | :------: | :----------: |
| **AST & Multi-language Parsing**   | **85**  |    0    |    95    |    75    |        95         |    0     |      0       |
| **Incremental Updates & Cache**    | **75**  |    0    |    90    |    30    |        90         |    0     |      0       |
| **Execution Flow & Impact Radius** | **80**  |    0    |    95    |    50    |        95         |    0     |      0       |
| **Hybrid Search (FTS5 + Vector)**  | **75**  |    0    |    90    |    0     |        90         |    0     |      50      |
| **Cross-Repo & Group Analysis**    |  **0**  |    0    |    95    |    0     |        95         |    0     |      0       |

_Docuvia Analysis_: Docuvia uses a **Progressive Enrichment (AST + LSP) Dual Engine**. While the WASM AST provides a fast baseline (85), its `Execution Flow & Impact Radius` scoring is strictly capped (80) compared to GitNexus and `code-review-graph` (95).
Furthermore, Docuvia entirely lacks **Cross-Repo & Group Analysis (0)**, a capability that both GitNexus and code-review-graph have mastered (95) for querying across grouped workspace projects.

- **GitNexus / code-review-graph (95)**: Achieve offline, millisecond-latency blast radius calculations natively in SQLite by utilizing pure static heuristics and bypassing compilers entirely.
- **Docuvia (80)**: Relies on asynchronously booting an external LSP for deep cross-module inference. This introduces a 3-5s cold-start latency and makes the analysis fragile if the user's project has a broken build or missing `node_modules`.

_Architectural Deep Dive:_ For a full breakdown of how Docuvia mitigates these limitations via Fast/Slow path routing, Graceful Degradation, and Cumulative Knowledge Accumulation, see the [Progressive Enrichment Playbook](../development/patterns/progressive-enrichment.md).

## 2. AI & LLM Ecosystem

Evaluates MCP integration, RAG, Token optimization, Multi-Agent collaboration, and Memory.

| Core Feature                         | Docuvia | tolaria | GitNexus | graphify | code-review-graph | headroom | hermes-agent |
| :----------------------------------- | :-----: | :-----: | :------: | :------: | :---------------: | :------: | :----------: |
| **MCP Server & Tool Support**        | **90**  |    0    |    95    |    40    |        95         |    60    |      95      |
| **Built-in Subagents Workflow**      | **95**  |    0    |    85    |    0     |         0         |    0     |      95      |
| **Agentic RAG**                      | **90**  |    0    |    70    |    0     |        70         |    0     |      0       |
| **Token Optimization & Compression** | **15**  |    0    |    30    |    0     |        75         |   100    |      90      |
| **Cross-Session Memory Persistence** | **40**  |    0    |    0     |    0     |         0         |    0     |      95      |

_Docuvia Analysis_: Docuvia shines in its orchestration capabilities. Its 4-way Agentic RAG router and structured 10-subagent workflow (`.github/agents/`) are class-leading (90+). However, **Token Optimization is Docuvia's critical vulnerability (15)**. While `headroom` and `hermes-agent` have perfected token compression proxying and prompt caching (90-100), Docuvia currently lacks serious token budgeting.
Additionally, in **Cross-Session Memory Persistence (40)**, Docuvia only has basic Markdown memory keeper logs, whereas `hermes-agent` (95) features advanced pluggable memory backends (mem0, honcho) that persist dynamically across distinct user sessions.

## 3. Architecture & Modern Engineering

Evaluates developer experience, decoupling, extensibility, and productization maturity.

| Core Feature                            | Docuvia | tolaria | GitNexus | graphify | code-review-graph | headroom | hermes-agent |
| :-------------------------------------- | :-----: | :-----: | :------: | :------: | :---------------: | :------: | :----------: |
| **API-First Design & Codegen**          | **95**  |    0    |    50    |    0     |         0         |    0     |      40      |
| **Cross-Platform Native/VS Code**       | **75**  |   90    |    0     |    0     |        50         |    0     |      85      |
| **Telemetry & User Tracking (PostHog)** |  **0**  |   95    |    0     |    0     |         0         |    50    |      0       |
| **Internationalization (i18n/L10n)**    |  **0**  |   95    |    0     |    0     |         0         |    0     |      0       |
| **Plugin & Extension System**           |  **0**  |    0    |    80    |    0     |        80         |    0     |      95      |
| **Background Tasks & Cron Scheduling**  |  **0**  |    0    |    0     |    0     |         0         |    0     |      95      |

_Docuvia Analysis_: Docuvia's backend-to-frontend engineering is world-class; its strict `openapi.yaml` -> Orval -> Zod/React Query pipeline guarantees zero type drift (95). VS Code integration is solid (75) but lacks the native desktop polish of `tolaria` (90) or `hermes-agent`'s Electron app (85).
The glaring omissions are **Telemetry (0), Internationalization (0), and Plugin Systems (0)**. `hermes-agent` absolutely dominates extensibility (95) via its dynamic skill system, Kanban dispatchers, and cron scheduling, leaving Docuvia looking highly rigid in comparison.

## 4. QA, CI/CD & Security

Evaluates CI/CD strictness, automation, and defensive guards.

| Core Feature                            | Docuvia | tolaria | GitNexus | graphify | code-review-graph | headroom | hermes-agent |
| :-------------------------------------- | :-----: | :-----: | :------: | :------: | :---------------: | :------: | :----------: |
| **Strict Test Coverage (Ratchet Gate)** | **50**  |   95    |    0     |    0     |        75         |    60    |      90      |
| **E2E Automation (Playwright)**         |  **0**  |   90    |    90    |    0     |         0         |    0     |      60      |
| **Code Health Tracking (CodeScene)**    |  **0**  |   95    |    0     |    0     |         0         |    0     |      0       |
| **Security Scanning & SBOM (Codacy)**   |  **0**  |   95    |    0     |    0     |         0         |    90    |      0       |

_Docuvia Analysis_: **This is Docuvia's weakest quadrant.** While unit tests exist for the API server (50), the system completely lacks E2E automation for its web UI (`kg-engine` has no tests) and VS Code extension (0). Furthermore, it has zero Code Health tracking or Security/SBOM generation, areas where `tolaria` and `headroom` (90+) set strict ratchet gates. `hermes-agent` enforces hermetic testing environments with ~17k automated tests (90). Docuvia's CI pipeline needs an immediate overhaul to reach enterprise readiness.

## 5. Visualization & Interactive UX (Roadmap & Missing Features)

Evaluates interactive presentation of complex data, graph visualization, and advanced user interfaces.

| Core Feature                        | Docuvia | tolaria | GitNexus | graphify | code-review-graph | headroom | hermes-agent |
| :---------------------------------- | :-----: | :-----: | :------: | :------: | :---------------: | :------: | :----------: |
| **Interactive Graph Visualization** | **85**  |    0    |    85    |    80    |        95         |    0     |      0       |
| **Terminal UI (TUI) & Dashboard**   |  **0**  |    0    |    70    |    0     |         0         |    0     |      95      |

_Docuvia Analysis_: Docuvia now provides standalone interactive topology maps (D3-force) with symbol-level accuracy and blast radius highlighting (85), catching up with `GitNexus` and `graphify`. However, it still lacks a Terminal UI (TUI):

- **code-review-graph (95)** implements state-of-the-art D3.js interactive HTML graph generators.
- **GitNexus (85)** and **graphify (80)** offer robust visual cluster mappings and UI clients.
- **hermes-agent (95)** demonstrates advanced terminal UX (Ink-based TUI) and robust chat dashboard integrations.

Docuvia has successfully satisfied the roadmap demands for visual code exploration, though its terminal interface could still be expanded.

## Actionable Insights for Docuvia

1. **Immediate Risk: Integrate `headroom`/`hermes-agent` Token & Context Management**: Docuvia's massive token consumption during AST/RAG operations is unsustainable (Score: 15). We must adopt token compression strategies and strict prompt caching invariants (as seen in `hermes-agent`), profiling memory cost versus LSP daemon footprint.
2. **Completed Roadmap Priority: Interactive Graph Visualization**: Docuvia successfully adapted D3.js graph rendering techniques into `kg-engine` and CLI offline HTML exports (Score: 85), allowing users to visually explore codebase impact radiuses. Future iterations can focus on VS Code Webview integrations.
3. **Extensibility & Multi-Repo**: Integrate Cross-Repo grouping from `GitNexus` and study `hermes-agent`'s plugin/cron architecture to make Docuvia extensible beyond its rigid monorepo bounds.
4. **Technical Debt: Adopt `tolaria`'s Quality Gates**: Docuvia's lack of E2E tests and CodeScene/Codacy security scans (Score: 0) is unacceptable for a full-stack monorepo. We must implement a strict ratchet strategy for coverage and code health.
5. **Productization: Add Telemetry & i18n**: To graduate from an "engine" to a "product", Docuvia needs to observe user behavior (PostHog) and support localization, copying the exact patterns established in `tolaria`.
