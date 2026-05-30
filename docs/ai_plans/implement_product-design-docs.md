# Implementation Plan: Complete Product Design Documentation Suite

> **Prepared by:** Requirement Analyzer  
> **Date:** 2026-05-30  
> **Status:** Ready for execution  
> **Target directory:** `docs/design/`

---

## 1. Implementation Goals

Produce a complete, industry-standard software architecture documentation suite for the Docuvia project under `docs/design/`, aligned with arc42 and IEEE 1016 structures. The suite must:

1. Reflect the current, fully-completed state of the system (42/42 checklist items done).
2. Integrate the mandated **Coding Rules** as a first-class section of `08-crosscutting-concepts.md`.
3. Cross-reference all existing design artifacts (`artifacts/vscode-client/design/`, `docs/phase-*/`, `docs/roadmap-checklist.md`).
4. Be consumable by a human engineer unfamiliar with the codebase within one hour.
5. Be consumable by an AI agent as authoritative architectural context.

**Verifiable success criterion:** Running `grep -r "docs/design" docs/design/README.md` returns a link for every file in `docs/design/`. Each document contains a minimum of one verifiable section header matching its spec below.

---

## 2. Scope

### 2.1 New Files to Create (13 documents)

| # | File Path | Status |
|---|-----------|--------|
| 0 | `docs/design/README.md` | ❌ Create |
| 1 | `docs/design/01-introduction-and-goals.md` | ❌ Create |
| 2 | `docs/design/02-constraints.md` | ❌ Create |
| 3 | `docs/design/03-context-and-scope.md` | ❌ Create |
| 4 | `docs/design/04-solution-strategy.md` | ❌ Create |
| 5 | `docs/design/05-building-blocks.md` | ❌ Create |
| 6 | `docs/design/06-runtime-scenarios.md` | ❌ Create |
| 7 | `docs/design/07-deployment.md` | ❌ Create |
| 8 | `docs/design/08-crosscutting-concepts.md` | ❌ Create (contains Coding Rules) |
| 9 | `docs/design/09-architectural-decisions.md` | ❌ Create |
| 10 | `docs/design/10-quality-requirements.md` | ❌ Create |
| 11 | `docs/design/11-risks-and-debt.md` | ❌ Create |
| 12 | `docs/design/12-glossary.md` | ❌ Create |

### 2.2 Existing Files to Cross-Reference (not modify)

These files are authoritative sources. The new design docs must link to them but must NOT modify them.

| Existing File | Referenced By |
|---------------|---------------|
| `docs/roadmap-checklist.md` | 01, 11 |
| `docs/implementation-roadmap.md` | 04, 05 |
| `docs/vscode-extension-roadmap.md` | 05, 07 |
| `artifacts/vscode-client/design/ROUTER.md` | 05, 06 |
| `artifacts/vscode-client/design/ui-ux/user-journeys.md` | 06, 10 |
| `artifacts/vscode-client/design/chat-participant/slash-commands.md` | 06 |
| `artifacts/vscode-client/design/knowledge-graph/store.md` | 05, 06 |
| `docs/phase-1-foundation/` through `docs/phase-7-enhancements/` | 04, 05 |
| `docs/ai_plans/` | 09 |

---

## 3. Architecture Facts to Embed (Source: Code Audit)

The Document Writer agent must use these verified facts—not re-invent them.

### Monorepo Package Map

| Package | Location | Role |
|---------|----------|------|
| `@workspace/api-server` | `artifacts/api-server/` | Express 5 backend, all REST + MCP routes |
| `@workspace/kg-engine` | `artifacts/kg-engine/` | React + Vite frontend (Tailwind, shadcn/ui) |
| `@workspace/db` | `lib/db/` | Drizzle ORM schemas (PostgreSQL) |
| `@workspace/api-spec` | `lib/api-spec/` | `openapi.yaml` — single source of truth |
| `@workspace/api-zod` | `lib/api-zod/` | Zod validators (Orval-generated — DO NOT EDIT) |
| `@workspace/api-client-react` | `lib/api-client-react/` | React Query hooks (Orval-generated — DO NOT EDIT) |
| `@workspace/integrations-openai-ai-server` | `lib/integrations-openai-ai-server/` | OpenAI-compatible LLM client |
| `@workspace/vscode-client` | `artifacts/vscode-client/` | VS Code Extension |

### Core DB Schemas (all in `lib/db/src/schema/`)

`projects.ts`, `commits.ts`, `documents.ts`, `l1_tags.ts`, `l2_nodes.ts`, `l3_nodes.ts`,
`node_links.ts`, `review_tasks.ts`, `correction_examples.ts`, `prompt_templates.ts`,
`subscriptions.ts`, `notifications.ts`, `pull_requests.ts`, `project_integrations.ts`,
`llm_configs.ts`, `activity_log.ts`

### External Interfaces

