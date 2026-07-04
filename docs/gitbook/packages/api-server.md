# API Server (`@workspace/api-server`)

## What it is

Express.js REST API with an MCP endpoint, the server half of Docuvia. Handles knowledge-graph CRUD (L1/L2/L3), git/SVN ingestion, the AI generate pipeline, document processing (PDF/Word/TOML), GitHub webhooks, and the async metabolism worker. Uses Pino for structured logging and rate limiting on public routes.

|             |                                                                               |
| ----------- | ----------------------------------------------------------------------------- |
| Package     | `@workspace/api-server`                                                       |
| Entry point | `src/index.ts` (starts the HTTP listener + background `JanitorService`)       |
| App wiring  | `src/app.ts` (Express middleware/routing), `src/di.ts` (dependency injection) |
| Scripts     | `dev` (build + start), `build`, `start`                                       |

## Structure

```
src/
  routes/       — one file per resource, mounted in app.ts
  services/     — business logic, called by routes
  middlewares/  — auth, rate limiting, error handling
  proxy/        — LLM request proxying
  memory/       — in-process caches
```

## Route Groups

All under `src/routes/`:

| File                                                                                                               | Purpose                                                                            |
| ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| `projects.ts`                                                                                                      | Project CRUD, workspace binding                                                    |
| `l1-tags.ts` / `l2-nodes.ts` / `l3-nodes.ts`                                                                       | The three knowledge-graph tiers                                                    |
| `ingest.ts`                                                                                                        | Git/SVN history ingestion                                                          |
| `generate.ts`                                                                                                      | AI generate pipeline (L3 extraction)                                               |
| `review-tasks.ts`                                                                                                  | Human-in-the-loop review queue                                                     |
| `search.ts`                                                                                                        | Agentic RAG query endpoint                                                         |
| `mcp.ts`                                                                                                           | Model Context Protocol tool endpoints                                              |
| `sync.ts`                                                                                                          | CLI / VS Code sync target (see [CLI: `docuvia sync`](cli.md))                      |
| `documents.ts`                                                                                                     | Document upload/misc pool                                                          |
| `dashboard.ts`                                                                                                     | Aggregated stats for kg-engine's Dashboard page                                    |
| `github-webhooks.ts`, `pull-requests.ts`                                                                           | GitHub PR integration                                                              |
| `integrations.ts`                                                                                                  | Slack/Teams notifications                                                          |
| `extensions-vscode.ts`                                                                                             | VS Code extension–specific endpoints                                               |
| `llm-config.ts`, `subscriptions.ts`, `notifications.ts`, `templates.ts`, `export.ts`, `metabolism.ts`, `health.ts` | Config, billing, saved templates, data export, background worker control, liveness |

## API Contract

Types are generated (not hand-written) from `lib/api-spec/openapi.yaml` via Orval, per [ADR-001](../adr/README.md#adr-001-openapi-as-single-source-of-truth). Tag groups mirror the route list above: `health`, `projects`, `l1-tags`, `l2-nodes`, `l3-nodes`, `commits`, `review-tasks`, `dashboard`, `ingest`, `generate`, `search`, `mcp`, `documents`, `llm-config`, `subscriptions`, `notifications`, `github-prs`, `extensions`, `integrations`, `sync`, `templates`, `export`.

## Relationship to `lib/core` and `lib/db`

Routes are thin — they validate input (via generated Zod schemas) and delegate to services in `src/services/`, which in turn call into the shared `lib/core` services (the same services the [CLI](cli.md) and [vscode-client](vscode-client.md) call directly for local-first operations) and `lib/db` (Drizzle ORM schemas, PostgreSQL). See [Building Blocks](../architecture/building-blocks.md) for the full package dependency graph.
