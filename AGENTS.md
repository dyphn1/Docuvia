# Docuvia - AI Developer Guide

> A full-stack TypeScript monorepo using Node.js 24, Express, React + Vite, PostgreSQL + Drizzle ORM, and MCP. It ingests version control history and exposes a knowledge graph via Agentic RAG.

## Tech Stack & Architecture

- **Frontend**: React, Vite, Tailwind CSS (`@workspace/kg-engine`)
- **Backend**: Node.js 24, Express 5, Zod validation (`@workspace/api-server`)
- **Database**: PostgreSQL with Drizzle ORM (`@workspace/db`)
- **API Spec**: OpenAPI spec managed via Orval for codegen (`@workspace/api-spec`)

### Workspace Layout

| Directory | Purpose |
|---|---|
| `kg-engine/` | Frontend React UI (Dashboard, Pipeline, Query, Review) |
| `api-server/` | Express API, MCP endpoints, Agentic RAG routing, Ingestion logic |
| `api-spec/` | `openapi.yaml` — Single source of truth for all API contracts |
| `db/` | Drizzle ORM schema and migrations (`projects.ts`, `commits.ts`, etc.) |
| `integrations-openai-ai-server/` | OpenAI-compatible client wrapper |
| `docs/` | Roadmap, gitbook content, phase checklists |

## Development Commands

All commands are executed from the repository root unless otherwise noted.

### Setup & Database
```bash
pnpm install
# DB push — apply schema to dev DB
pnpm --filter @workspace/db run push
# Force (destructive) push:
pnpm --filter @workspace/db run push-force
```

### Local Development
```bash
pnpm --filter @workspace/api-server run dev   # API server on port 8080
pnpm --filter @workspace/kg-engine run dev    # Frontend on port 18774
```

### Build & Typecheck
```bash
pnpm run build          # typecheck + compile all packages
pnpm run typecheck      # Typecheck only
```

### Codegen
```bash
# Regenerate React Query hooks and Zod validators from OpenAPI spec
pnpm --filter @workspace/api-spec run codegen
```
*Run this after **every** change to `lib/api-spec/openapi.yaml`.*

### Testing & Linting
```bash
pnpm prettier --write .
pnpm test
```
*(Tests live in root `test/`; run the package test script so Vitest uses the API server workspace dependencies.)*

## 🤖 Agentic Workflow & Subagents

This project is scaffolded with the `create-agent-launcher` workflow. When implementing complex features or making cross-package changes, you should utilize the built-in subagents rather than attempting to write all code in a single turn.

- **Agent Launcher**: Use the `agent-launcher` skill to orchestrate multi-step implementations.
- **Available Agents**: Found in `.github/agents/` (e.g., `Requirement Analyzer`, `Backend Developer`, `Frontend Developer`, `API Architect`, `Task Verifier`).
- **Instructions**: See `.github/copilot-instructions.md` for the state machine orchestrator rules.

## Conventions

- **Package Manager**: Strictly use `pnpm`. `npm` and `yarn` are blocked by preinstall script.
- **Node Version**: Strictly Node.js 24+.
- **API First**: Do not manually write API types or fetch hooks. Always edit `openapi.yaml` and run the codegen script. Orval will generate Zod schemas and React Query hooks.

## Product Domain Knowledge

- **L1 Tags**: Global classification pool across all projects. (DB: `l1_tags.ts`)
- **L2 Nodes**: Package / Module / Component, scoped per project. (DB: `l2_nodes.ts`)
- **L3 Nodes**: Implementation rules, decisions, rationale, scoped per L2 node. (DB: `l3_nodes.ts`)
- **Agentic RAG**: `intent-router.ts` handles the 4-way LLM-based routing (vector, graph, direct, hybrid) to answer queries.
- **Human-in-the-loop**: `review_tasks.ts` stores the review queue where humans anchor/approve AI-generated knowledge.

## Do Not Edit

- `lib/api-client-react/src/generated/` — Auto-generated React Query hooks.
- `lib/api-zod/src/generated/` — Auto-generated Zod validators.
- `pnpm-lock.yaml` — Managed by pnpm.

## System Boundaries & Gotchas

- **PORT Environment Variable**: The API server throws an error on startup if `PORT` is missing.
- **Test Suite**: Tests live in root `test/` and currently combine feature contract checks with a VS Code extension endpoint test. Do not assume core logic is broadly covered by tests.
- **Ollama**: While earlier docs mentioned Gemma3/Ollama, the current implementation defaults strictly to an OpenAI-compatible endpoint. Do not attempt to use native Ollama adapters.