| Interface | Protocol | Notes |
|-----------|----------|-------|
| PostgreSQL | TCP (Drizzle ORM) | Primary data store |
| OpenAI-compatible LLM | HTTPS REST | Via `integrations-openai-ai-server` |
| GitHub Webhooks | HTTPS POST | HMAC-SHA256 validated |
| Slack / Teams | HTTPS POST (webhook) | Fire-and-forget |
| VS Code Extension | VS Code Extension API | `vscode.commands`, TreeView, Webview |
| Copilot Chat | `@docuvia` participant | Slash commands: /explore /query /extract /help |
| MCP Clients (AI IDEs) | HTTP (Express routes) | `/mcp/*` endpoints |
| Git CLI | `child_process.execFile` | Local repository ingestion |
| SVN CLI | `child_process.execFile` | `svn log --xml` + `svn diff` |

---

## 4. Detailed Document Specifications

Each specification below contains the exact section structure the Document Writer must produce.

---

### File 0: `docs/design/README.md` — Master Index

**Purpose:** Entry point for the entire design documentation suite.

**Required sections:**

```
# Docuvia — Software Architecture & Design Documentation

> One-line product pitch

## About This Documentation
(Briefly explain arc42 structure, state this is the authoritative post-implementation design record for v1.0)

## Documentation Index

| # | Document | Description |
|---|----------|-------------|
| — | README.md (this file) | Master index |
| 1 | 01-introduction-and-goals.md | Vision, quality goals, stakeholders |
| 2 | 02-constraints.md | Technical, org, regulatory constraints |
| 3 | 03-context-and-scope.md | System boundary, external interfaces |
| 4 | 04-solution-strategy.md | Key technology choices and rationale |
| 5 | 05-building-blocks.md | Monorepo packages, module responsibilities |
| 6 | 06-runtime-scenarios.md | Key runtime flows (ingest, generate, query) |
| 7 | 07-deployment.md | Deployment topology, environments |
| 8 | 08-crosscutting-concepts.md | Domain model, architecture patterns, Coding Rules |
| 9 | 09-architectural-decisions.md | ADR index + key decisions |
| 10 | 10-quality-requirements.md | Quality goals, NFRs, performance targets |
| 11 | 11-risks-and-debt.md | Known gaps and technical debt |
| 12 | 12-glossary.md | Full product terminology |

## VS Code Extension Design (Supplementary)
(Link to artifacts/vscode-client/design/ROUTER.md and its subdocs)

## Related Documents
(Link to docs/roadmap-checklist.md, docs/implementation-roadmap.md, AGENTS.md)
```

---

### File 1: `docs/design/01-introduction-and-goals.md`

**Purpose:** Establish product vision, quality goals, and stakeholder map.

**Required sections:**

```
# 1. Introduction and Goals

## 1.1 Product Vision
(What Docuvia is: Universal VCS Knowledge Graph Engine — ingests commit history, documents,
build artifacts → constructs a three-tier knowledge graph → exposes via REST, MCP, VS Code UI)

## 1.2 Core Requirements (Top 5 drivers)
1. Ingest any Git/SVN repository and produce a queryable knowledge graph
2. Three-tier structure: L1 (global tags) → L2 (modules) → L3 (decision records)
3. Human-in-the-loop review queue for AI-generated nodes
4. Agentic RAG over the knowledge graph (MCP-compatible)
5. VS Code integration for inline, editor-native access

## 1.3 Quality Goals
(Use a table: Quality Goal | Motivation | Priority)
- Accuracy of generated L3 decision records
- Latency of `/mcp/query` at p95
- Observability (structured logs, activity feed)
- Extensibility (new VCS providers, LLM adapters)
- Maintainability (API-first, codegen, monorepo conventions)

## 1.4 Stakeholders
(Table: Role | Concern | Key Touch Points)
- Developer / Team Lead: Understand codebase decisions at file/module level
- AI Agent / IDE: MCP-compatible tool calls for context augmentation
- Project Manager: Dashboard stats, review task queue
- SaaS Operator: Deployment, multi-tenant config, billing (future)
```

---

### File 2: `docs/design/02-constraints.md`

**Purpose:** Document all fixed constraints the architecture must respect.

**Required sections:**

```
# 2. Constraints

## 2.1 Technical Constraints
- Runtime: Node.js 24+, TypeScript (strict), ESM
- Package Manager: pnpm (npm/yarn blocked by preinstall hook)
- Database: PostgreSQL (Drizzle ORM) — no ORM switching
- API contract: OpenAPI 3.x (`lib/api-spec/openapi.yaml`) — single source of truth; 
  types must not be hand-written
- Generated code: `lib/api-zod/src/generated/` and `lib/api-client-react/src/generated/` 
  are read-only; run `pnpm --filter @workspace/api-spec run codegen` after every spec change
- LLM: OpenAI-compatible endpoint only (no native Ollama adapter currently)
- PORT env variable: API server throws on startup if missing

## 2.2 Organizational Constraints
- All AI implementation plans saved under `docs/ai_plans/`
- VS Code extension design docs must reside under `artifacts/vscode-client/design/`
- Agents must not modify source code — only planning agents produce Markdown plans
- No manual API type creation — Orval generates everything from OpenAPI spec

## 2.3 Conventions (Coding Rules)
(Forward reference to Section 8.3 in docs/design/08-crosscutting-concepts.md)
```

