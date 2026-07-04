# KG Engine (`@workspace/kg-engine`)

## What it is

The React + Vite + Tailwind single-page dashboard for Docuvia. It's a pure REST client — all state comes from [api-server](api-server.md) via TanStack Query; there's no direct database or file-system access. Uses Radix UI primitives, Wouter for routing, Recharts/D3 for graph visualization.

|             |                                                                                  |
| ----------- | -------------------------------------------------------------------------------- |
| Package     | `@workspace/kg-engine`                                                           |
| Entry point | `src/main.tsx` (React root), `src/App.tsx` (router)                              |
| Scripts     | `dev` (`vite --host 0.0.0.0`, default port 18774), `build`, `serve`, `typecheck` |

## Structure

```
src/
  pages/        — one file per route (see table below)
  components/   — shared UI components
  lib/          — API client, utilities
  hooks/        — React Query hooks wrapping the generated API client
  types/        — local TS types
```

## Pages

All under `src/pages/`:

| Page                                    | Purpose                                               |
| --------------------------------------- | ----------------------------------------------------- |
| `Dashboard.tsx`                         | Home — aggregated stats from `GET /dashboard`         |
| `Projects.tsx` (+ `projects/`)          | Project list, workspace binding                       |
| `L1Tags.tsx`                            | Global L1 tag taxonomy management                     |
| `Review.tsx` (+ `review/`)              | Human-in-the-loop review queue                        |
| `Query.tsx`                             | Agentic RAG query interface                           |
| `Pipeline.tsx` (+ `pipeline/`)          | Ingestion/generate pipeline automation and monitoring |
| `Documents.tsx` (+ `documents/`)        | Uploaded document browser, misc pool                  |
| `Mcp.tsx`                               | MCP tool configuration for AI agents                  |
| `Templates.tsx`                         | Saved queries/workflow templates                      |
| `Subscriptions.tsx`                     | Cross-project/team subscriptions                      |
| `PullRequests.tsx` (+ `pull-requests/`) | GitHub PR review integration                          |
| `Integrations.tsx` (+ `integrations/`)  | Slack/Teams webhook configuration                     |
| `NotFound.tsx`                          | 404 fallback                                          |

## Relationship to api-server

Every page fetches through a generated API client (from the same `lib/api-spec/openapi.yaml` contract described in [api-server](api-server.md#api-contract)) — no page talks to PostgreSQL or the file system directly. This is the "Query Layer" boundary described in [Solution Strategy](../architecture/solution-strategy.md).
