# 5. Building Block View

## 5.1 Level 1 — Monorepo Packages

| Package | Location | Depends On | Key Exports / Role |
|---|---|---|---|
| `@workspace/api-server` | `artifacts/api-server/` | `@workspace/db`, `@workspace/api-zod`, `@workspace/integrations-openai-ai-server` | All Express routes, MCP endpoints, ingestion pipeline, generate pipeline, Agentic RAG |
| `@workspace/kg-engine` | `artifacts/kg-engine/` | `@workspace/api-client-react` | React + Vite frontend: Dashboard, Pipeline, Query, Review, Settings pages |
| `@workspace/db` | `lib/db/` | (none within workspace) | Drizzle ORM schema definitions, migration helpers, `db` connection instance |
| `@workspace/api-spec` | `lib/api-spec/` | (none) | `openapi.yaml` — single source of truth; codegen script (`pnpm run codegen`) |
| `@workspace/api-zod` | `lib/api-zod/` | `@workspace/api-spec` (build-time) | Orval-generated Zod validators for all API request/response shapes |
| `@workspace/api-client-react` | `lib/api-client-react/` | `@workspace/api-spec` (build-time) | Orval-generated React Query hooks for all API endpoints |
| `@workspace/integrations-openai-ai-server` | `lib/integrations-openai-ai-server/` | (none) | OpenAI-compatible LLM client; `LLMClient` interface and implementation |
| `@workspace/vscode-client` | `artifacts/vscode-client/` | (standalone — REST to api-server) | VS Code Extension: TreeView, Commands, CodeLens, Hover, Chat participant, Webviews |

### Dependency Constraints

- `lib/*` packages **must not** import from `artifacts/*`
- `@workspace/api-server` may import from all `lib/*` packages
- `@workspace/kg-engine` may import from `@workspace/api-client-react` only (not from `@workspace/db` or server internals)
- `@workspace/vscode-client` is standalone; it communicates with `@workspace/api-server` exclusively via REST HTTP

---

## 5.2 Level 2 — api-server Internal Modules

`artifacts/api-server/src/`

| Directory / File | Responsibility |
|---|---|
| `routes/` | Express route handlers, one file per domain (e.g., `projects.ts`, `ingest.ts`, `generate.ts`, `review.ts`, `mcp.ts`, `github_webhooks.ts`, `export.ts`) |
| `lib/intent-router.ts` | Agentic RAG: 4-way LLM-based intent classification (vector \| graph \| direct \| hybrid) |
| `lib/github-client.ts` | GitHub REST API client (fetch PR commits, diffs, post comments) |
| `lib/slack-teams-client.ts` | Slack and Teams webhook notification dispatcher |
| `lib/extensions-service.ts` | VS Code extension endpoint logic |
| `lib/build-artifact-parser.ts` | Parses build artifact files for knowledge extraction |
| `lib/document-parser.ts` | Parses uploaded documents (PDF, Markdown, text) |
| `lib/svn-client.ts` | SVN CLI wrapper (`svn log --xml`, `svn diff`) |
| `lib/embedding.ts` | Embedding generation (calls LLM `/v1/embeddings` endpoint) |
| `lib/logger.ts` | Structured logging (pino or equivalent) |
| `index.ts` | Express app setup, middleware, startup (throws if `PORT` missing) |

All request/response types are imported from `@workspace/api-zod` (generated). No hand-written type definitions for API shapes.

---

## 5.3 Level 2 — kg-engine Internal Structure

`artifacts/kg-engine/src/`

| Directory | Responsibility |
|---|---|
| `pages/` | Route-level React components: `Dashboard.tsx`, `Pipeline.tsx`, `Query.tsx`, `Review.tsx`, `Settings.tsx`, `ProjectDetail.tsx`, etc. |
| `components/` | Shared UI components (tables, cards, modals, toasts) built on shadcn/ui |
| `hooks/` | Custom React hooks wrapping generated React Query hooks from `@workspace/api-client-react` |
| `lib/` | Utility functions, formatters, date helpers |
| `App.tsx` | Root component, routing (React Router) |
| `main.tsx` | Vite entry point |

All API calls are made exclusively through `@workspace/api-client-react` generated hooks. Direct `fetch()` calls to the API are forbidden.

---

## 5.4 Level 2 — db Package Schemas

All schema files reside in `lib/db/src/schema/`:

| Schema File | Entity |
|---|---|
| `projects.ts` | Projects (repositories registered in Docuvia) |
| `commits.ts` | Ingested commits (with `processedAt` cursor) |
| `documents.ts` | Uploaded documents |
| `l1_tags.ts` | Global classification tags |
| `l2_nodes.ts` | Module/package/component nodes (with embedding JSONB) |
| `l3_nodes.ts` | Implementation decision/rule/rationale records (with embedding JSONB) |
| `node_links.ts` | Directed relationships between L2/L3 nodes |
| `review_tasks.ts` | Human-in-the-loop review queue |
| `correction_examples.ts` | Human-approved corrections (few-shot feedback) |
| `prompt_templates.ts` | Per-project overridable LLM prompts |
| `subscriptions.ts` | Cross-team watch subscriptions |
| `notifications.ts` | Event feed for subscribed teams |
| `pull_requests.ts` | GitHub PR analysis records |
| `project_integrations.ts` | Slack/Teams/GitHub integration config per project |
| `llm_configs.ts` | LLM endpoint configuration per project or globally |
| `activity_log.ts` | Audit trail for all significant system events |

---

## 5.5 Level 2 — VS Code Extension

See [artifacts/vscode-client/design/ROUTER.md](../../artifacts/vscode-client/design/ROUTER.md) for the authoritative routing architecture.

Key source files in `artifacts/vscode-client/src/`:

| File | Role |
|---|---|
| `extension.ts` | Entry point: activates extension, registers all commands and providers |
| `ChatParticipant.ts` | Copilot Chat `@docuvia` participant handler (slash commands) |
| `KnowledgeStore.ts` | Model layer: manages `.docuvia/` YAML snapshot; syncs to disk |
| `TaskRunner.ts` | Orchestrates extraction and query tasks; calls api-server REST |
| `KnowledgeGraphTreeProvider.ts` | VS Code TreeDataProvider for the Knowledge Graph sidebar view |
| `TaskQueueTreeProvider.ts` | VS Code TreeDataProvider for the pending task queue sidebar view |
| `DashboardPanel.ts` | Webview panel: embedded dashboard |
| `SearchResultsPanel.ts` | Webview panel: displays MCP/RAG query results |
| `DocuviaCodeLensProvider.ts` | CodeLens provider: shows L3 decision count above functions/classes |
| `DocuviaHoverProvider.ts` | Hover provider: shows L3 decision preview on symbol hover |
| `CentralServerClient.ts` | HTTP client wrapper for all api-server calls from the extension |
| `CredentialManager.ts` | Manages API key via VS Code SecretStorage |

---

## References

- [artifacts/vscode-client/design/ROUTER.md](../../artifacts/vscode-client/design/ROUTER.md) — VS Code extension full routing architecture
- [artifacts/vscode-client/design/knowledge-graph/store.md](../../artifacts/vscode-client/design/knowledge-graph/store.md) — KnowledgeStore design
- [docs/implementation-roadmap.md](../implementation-roadmap.md) — Phase-by-phase implementation of these packages
- [docs/vscode-extension-roadmap.md](../vscode-extension-roadmap.md) — VS Code extension roadmap
