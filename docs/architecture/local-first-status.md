# Local-First Architecture Concepts & Status (Docuvia)

_Project Focus: Prioritize Local-First features. Other features are deprioritized unless addressing critical bugs._

This document serves as the high-level index for tracking Docuvia's architectural pillars and benchmarking our progress against industry leaders (e.g., GitNexus, Cursor, Sourcegraph Cody, Copilot Workspace). 

Each pillar below links to a dedicated deep-dive tracking file that outlines our unique edge, fatal flaws, and the immediate roadmap required to achieve and surpass parity.

## Architectural Pillars & Competitor Analysis

* **[1. AST & Semantic Graph](comparisons/01-ast-semantic-graph.md)**
  * _Core Challenge:_ Achieving real-time incremental parsing and deep cross-language call graph resolution without sacrificing our L1-L3 intent tracking.

* **[2. Agentic RAG](comparisons/02-agentic-rag.md)**
  * _Core Challenge:_ Implementing robust hybrid search and intent routing temporal decay to ensure context retrievals never miss critical cross-module dependencies.

* **[3. MCP AI Interfaces](comparisons/03-mcp-ai-interfaces.md)**
  * _Core Challenge:_ Expanding our MCP toolset to provide granular blast radius and semantic search capabilities directly to LLMs.

* **[4. IDE & VS Code Client](comparisons/04-ide-vscode-client.md)**
  * _Core Challenge:_ Reducing agent response latency and improving inline diff applications to match native editor integrations.

* **[5. Data Pipeline & Sync](comparisons/05-data-pipeline-sync.md)**
  * _Core Challenge:_ Moving heavy ingestion workloads to background processes and optimizing SQLite lock contentions to prevent main thread blocking during large monorepo syncs.

* **[6. CLI & Core API Parity](comparisons/06-cli-core-api.md)**
  * _Core Challenge:_ Ensuring complete parity and consistent vocabulary (e.g., `sync` vs `refresh`) across our CLI, MCP, and VS Code presentation layers.
