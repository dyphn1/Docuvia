# Workspace Projects Capabilities Matrix & Cross-Project Analysis

This document provides a strict, horizontal comparison of the core features and capabilities across the 6 major projects in the workspace: **Docuvia**, **tolaria**, **GitNexus**, **graphify**, **code-review-graph**, and **headroom**.

## Scoring System
*   **0**: No feature provided / Lack of substantive mechanism.
*   **1-2**: Basic prototype, but mechanism is not rigorous or only lightly dependent.
*   **3-4**: Mature feature, standard configuration for the project.
*   **5**: Core moat of the project, or enforced as a strict CI/CD gate.

## 1. Knowledge Graph & Analysis
Evaluates the ability to parse code, track logic, and search.

| Core Feature | Docuvia | tolaria | GitNexus | graphify | code-review-graph | headroom |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **AST & Multi-language Parsing** | 4 | **0** | **5** | 4 | **5** | **0** |
| **Incremental Updates & Cache** | 4 | **0** | **5** | 2 | **5** | **0** |
| **Execution Flow & Impact Radius** | 4 | **0** | **5** | 3 | **5** | **0** |
| **Hybrid Search (FTS5 + Vector)** | 4 | **0** | **5** | **0** | **5** | **0** |

*Observation*: `Docuvia` recently shipped a powerful WASM-based AST engine (`web-tree-sitter`) enabling Git-Native smart blast radius analysis and semantic diffing without heavy background daemons, raising its score significantly. `tolaria` and `headroom` are terminal/UI apps and score 0 here. If `tolaria` needs local note relationship graphs, `GitNexus`'s underlying tech could be integrated.

## 2. AI & LLM Ecosystem
Evaluates MCP integration, RAG, Token optimization, and Multi-Agent collaboration.

| Core Feature | Docuvia | tolaria | GitNexus | graphify | code-review-graph | headroom |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **MCP Server & Tool Support** | **5** | **0** | **5** | 2 | **5** | 3 |
| **Built-in Subagents Workflow** | **5** | **0** | **5** | **0** | **0** | **0** |
| **Agentic RAG** | **5** | **0** | 4 | **0** | 4 | **0** |
| **Token Optimization & Compression**| **0** | **0** | 2 | **0** | 4 | **5** |

*Observation*: `Docuvia` has the most complete subagent workflow. `headroom` has a monopoly on Token Optimization (RTK), which all other projects severely lack (scoring 0).

## 3. Architecture & Modern Engineering
Evaluates developer experience, decoupling, and productization maturity.

| Core Feature | Docuvia | tolaria | GitNexus | graphify | code-review-graph | headroom |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **API-First Design & Codegen** | **5** | **0** | 3 | **0** | **0** | **0** |
| **Cross-Platform Native/VS Code** | **0** | **5** | **0** | **0** | 3 | **0** |
| **Telemetry & User Tracking (PostHog)**| **0** | **5** | **0** | **0** | **0** | 3 |
| **Internationalization (i18n/L10n)** | **0** | **5** | **0** | **0** | **0** | **0** |

*Observation*: `tolaria` shows the highest level of "product" maturity (i18n, telemetry). `Docuvia` and others lack telemetry and localization, which is a gap if pushing to end users.

## 4. QA, CI/CD & Security
Evaluates CI/CD strictness, automation, and defensive guards.

| Core Feature | Docuvia | tolaria | GitNexus | graphify | code-review-graph | headroom |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Strict Test Coverage (Ratchet Gate)**| 3 | **5** | **0** | **0** | 4 | 3 |
| **E2E Automation (Playwright)** | **0** | **5** | **5** | **0** | **0** | **0** |
| **Code Health Tracking (CodeScene)** | **0** | **5** | **0** | **0** | **0** | **0** |
| **Security Scanning & SBOM (Codacy)**| **0** | **5** | **0** | **0** | **0** | **5** |

*Observation*: `tolaria` has hell-tier quality gates. `Docuvia` lacks E2E (kg-engine has no tests) and security scans. `headroom` provides standard SBOM generation, crucial for enterprise.

## Actionable Insights (Cross-Pollination)

1. **Introduce `headroom`'s RTK to all projects**: AI projects like Docuvia consume massive tokens. Integrating `headroom`'s token compression proxy would drastically reduce costs.
2. **Propagate `tolaria`'s Quality Gates (CodeScene/Codacy)**: Docuvia is a massive full-stack monorepo but lacks E2E and static security gates. Adopt `tolaria`'s ratchet strategy.
3. **Bring `Docuvia`'s API-First Codegen to `GitNexus-web`**: Using OpenAPI -> Orval -> Zod + React Query is highly mature in Docuvia and would eliminate frontend/backend sync issues in GitNexus.
4. **Feed `GitNexus`'s Analysis Engine into `tolaria`**: Give the `tolaria` note-taking app Obsidian-like graph capabilities using the incremental SQLite engine from GitNexus.