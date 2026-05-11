# Docuvia — Universal VCS Knowledge Graph Engine

A universal L1/L2/L3 knowledge graph engine for engineering teams — ingests Git/SVN commit history and spec documents, auto-generates structured knowledge nodes with AI, and provides a human review/correction workflow.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080 in dev)
- `pnpm --filter @workspace/kg-engine run dev` — run the frontend (port 18774)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string
- Required env: `AI_INTEGRATIONS_OPENAI_BASE_URL`, `AI_INTEGRATIONS_OPENAI_API_KEY` — OpenAI via Replit AI Integrations (auto-provisioned)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Frontend: React + Vite, Tailwind CSS, Wouter, TanStack Query, shadcn/ui
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (plain `zod` in api-server; `zod/v4` in lib packages)
- AI: OpenAI via `@workspace/integrations-openai-ai-server`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `lib/api-spec/openapi.yaml` — single source of truth for all API contracts
- `lib/db/src/schema/` — Drizzle ORM table definitions
  - `projects.ts`, `commits.ts`, `l1_tags.ts`, `l2_nodes.ts`, `l3_nodes.ts`
  - `review_tasks.ts`, `activity_log.ts`
  - `documents.ts` — ingested spec/doc content
  - `node_links.ts` — L2 module dependency graph
  - `llm_configs.ts` — per-project model configuration
- `artifacts/api-server/src/routes/` — Express route handlers
  - `dashboard.ts`, `projects.ts`, `l1_tags.ts`, `l2_nodes.ts`, `l3_nodes.ts`
  - `review_tasks.ts` — review queue + correction writeback
  - `ingest.ts` — GitHub commit ingestion + document ingestion
  - `generate.ts` — L1→L2→L3 AI pipeline (OpenAI)
  - `search.ts` — full-text search across L1/L2/L3
  - `mcp.ts` — 5 MCP tool endpoints for AI agent integration
  - `llm_config.ts` — per-project LLM model config
  - `export.ts` — project knowledge graph JSON export
- `artifacts/kg-engine/src/pages/` — React pages
  - `dashboard.tsx`, `projects/index.tsx`, `projects/[id].tsx`
  - `l1-tags.tsx`, `review.tsx`, `query.tsx`
  - `pipeline.tsx` — Phase 2 & 3 ingest + AI generation UI
  - `documents.tsx` — document ingestion (Phase 2)
  - `mcp.tsx` — interactive MCP endpoint explorer (Phase 5)
- `lib/api-client-react/src/generated/` — generated React Query hooks (do not edit)
- `lib/api-zod/src/generated/` — generated Zod schemas for server validation (do not edit)
- `lib/integrations-openai-ai-server/` — OpenAI client + batch utilities

## Architecture decisions

- **L1/L2/L3 hierarchy**: L1 = global classification tag pool (cross-project), L2 = Package/Module/PCD per project, L3 = change highlights / implementation rules / decision context per L2 node
- **Contract-first API**: OpenAPI spec gates all codegen — never write types by hand that Orval can generate
- **AI-generated flag**: Every L2/L3 node tracks `aiGenerated` + `confidence` score
- **Review queue**: All AI-generated nodes with `needsReview=true` surface in the human review queue with approve/reject/defer actions. Corrections write back to the node automatically.
- **Correction writeback**: When a reviewer edits content and approves, the corrected value is written back to the actual L1/L2/L3 node in the DB
- **Activity log**: Denormalized append-only log for the dashboard activity feed
- **Node links**: `node_links` table tracks module-to-module dependency relationships for graph traversal and impact analysis
- **Commit signal scoring**: Commits are scored 0.0-1.0; noise patterns (merge/chore/ci/wip) score ≤0.1, signal patterns (feat/fix/decision) boost score. Valid threshold: ≥0.4.
- **MCP tools**: 5 endpoints callable by any LLM agent — list_projects, search_knowledge, get_dependencies, impact_analysis, get_decision_record
- **LLM config**: Per-project model override stored in `llm_configs` table; defaults to `gpt-5.2`

## Product (7 Phases Complete)

- **Phase 1 — LLM Abstraction**: OpenAI via Replit AI Integrations, LLM config per project, DB schema extended
- **Phase 2 — Input Layer**: GitHub commit ingestion with signal scoring, document ingestion (MD/TXT/build artifacts)
- **Phase 3 — AI Pipeline**: L1 Tagger → L2 Extractor → L3 Generator, automated review task creation
- **Phase 4 — Knowledge Graph**: Node dependency links, full-text search across all layers
- **Phase 5 — Query + MCP**: Semantic search UI, 5 MCP tool endpoints with interactive explorer
- **Phase 6 — Human-in-the-Loop**: Full node content in review cards, inline editing, correction writeback, usage guidance
- **Phase 7 — Enhancements**: JSON export, incremental ingestion (dedup by commit hash), documents management page

## User preferences

- Language: Traditional Chinese (zh-TW) for user messages; code stays in English
- Architecture documentation: Maintain this file as the project evolves

## Gotchas

- Always run codegen after spec changes: `pnpm --filter @workspace/api-spec run codegen`
- Body schema names in openapi.yaml must be entity-shaped (e.g. `ProjectInput`, not `CreateProjectBody`) to avoid Orval TS2308 collision
- The `dark` class cannot be used as a `@apply` utility in Tailwind CSS v4 — use `dark:` prefix variant instead
- DB push required after schema changes: `pnpm --filter @workspace/db run push`
- **Use `zod` (not `zod/v4`) in `artifacts/api-server` routes** — esbuild cannot resolve the subpath export. `zod/v4` works fine in lib packages.
- `integrations-openai-ai-server` tsconfig has `"types": []` to avoid TS2688 node type conflicts
- `lib/integrations-openai-ai-server` `AbortError` must be imported as named export from `p-retry`, not accessed as `pRetry.AbortError`

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
