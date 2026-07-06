# Local Setup & Dev Materials

Welcome to the Developer Guide for Docuvia. This section provides everything you need to set up the project locally, understand the monorepo structure, and dive into the low-level implementation details.

## Monorepo Layout

Docuvia is a full-stack TypeScript monorepo using `pnpm` workspaces.

```text
artifacts/
  api-server/                    Express API, MCP, ingestion, Agentic RAG routing
  cli/                           Headless terminal automation and pipeline tools
  kg-engine/                     React+Vite frontend dashboard
  mockup-sandbox/                UI prototyping environment (not for production)
  vscode-client/                 VS Code extension (VSIX)
lib/
  api-client-react/              Auto-generated React Query hooks (do not edit)
  api-spec/                      OpenAPI spec (openapi.yaml) — Single Source of Truth
  api-zod/                       Auto-generated Zod validators (do not edit)
  ast-core/                      WASM-based AST analysis microkernel
  core/                          Shared core services, intent router, and utilities
  db/                            Drizzle ORM schema + migrations
  integrations-openai-ai-server/ OpenAI-compatible LLM client wrapper
  plugins-ast/                   AST-specific language plugins
  plugins-domain/                Domain-specific extraction plugins (e.g. dashboard stats)
  test-utils/                    Shared testing factories and mocks
```

## Essential Developer Commands

To get started locally, you must use `pnpm` (Node 24+ required).

```bash
# 1. Install dependencies (npm/yarn are blocked)
pnpm install

# 2. Generate API Types (Must run after EVERY openapi.yaml change)
pnpm --filter @workspace/api-spec run codegen

# 3. Typecheck & Build
pnpm run typecheck
pnpm run build

# 4. Push Database Schema to Local PostgreSQL
pnpm --filter @workspace/db run push

# 5. Start Development Servers
pnpm --filter @workspace/api-server run dev   # Requires PORT env var
pnpm --filter @workspace/kg-engine run dev    # Vite dev server (18774)
```

> **Note on Tests**: Unit tests (`*.unit.test.ts`) are co-located with source files. Integration tests live in `artifacts/<package>/test/integration/`. Use `pnpm test` to run the suite.

## Deep Dive Materials

Below you will find specific, low-level technical deep-dives covering areas of the system that require specialized knowledge:

- **[Refactoring Plan](refactoring-plan.md)** — Structural refactor moving AST parsing core into `lib/`.

> The scored cross-project **[Capabilities Matrix](../analysis/capabilities-matrix.md)** now lives with the rest of the competitive analysis & gap registry.

## ⚙️ Core Engine Mechanisms

Before diving into specific product packages, contributors must understand the foundational pillars of the Docuvia engine. These mechanisms power everything from the API to the VS Code extension:

1. **[The AST Microkernel](../adr/ADR-020-unified-isomorphic-ast-microkernel.md)**
   Docuvia uses a WebAssembly (`web-tree-sitter`) AST engine to parse code across environments. This provides precise semantic diffing, symbol-based anchoring, and highly accurate blast radius detection without heavy backend parsing. (See also: [AST Deep Dive](patterns/wasm-ast-blast-radius.md)).
2. **[Knowledge Tiers (L1, L2, L3 Nodes)](../adr/ADR-005-knowledge-abstraction-strategy.md)**
   The database strictly organizes knowledge into three tiers: Global Taxonomy (L1), Project Modules/Packages (L2), and Implementation Decisions/Rationale (L3). Understanding this schema is mandatory when modifying the extraction pipeline or Agentic RAG routing.
3. **[Git-Isomorphic Storage (Orphan Branch)](../adr/ADR-017-tiered-storage-and-orphan-branch-graph-maintenance.md)**
   Docuvia fundamentally stores its generated knowledge directly back into the repository via a hidden orphan branch (`docuvia-knowledge`) alongside [JSONL + Granular Markdown](../adr/ADR-023-granular-markdown-storage.md). This ensures the knowledge graph remains 100% synchronized with Git commit history and survives environment resets.
4. **[Agentic RAG & Intent Routing](../adr/ADR-007-agentic-rag-routing.md)**
   Unlike naive vector search, Docuvia uses a 4-way classification router (Direct, Graph, Vector, Hybrid) with temporal decay. This ensures queries retrieve the most structurally relevant and up-to-date context without hallucinating stale relationships.
5. **[Asynchronous Metabolism](../adr/ADR-008-asynchronous-metabolism.md)**
   Heavy workloads (AST parsing, embedding generation, graph distillation) are processed offline via a background `metabolism-tick` worker. This prevents the main Node.js thread from blocking during large monorepo syncs.
6. **[Two-Phase Validity (Human-in-the-Loop)](../adr/ADR-011-two-phase-knowledge-validity.md)**
   To combat AI hallucinations, all newly extracted knowledge enters a `review_tasks` queue as "Unverified". It is only anchored into the trusted graph after human validation or rigorous multi-agent verification.
7. **[Database-as-IPC](../adr/ADR-014-sql-indexed-graph-and-database-as-ipc.md)**
   To avoid V8 Out-Of-Memory (OOM) crashes on large repositories, Docuvia strictly forbids passing massive ASTs or JSON payloads via memory. All cross-process communication happens by reading/writing to the local database.

## 🛠️ Engineering Patterns (Playbooks)

To solve "context fragmentation" across ADRs and READMEs, we maintain mechanism-centric playbooks. If you need to modify a core system, read its playbook to get the "Concept, Locations, Workflow, and Taboos" all in one place:

- **[View All Engineering Patterns](patterns/README.md)**

## 📦 Package Internals (Deep Dives)

Docuvia consists of multiple interdependent presentation packages. If you are contributing to a specific package, read its dedicated internal design docs below:

### VS Code Client (`artifacts/vscode-client`)

- **[VS Code Client Design Overview](vscode-client/00-router-overview.md)** — The entry point for understanding the extension architecture (13+ pages), covering the Knowledge Graph Tree View, Chat Participant (`@docuvia`), Hover Providers, and the Local Snapshot Service.

### API Server & MCP (`artifacts/api-server`)

- **[API Server Package](../packages/api-server.md)** — How Express routes, Agentic RAG (Intent Router), and the asynchronous Metabolism worker interact. Includes details on the MCP tooling exposed to AI IDEs.

### Knowledge Graph Web UI (`artifacts/kg-engine`)

- **[KG Engine Package](../packages/kg-engine.md)** — The React/Vite dashboard architecture used for human-in-the-loop review, graph visualization, and system health monitoring.

### Command Line Interface (`artifacts/cli`)

- **[CLI Package](../packages/cli.md)** — The internal call chains and implementation patterns for the headless terminal automation tools.