---

### File 3: `docs/design/03-context-and-scope.md`

**Purpose:** Define system boundaries and all external communication partners.

**Required sections:**

```
# 3. Context and Scope

## 3.1 System Context Diagram
(ASCII or Mermaid diagram showing Docuvia at center with:)
- Inbound: Developer/User → kg-engine UI (port 18774)
- Inbound: AI IDE/Agent → MCP endpoints (port 8080)
- Inbound: GitHub Webhook → /github/webhooks (HMAC-SHA256)
- Inbound: VS Code Extension → /extensions/vscode API
- Data sources: Git CLI (local), SVN CLI (local), File Upload (multipart)
- Outbound: PostgreSQL (Drizzle), OpenAI-compatible LLM API, Slack/Teams webhooks

## 3.2 External Interfaces Table
(One row per interface: Partner | Direction | Protocol | Auth | Key Endpoints/Commands)

## 3.3 System Boundary
What is inside Docuvia:
- Ingestion pipeline (Git, SVN, documents, build artifacts)
- Knowledge construction (L1→L2→L3 generation)
- Knowledge graph storage and traversal
- Review task queue and feedback loop
- MCP query layer and Agentic RAG
- Dashboard, export, subscriptions, notifications

What is outside Docuvia:
- LLM model weights / inference infrastructure
- Git/SVN hosting providers (GitHub, GitLab, etc.)
- VS Code itself (Docuvia is a consumer of its extension API)
- External CI/CD infrastructure
```

---

### File 4: `docs/design/04-solution-strategy.md`

**Purpose:** Explain the key technology choices and the rationale behind each.

**Required sections:**

```
# 4. Solution Strategy

## 4.1 Technology Choices

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Language | TypeScript (strict) | Type safety across full stack; codegen compatibility |
| Backend Framework | Express 5 (ESM) | Minimal, well-understood; async-native in v5 |
| ORM | Drizzle ORM | Type-safe SQL; schema-as-code; migration support |
| Database | PostgreSQL | JSONB for embeddings; proven ACID; rich indexing |
| Frontend | React 18 + Vite + shadcn/ui | Fast HMR; composable design system |
| API Contract | OpenAPI 3.x + Orval codegen | Single source of truth; eliminates drift |
| Vector Search | In-memory cosine similarity | No external vector DB dependency in v1; embeddings stored as JSONB |
| LLM Integration | OpenAI-compatible interface | Provider-agnostic; OpenRouter/Azure compatible |
| IDE Integration | VS Code Extension API | Target developer audience; Copilot Chat integration |
| MCP Layer | Custom Express routes | Compatibility with AI agent toolchains (Cursor, Copilot, etc.) |

## 4.2 Top-Level Decomposition
(Description of the 5 conceptual layers:)
1. Input Layer (ingestion adapters)
2. Knowledge Construction Layer (LLM pipeline: commit filter → L1 → L2 → L3)
3. Knowledge Graph (storage: PostgreSQL + in-memory vector, traversal, cross-project linking)
4. Query Layer (REST API, MCP tools, Agentic RAG)
5. Presentation Layer (kg-engine web UI, VS Code extension, Copilot Chat participant)

## 4.3 API-First Principle
(Explain the OpenAPI → Orval → Zod + React Query codegen chain; why hand-writing types is forbidden)

## 4.4 Human-in-the-Loop Strategy
(Explain review_tasks queue, correction_examples feedback loop, noise detection)
```

---

### File 5: `docs/design/05-building-blocks.md`

**Purpose:** Static structure — package hierarchy, responsibilities, and key internal modules.

**Required sections:**

