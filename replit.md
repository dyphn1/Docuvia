# Knowledge Graph Engine

A universal L1/L2/L3 knowledge graph engine for engineering teams — ingests Git/SVN commit history and spec documents, auto-generates structured knowledge nodes with AI, and provides a human review/correction workflow.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000 / 8080 in dev)
- `pnpm --filter @workspace/kg-engine run dev` — run the frontend (port 18774)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite, Tailwind CSS, Wouter, TanStack Query
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — single source of truth for all API contracts
- `lib/db/src/schema/` — Drizzle ORM table definitions (projects, l1_tags, l2_nodes, l3_nodes, commits, review_tasks, activity_log)
- `artifacts/api-server/src/routes/` — Express route handlers (dashboard, projects, l1_tags, l2_nodes, l3_nodes, review_tasks)
- `artifacts/kg-engine/src/pages/` — React pages (dashboard, projects, l1-tags, review, query)
- `lib/api-client-react/src/generated/` — generated React Query hooks (do not edit)
- `lib/api-zod/src/generated/` — generated Zod schemas for server validation (do not edit)

## Architecture decisions

- **L1/L2/L3 hierarchy**: L1 = global classification tag pool (cross-project), L2 = Package/Module/PCD per project, L3 = change highlights / implementation rules / decision context per L2 node
- **Contract-first API**: OpenAPI spec gates all codegen — never write types by hand that Orval can generate
- **AI-generated flag**: Every L2/L3 node tracks `aiGenerated` + `confidence` score; noise surfaces via repeated marking consistency
- **Review queue**: All AI-generated nodes with `needsReview=true` surface in the human review queue with approve/reject/defer actions
- **Activity log**: Denormalized append-only log for the dashboard activity feed (avoids complex joins on hot path)

## Product

- **Dashboard**: Live stats (projects, L1 tags, L2/L3 nodes, pending reviews) + recent activity feed
- **Projects**: List of repos/data sources with status, node counts; drill into project for commit history and L2 node tree
- **L1 Tags**: Global classification tag pool management — anchor tags, edit categories, track usage counts
- **Review Queue**: Human correction interface — approve/reject/defer AI-generated L1/L2/L3 nodes with stats sidebar
- **Query**: Semantic search interface (stubbed for MCP/RAG integration)

## User preferences

- Language: Traditional Chinese (zh-TW) for user messages; code stays in English
- Architecture documentation: Maintain this file as the project evolves

## Gotchas

- Always run codegen after spec changes: `pnpm --filter @workspace/api-spec run codegen`
- Body schema names in openapi.yaml must be entity-shaped (e.g. `ProjectInput`, not `CreateProjectBody`) to avoid Orval TS2308 collision
- The `dark` class cannot be used as a `@apply` utility in Tailwind CSS v4 — use `dark:` prefix variant instead
- DB push required after schema changes: `pnpm --filter @workspace/db run push`

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