```
# 5. Building Block View

## 5.1 Level 1 — Monorepo Packages
(Table mirroring Section 3 of AGENTS.md; expand with: Package | Location | Depends On | Key Exports)

## 5.2 Level 2 — api-server Internal Modules
Key directories and their responsibilities:
- `src/routes/` — Express route handlers (one file per domain)
- `src/lib/` — Internal services (intent-router, github-client, slack-teams-client, 
  extensions-service, build-artifact-parser, document-parser, svn-client, embedding, logger)
- Generated type imports from `@workspace/api-zod`

## 5.3 Level 2 — kg-engine Internal Structure
- `src/pages/` — Route-level React components (dashboard, query, review, pipeline, etc.)
- `src/components/` — Shared UI components
- Consumes `@workspace/api-client-react` hooks

## 5.4 Level 2 — db Package Schemas
(Table of all 16 schema files and the entity they represent)

## 5.5 Level 2 — VS Code Extension
(Link to artifacts/vscode-client/design/ROUTER.md for full breakdown)
Key source files: extension.ts, ChatParticipant.ts, KnowledgeStore.ts, TaskRunner.ts,
KnowledgeGraphTreeProvider.ts, TaskQueueTreeProvider.ts, DashboardPanel.ts,
SearchResultsPanel.ts, DocuviaCodeLensProvider.ts, DocuviaHoverProvider.ts

## 5.6 Dependency Constraints
- `lib/*` packages may NOT import from `artifacts/*`
- `artifacts/api-server` may import from all `lib/*` packages
- `artifacts/kg-engine` may import from `lib/api-client-react` only
- `artifacts/vscode-client` is standalone; communicates via REST to api-server
```

---

### File 6: `docs/design/06-runtime-scenarios.md`

**Purpose:** Key runtime flows showing how components collaborate at runtime.

**Required sections:**

```
# 6. Runtime View

## 6.1 Scenario: Git Repository Ingestion
(Mermaid sequence diagram: User → kg-engine → POST /projects/:id/ingest/git → 
api-server → git CLI → commits table → scoreCommit() filter → return IngestResult)

## 6.2 Scenario: Knowledge Generation Pipeline (diff → L1/L2/L3)
(Mermaid sequence diagram: POST /projects/:id/generate → 
Step 1: fetch unprocessed commits → 
Step 2: L1 tagger (LLM) → 
Step 3: L2 extractor (LLM + embedding) → 
Step 4: L3 generator (LLM + few-shot corrections) → 
Step 5: cross-project link detection → 
Step 6: noise detection → 
review_tasks created)

## 6.3 Scenario: Agentic RAG Query
(Mermaid sequence diagram: MCP client → POST /mcp/query → 
intent-router (LLM classification: vector|graph|direct|hybrid) → 
route to embedding search / graph traversal / direct lookup / hybrid → 
return ranked result)

## 6.4 Scenario: Review Task Resolution
(Sequence: Reviewer → Review UI → POST /review_tasks/:id/resolve → 
stores correction_examples → generate pipeline fetches corrections as few-shot)

## 6.5 Scenario: VS Code Knowledge Extraction
(Link to artifacts/vscode-client/design/command-palette/run-extraction.md for full flow)
High-level: docuvia.runExtraction → TaskRunner → POST /extensions/vscode/extract → 
api-server → generate pipeline → result stored in KnowledgeStore

## 6.6 Scenario: GitHub PR Analysis
(POST webhook → HMAC validation → fetchPrCommits + fetchPrDiff → 
L2/L3 impact lookup → postPrComment with knowledge graph context)
```

---

### File 7: `docs/design/07-deployment.md`

**Purpose:** Infrastructure topology, environment configuration, and operational concerns.

**Required sections:**

```
# 7. Deployment View

## 7.1 Deployment Topology
(ASCII or Mermaid diagram:)
- Single-host deployment (current): api-server (port 8080) + kg-engine (port 18774) + PostgreSQL
- VS Code Extension: installed locally in developer IDE; connects to api-server over HTTP

## 7.2 Environment Variables
| Variable | Required | Description |
|----------|----------|-------------|
| PORT | Yes | API server port (throws on missing) |
| DATABASE_URL | Yes | PostgreSQL connection string |
| OPENAI_API_KEY (or compatible) | Yes | LLM endpoint credential |
| GITHUB_WEBHOOK_SECRET | Conditional | Required if GitHub PR integration is active |
| Additional integration secrets | Conditional | Slack/Teams webhook URLs (stored in DB) |

## 7.3 Development Commands
(Mirror from AGENTS.md: pnpm install, pnpm --filter db run push, dev commands, build, test)

## 7.4 CI/CD
- GitHub Actions: `.github/workflows/ci.yml`
- Jobs: lint + typecheck-and-build (parallel)
- Runtime: pnpm 9, Node.js 22 (CI) / Node.js 24 (production)

## 7.5 Deployment Considerations
- No Docker image provided in v1 — raw Node.js process deployment
- Static frontend assets served separately (Vite dev server in development, 
  static file serving in production — not yet wired)
- VS Code extension packaged as `.vsix` (build step: `vsce package` — not yet scripted)
- Replit-hosted development: multi-provider LLM is Replit-provisioned; 
  self-hosting requires adding in-repo LLM adapters (see Known Limitations)
```

---

### File 8: `docs/design/08-crosscutting-concepts.md` ← CRITICAL: Contains Coding Rules

**Purpose:** Concepts that cut across multiple building blocks: domain model, architectural patterns, and mandated coding conventions.

**Required sections:**

```
# 8. Crosscutting Concepts

## 8.1 Domain Model

### Three-Tier Knowledge Graph
(Explain the L1→L2→L3 hierarchy with a Mermaid entity-relationship diagram)

L1 Tags:
- Global, cross-project classification pool
- Human-anchored; AI-suggested candidates go through review queue
- Table: l1_tags (id, name, description, projectId, createdAt)

L2 Nodes (Modules):
- Package / Module / Component, scoped per project
- Linked to L1 tags via junction table
- Store embedding vector (JSONB) for semantic search
- Table: l2_nodes (id, projectId, name, type, description, embedding, confidence, createdAt)

L3 Nodes (Decision Records):
- Implementation rules, decisions, rationale
- Scoped per L2 node
- Store embedding vector; linked to source commits
- Table: l3_nodes (id, l2NodeId, projectId, title, content, type, embedding, confidence, createdAt)

Node Links:
- Directed relationships between L2/L3 nodes (including cross-project)
- Table: node_links (id, sourceId, sourceType, targetId, targetType, linkType, projectId)

### Supporting Entities
- review_tasks: Human-in-the-loop queue (anchor/merge/reject types)
- correction_examples: Few-shot feedback from approved human corrections
- prompt_templates: Per-project overridable LLM prompts (L1/L2/L3 types)
- subscriptions + notifications: Cross-team watch and event feed
- pull_requests: GitHub PR analysis records

## 8.2 Architecture Patterns

### API-First with Codegen
(OpenAPI spec → Orval → Zod validators + React Query hooks)
Invariant: NEVER hand-write API types. Edit openapi.yaml → run codegen → commit generated files.

### Adapter Pattern for VCS Providers
(Git: child_process.execFile + git CLI; SVN: child_process.execFile + svn CLI)
(New providers must implement the same IngestInput/IngestResult contract)

### Agentic RAG Intent Routing
(4-way LLM-classified routing: vector | graph | direct | hybrid)
(intent-router.ts classifies the natural language query; routes to appropriate search strategy)

### Human-in-the-Loop Feedback Loop
(review_tasks → correction_examples → few-shot prompt injection in generate pipeline)

### MVC for UI (VS Code Extension)
- View Layer: renders only UI state — no logic, no API calls
- Controller Layer: handles VS Code events and commands; calls services; updates TreeView/Webview state
- Model Layer (KnowledgeStore): manages YAML snapshot state; syncs to `.docuvia/` files on disk

## 8.3 Coding Rules

> These rules are mandatory for all TypeScript source code in this project.
> Violations discovered during code review or automated lint checks must be fixed before merge.

### 8.3.1 Defensive Design

**Rule: Flatten conditional logic with early return / throw.**

All functions must use guard clauses (early return or early throw) to handle invalid states
at the top of the function. Nested if/else chains are prohibited.

```typescript
// ❌ FORBIDDEN — nested if/else
function processNode(node: L2Node | null) {
    if (node) {
        if (node.embedding) {
            // ... logic
        } else {
            throw new Error("missing embedding");
        }
    } else {
        return null;
    }
}

// ✅ CORRECT — early return / early throw
function processNode(node: L2Node | null) {
    if (!node) return null;
    if (!node.embedding) throw new Error("missing embedding");
    // ... logic
}
```

Goals: All logic paths must be clear, reliable, and independently traceable.

### 8.3.2 UI Architecture: MVC

All UI code (both kg-engine React components and VS Code Extension UI) must respect
a strict three-layer separation:

| Layer | Responsibility | Forbidden |
|-------|---------------|-----------|
| **View** | Renders JSX/HTML from props and state | Business logic, API calls, direct state mutations |
| **Controller** | Handles events; orchestrates service calls; updates state | Direct DOM manipulation, database access |
| **Model** | Manages data persistence; syncs to DB/file | Rendering, UI events |

In the VS Code extension:
- `KnowledgeGraphTreeProvider`, `DashboardPanel`, `SearchResultsPanel` = View
- `extension.ts` command handlers, `ChatParticipant.ts` = Controller
- `KnowledgeStore.ts` = Model (YAML ↔ disk)

In the React frontend:
- `.tsx` page/component files = View
- `useQuery`/`useMutation` hook callsites and event handlers = Controller
- `@workspace/api-client-react` generated hooks + React Query cache = Model

### 8.3.3 POP Design (Protocol-Oriented Programming)

All API interfaces and database access layers must be defined as TypeScript interfaces
(protocols) before implementation.

Rules:
- Every service that calls the database must implement an interface defined in the same file or a `types.ts` sibling
- Every service that calls the LLM must depend on the `LLMClient` interface from `lib/integrations-openai-ai-server/`
- Never instantiate a concrete class from a consumer — depend on the interface

This enables:
- Unit testing with mock implementations
- Provider swapping (e.g., LLM provider, VCS adapter)
- Clear contract documentation

```typescript
// ✅ Define the protocol first
interface VcsIngestAdapter {
    ingest(input: IngestInput): Promise<IngestResult>;
}

// ✅ Implement against the protocol
class GitIngestAdapter implements VcsIngestAdapter { ... }
class SvnIngestAdapter implements VcsIngestAdapter { ... }
```

### 8.3.4 OOP for UI Structures

UI components and their cooperative behavior must be modeled as classes or well-defined
objects with encapsulated state and behavior.

Rules:
- VS Code Providers (TreeDataProvider, WebviewPanel) must be classes
- Component state must be encapsulated — no scattered module-level mutable variables
- Cooperative behavior between components (e.g., TreeView refresh after command execution)
  must be mediated by explicit event emitters or observable state, not direct cross-object calls

### 8.3.5 Code Style Rules

| Rule | Value |
|------|-------|
| Maximum function length | **100 lines** |
| Maximum line length | **100 characters** |
| Indentation | **4 spaces** |
| Call-chain alignment | Each chained call on its own indented line |
| Import order | Node built-ins → third-party → workspace packages → relative |

**Call-chain alignment example:**

```typescript
// ❌ FORBIDDEN — chain on single line
const results = await db.select().from(l2NodesTable).where(eq(l2NodesTable.projectId, id)).limit(50);

// ✅ CORRECT — each call on its own indented line
const results = await db
    .select()
    .from(l2NodesTable)
    .where(eq(l2NodesTable.projectId, id))
    .limit(50);
```

**Enforcement:** These rules should be encoded in `.eslintrc` / `eslint.config.js` where tooling
supports them (max-lines-per-function, max-len). The call-chain and indentation rules are
enforced by Prettier with `tabWidth: 4` and `printWidth: 100`.
```

---

### File 9: `docs/design/09-architectural-decisions.md`

**Purpose:** Index all key architectural decisions with rationale.

**Required sections:**

```
# 9. Architectural Decisions

## 9.1 ADR Index
(Introductory paragraph explaining ADR format used)

## 9.2 Decision Records

### ADR-001: OpenAPI as Single Source of Truth
- Status: Accepted
- Context: Multiple consumers (React frontend, Express backend, VS Code extension) need the same types
- Decision: All API types generated from lib/api-spec/openapi.yaml via Orval
- Consequence: No hand-written fetch code; codegen must run after every spec change

### ADR-002: PostgreSQL with JSONB for Embeddings (No External Vector DB)
- Status: Accepted (v1)
- Context: Need semantic search without external infrastructure dependency
- Decision: Store embeddings as JSONB in l2_nodes/l3_nodes; cosine similarity in-memory
- Consequence: Does not scale beyond ~100K nodes; migration to Qdrant/Chroma planned for v2

### ADR-003: Three-Tier Knowledge Graph (L1/L2/L3)
- Status: Accepted
- Context: Need to represent global taxonomy, module structure, and decision records separately
- Decision: L1 (global tags) → L2 (per-project modules) → L3 (per-module decisions)
- Consequence: All ingestion pipelines must produce nodes in this hierarchy

### ADR-004: OpenAI-Compatible LLM Interface Only
- Status: Accepted (v1)
- Context: Multi-provider support required but Replit provisions it at platform level
- Decision: All LLM calls go through lib/integrations-openai-ai-server; no native Ollama adapter
- Consequence: Self-hosting requires adding in-repo adapters for Anthropic/Gemini/Ollama

### ADR-005: MVC Pattern for UI Layers
- Status: Accepted
- Context: Mixed logic and rendering in early prototype caused untestable components
- Decision: Strict View/Controller/Model separation in both React and VS Code extension
- Consequence: Enforced via coding rules in Section 8.3.2

### ADR-006: Human-in-the-Loop via Review Queue
- Status: Accepted
- Context: LLM outputs require human validation before anchoring to knowledge graph
- Decision: All AI-generated nodes create review_tasks; generation also creates noise/merge tasks automatically
- Consequence: review_tasks table is central to data quality; must not be bypassed

### ADR-007: Incremental Ingestion via Cursor Columns
- Status: Accepted
- Context: Re-ingesting full history on every run is prohibitively slow
- Decision: lastGitIngestedAt / lastSvnRevision cursor columns on projects; processedAt on commits
- Consequence: mode: "full" | "incremental" must be respected in all ingest routes

## 9.3 Deferred Decisions
(Reference docs/ai_plans/ for implementation plans that represent future decisions)
```

---

### File 10: `docs/design/10-quality-requirements.md`

**Purpose:** Quality goals, NFRs, measurable performance targets.

**Required sections:**

```
# 10. Quality Requirements

## 10.1 Quality Tree
(Structured breakdown: Quality Goal → Sub-characteristic → Scenario)

## 10.2 Quality Scenarios

### 10.2.1 Performance
| Scenario | Stimulus | Response | Target |
|----------|---------|---------|--------|
| MCP query latency | Single /mcp/query request | Response time | p95 < 2s (excluding LLM call) |
| Git ingestion throughput | 1000 commits | Ingestion time | < 30s |
| L3 generation | 50 commits batch | Pipeline completion | < 5 min (LLM-bound) |
| Dashboard load | GET /dashboard | Response time | < 500ms |

### 10.2.2 Reliability
| Scenario | Stimulus | Response | Target |
|----------|---------|---------|--------|
| GitHub webhook | Invalid HMAC signature | Rejection | 401, no processing |
| LLM unavailable during generation | API timeout | Graceful degradation | Error logged; partial results saved; no data loss |
| Missing PORT env | Server startup | Explicit throw | Error message with variable name |

### 10.2.3 Maintainability
- All API types generated from OpenAPI spec (zero drift tolerance)
- Unit test coverage: colocated `*.unit.test.ts` per module
- Integration tests wrapped in withRollback() for zero DB side-effects

### 10.2.4 Extensibility
- New VCS providers: implement VcsIngestAdapter interface, register in routes/ingest.ts
- New LLM providers: implement LLMClient interface in lib/integrations-openai-ai-server
- New MCP tools: add OpenAPI path + Orval codegen + route handler

## 10.3 Known Acceptance Test Gaps
(Reference docs/testcase-roadmap.md and docs/ui-testing-strategy.md)
```

---

### File 11: `docs/design/11-risks-and-debt.md`

**Purpose:** Known gaps and technical debt (sourced from roadmap-checklist Known Limitations section).

**Required sections:**

```
# 11. Risks and Technical Debt

## 11.1 Risk Register

| ID | Risk | Severity | Impact | Mitigation / Status |
|----|------|----------|--------|---------------------|
| R-01 | In-memory vector search does not scale past ~100K nodes | 🟠 Medium | Query accuracy degrades | Planned: migrate to Qdrant/Chroma in v2 |
| R-02 | Multi-hop impact traversal missing (one-hop only) | 🟠 Medium | Incomplete dependency analysis | See docs/ai_plans/ for planned BFS/DFS implementation |
| R-03 | Cross-project link activation not wired (review approval → node_links row) | 🟠 Medium | Cross-project knowledge graph incomplete | Review resolution needs wiring to node_links insert |
| R-04 | No Ollama / local LLM adapter | 🟡 Low | Self-hosting without paid API key is blocked | Requires new LLM adapter class |
| R-05 | scoreCommit() duplicated across ingest.ts and github_webhooks.ts | 🟢 Minor | Drift risk between filter logic | Extract to shared utility |
| R-06 | Markdown export format unverified (export.ts returns JSON only) | 🟢 Minor | Roadmap specifies JSON + Markdown | Audit export.ts; add Markdown serializer if missing |
| R-07 | VS Code extension has no .vsix build script | 🟡 Low | Cannot distribute extension | Add vsce package step to CI |
| R-08 | Multi-root workspace bugs in VS Code extension (acceptL1Tags) | 🔴 Critical | Data corruption in multi-root workspaces | See artifacts/vscode-client/design/ui-ux/user-journeys.md Bugs A-1, A-2, A-3 |
| R-09 | TaskRunner always writes l2_module_id: "" — orphaned decisions | 🔴 Critical | All extracted decisions unlinked from modules | See user-journeys.md Bug B-1 |

## 11.2 Technical Debt Register

| ID | Debt | Type | Priority |
|----|------|------|----------|
| D-01 | scoreCommit() code duplication | Code quality | 🟢 Low |
| D-02 | No .vsix packaging in CI | Build automation | 🟡 Medium |
| D-03 | Static file serving for kg-engine not wired for production | Deployment | 🟡 Medium |
| D-04 | Test suite coverage limited (mostly route contracts) | Testing | 🟡 Medium |
| D-05 | CodeLens uses line-number anchoring (drifts on insert) | Feature | 🟡 Medium |
| D-06 | No CLI for natural language queries (web UI only) | Feature | 🟢 Low |

## 11.3 References
- Full Known Limitations: [docs/roadmap-checklist.md](../roadmap-checklist.md#known-limitations--functional-gaps)
- VS Code extension bugs: [artifacts/vscode-client/design/ui-ux/user-journeys.md](../../artifacts/vscode-client/design/ui-ux/user-journeys.md#known-active-bugs)
```

---

### File 12: `docs/design/12-glossary.md`

**Purpose:** Authoritative definitions for all product-domain terms.

**Required sections:**

```
# 12. Glossary

## Core Domain Terms

| Term | Definition |
|------|-----------|
| **L1 Tag** | A global classification label applied across all projects. Represents top-level architectural or functional areas (e.g., "Security", "Networking", "Build System"). Stored in `l1_tags` table. |
| **L2 Node** | A Package, Module, or Component scoped to a single project. Extracted from commit paths and diff structure. Linked to one or more L1 Tags. Stores an embedding vector. |
| **L3 Node** | An Implementation Decision, Rule, or Rationale record scoped to an L2 Node. The deepest level of the knowledge graph; the primary output of the generate pipeline. |
| **Node Link** | A directed relationship between two L2 or L3 nodes (intra- or cross-project). Created by human approval or automated cross-project similarity detection. |
| **Generate Pipeline** | The 6-step LLM pipeline that transforms raw commits into L1/L2/L3 nodes. Steps: fetch commits → L1 tagging → L2 extraction → L3 generation → cross-project detection → noise detection. |
| **Ingest** | The process of importing commit history from a VCS (Git or SVN) or uploading documents into Docuvia's database. Produces `commits` and `documents` rows. |
| **Agentic RAG** | Retrieval-Augmented Generation with intent routing. A 4-way LLM-classified query strategy (vector | graph | direct | hybrid) that selects the best retrieval method for a natural language query. |
| **Intent Router** | The LLM-powered component (`intent-router.ts`) that classifies incoming `/mcp/query` requests and routes them to the appropriate search strategy. |
| **Review Task** | A human-in-the-loop work item in the `review_tasks` table. Created by the generate pipeline for AI-suggested nodes requiring human approval, merge, or rejection. Types: anchor, merge, reject. |
| **Correction Example** | A human-approved correction stored in `correction_examples`. Injected as few-shot examples into subsequent generate pipeline runs to improve LLM accuracy. |
| **Prompt Template** | A per-project overridable LLM system prompt for L1, L2, or L3 generation. Falls back to a default if not set. Stored in `prompt_templates`. |
| **MCP** | Model Context Protocol — the HTTP-based protocol used by AI IDEs (Cursor, Copilot, etc.) to call Docuvia's knowledge graph tools. Exposed via `/mcp/*` routes. |
| **Impact Analysis** | A traversal of the node graph to determine what other modules/decisions are affected by a change to a given node. Currently one-hop via `node_links`; multi-hop BFS planned. |
| **Cross-Project Link** | A `node_links` row connecting L2 nodes from different projects, detected via cosine similarity ≥ 0.85. Requires human review approval to activate. |
| **Incremental Ingestion** | An ingestion mode that processes only new commits since the last run, using cursor columns (`lastGitIngestedAt`, `lastSvnRevision`) on the `projects` table. |
| **Noise Detection** | An automated post-generation step that flags low-usage L1 tags and near-duplicate tag names, creating `anchor`/`merge` review tasks for human resolution. |
| **VS Code Client** | The VS Code extension in `artifacts/vscode-client/`. Provides Knowledge Graph TreeView, Command Palette commands, Copilot Chat participant, CodeLens, and Hover providers. |
| **KnowledgeStore** | The singleton service (`KnowledgeStore.ts`) in the VS Code extension that manages the in-memory snapshot of the `.docuvia/` YAML files and syncs changes to disk. |
| **`.docuvia/`** | The per-workspace configuration directory created by the VS Code extension's `Init Project` command. Contains `l1_tags.yaml`, `l2_modules.yaml`, and `l3_decisions/`. |
| **Orval** | The codegen tool that reads `lib/api-spec/openapi.yaml` and generates Zod validators (`lib/api-zod/`) and React Query hooks (`lib/api-client-react/`). |
| **scoreCommit()** | The signal/noise scoring function applied during ingestion to filter out low-value commits (chore, merge, auto-generated). Returns a score; low-scoring commits are skipped. |

## Acronyms

| Acronym | Expansion |
|---------|-----------|
| VCS | Version Control System |
| MCP | Model Context Protocol |
| RAG | Retrieval-Augmented Generation |
| LLM | Large Language Model |
| ADR | Architectural Decision Record |
| ORM | Object-Relational Mapper |
| NFR | Non-Functional Requirement |
| POP | Protocol-Oriented Programming |
| OOP | Object-Oriented Programming |
| MVC | Model-View-Controller |
| HMAC | Hash-based Message Authentication Code |
| JSONB | JSON Binary (PostgreSQL column type) |
| ESM | ECMAScript Modules |
| HMR | Hot Module Replacement |
```

---

## 5. Approach / Methodology

The Document Writer agent must execute this plan in the following order:

1. **Create the directory:** `docs/design/` (if not present)
2. **Write documents in order** from `README.md` → `12-glossary.md`; section numbering is critical for the master index to link correctly
3. **All Mermaid diagrams** must be included as fenced ` ```mermaid ``` ` blocks
4. **All cross-references** must use relative Markdown links (e.g., `[see Section 8.3](08-crosscutting-concepts.md#83-coding-rules)`)
5. **Coding Rules in `08-crosscutting-concepts.md`** must include all five sub-sections (8.3.1 through 8.3.5) verbatim as specified above, including the TypeScript code examples
6. **Do NOT modify** any file outside `docs/design/`

---

## 6. Affected Packages / Directories

| Directory | Action |
|-----------|--------|
| `docs/design/` | **Create** (new directory + 13 new files) |
| `docs/roadmap-checklist.md` | Reference only (no modification) |
| `artifacts/vscode-client/design/` | Reference only (no modification) |
| `lib/`, `artifacts/` | Reference only (no modification) |

---

## 7. Verification Checklist

The Task Verifier must confirm:

- [ ] `docs/design/` directory exists
- [ ] All 13 files exist: `README.md`, `01-` through `12-`
- [ ] `README.md` contains a table with links to all 12 numbered docs
- [ ] `08-crosscutting-concepts.md` contains all 5 coding rule sub-sections (8.3.1–8.3.5)
- [ ] `08-crosscutting-concepts.md` contains TypeScript `❌ FORBIDDEN` and `✅ CORRECT` examples for: early return pattern, call-chain alignment
- [ ] `11-risks-and-debt.md` lists at minimum the 9 risk items from `docs/roadmap-checklist.md Known Limitations`
- [ ] `12-glossary.md` contains at minimum 15 domain term definitions
- [ ] No source code files (`.ts`, `.tsx`, `.js`) were modified
- [ ] All Mermaid diagrams are in fenced code blocks (renderable in GitHub)
