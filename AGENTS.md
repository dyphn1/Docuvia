# Docuvia - AI Developer Guide

> A full-stack TypeScript monorepo using Node.js 24, Express, React + Vite, PostgreSQL + Drizzle ORM, and MCP. It ingests version control history and exposes a knowledge graph via Agentic RAG.

## Tech Stack & Architecture

- **Frontend**: React, Vite, Tailwind CSS (`@workspace/kg-engine`)
- **Backend**: Node.js 24, Express 5, Zod validation (`@workspace/api-server`)
- **Database**: PostgreSQL with Drizzle ORM (`@workspace/db`)
- **API Spec**: OpenAPI spec managed via Orval for codegen (`@workspace/api-spec`)

### Workspace Layout

| Directory                        | Purpose                                                               |
| -------------------------------- | --------------------------------------------------------------------- |
| `kg-engine/`                     | Frontend React UI (Dashboard, Pipeline, Query, Review)                |
| `api-server/`                    | Express API, MCP endpoints, Agentic RAG routing, Ingestion logic      |
| `vscode-client/`                 | VS Code Extension — tree view, Copilot Chat participant, CodeLens/Hover (see `artifacts/vscode-client/design/ROUTER.md`) |
| `mockup-sandbox/`                | UI prototyping and visual component sandbox (not production)          |
| `api-spec/`                      | `openapi.yaml` — Single source of truth for all API contracts         |
| `db/`                            | Drizzle ORM schema and migrations (`projects.ts`, `commits.ts`, etc.) |
| `integrations-openai-ai-server/` | OpenAI-compatible client wrapper                                      |
| `docs/`                          | Centralized documentation including `design/` (Arc42 + ADRs) and `roadmap/` |

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

_Run this after **every** change to `lib/api-spec/openapi.yaml`._

### Testing & Linting

```bash
pnpm prettier --write .
pnpm test
pnpm run test:coverage
```

_(Unit tests are colocated with source as `*.unit.test.ts`; package integration tests live in `artifacts/<package>/test/integration/`. API integration tests use a real PostgreSQL database wrapped in rollback transactions plus MSW for external HTTP APIs.)_

### Test Infrastructure

- Shared Vitest setup is configured in `vitest.config.ts` and implemented under `artifacts/api-server/test/setup/`.
- Use factories from `artifacts/api-server/test/support/factories.ts` to create DB state. Factories should accept overrides and remain friendly to randomized/fuzz inputs.
- Wrap DB-backed integration tests with `withRollback(...)` from `artifacts/api-server/test/support/db.ts` so writes are rolled back after each test.
- Add large external API responses as JSON fixtures under `artifacts/api-server/test/setup/msw/fixtures/`, then expose them through MSW handlers.

## 🤖 Agentic Workflow & Subagents

This project is scaffolded with the `create-agent-launcher` workflow. When implementing complex features or making cross-package changes, you should utilize the built-in subagents rather than attempting to write all code in a single turn.

- **Agent Launcher**: Use the `agent-launcher` skill to orchestrate multi-step implementations.
- **Available Agents**: All 10 agents are defined in `.github/agents/`. Instructions for the state machine orchestrator loop are in `.github/copilot-instructions.md`.

| Agent                  | When to Use                                                                 |
| ---------------------- | --------------------------------------------------------------------------- |
| Requirement Analyzer   | New feature planning, ambiguity resolution                                  |
| Backend Developer      | Express.js / Node.js implementation                                         |
| Frontend Developer     | React + Vite UI changes                                                     |
| Database Schema Expert | Drizzle ORM schema / migrations                                             |
| API Architect          | OpenAPI spec + Orval codegen                                                |
| Task Verifier          | Post-implementation verification                                            |
| Document Writer (MD)   | Markdown documentation only, no source code                                 |
| Memory Keeper          | Consolidate task learnings into project memory after successful verification |
| Shell Script Expert    | Bash, batch, and CI pipeline scripts                                        |
| Tool Maker             | Utility scripts for AI automation reliability                               |

## Conventions

- **Package Manager**: Strictly use `pnpm`. `npm` and `yarn` are blocked by preinstall script.
- **Node Version**: Strictly Node.js 24+.
- **API First**: Do not manually write API types or fetch hooks. Always edit `openapi.yaml` and run the codegen script. Orval will generate Zod schemas and React Query hooks.

## Product Domain Knowledge & Core Architecture

Docuvia is designed around an **Agentic OS Architecture**, prioritizing token efficiency, graceful degradation, and asynchronous metabolism.

- **Knowledge Hierarchy**:
  - `L1 Tags`: Global categorizations across all projects (e.g., Core Logic, API).
  - `L2 Nodes`: Architecture modules/components, automatically clustered via Top-Down Archaeology.
  - `L3 Nodes`: Granular implementation rules anchored to specific Git commit hashes (Incremental Deltas).
- **Git-Isomorphic Graph**: Knowledge is stored and synchronized via the `docuvia-knowledge` orphan branch, allowing the system to project temporal deltas without constantly re-scanning full histories.
- **Local-First, Server-Augmented**: The VS Code client operates independently for topology scanning and keyword retrieval, unlocking deep Graph traversal and Swarm Evolution only when connected to the API Server.
- **Agentic RAG**: `intent-router.ts` handles 4-way LLM-based routing (vector, graph, direct, hybrid) with temporal decay applied to inactive knowledge nodes.
- **Swarm Intelligence (Human-in-the-loop)**: `correction_examplesTable` captures developer overrides. The Server asynchronously distills these into global guardrails and updates the `prompt_templatesTable`.

### DB Schema Tables (`lib/db/src/schema/`)

`projects`, `commits`, `documents`, `activity_log`, `l1_tags`, `l2_nodes`, `l3_nodes`, `node_links`, `review_tasks`, `correction_examples`, `pull_requests`, `project_integrations`, `notifications`, `subscriptions`, `llm_configs`, `prompt_templates`

### API Server Routes (`artifacts/api-server/src/routes/`)

`projects`, `commits`, `l1_tags`, `l2_nodes`, `l3_nodes`, `review_tasks`, `dashboard`, `ingest`, `generate`, `export`, `search`, `mcp`, `extensions_vscode`, `integrations`, `templates`, `github_webhooks`, `pull_requests`, `notifications`, `subscriptions`, `llm_config`, `health`

### API Server Lib (`artifacts/api-server/src/lib/`)

- `intent-router.ts` — 4-way Agentic RAG routing (vector / graph / direct / hybrid)
- `document-parser.ts` — PDF, Word, PPTX, Markdown ingestion
- `build-artifact-parser.ts` — Build artifact analysis
- `embedding.ts` — Vector embedding generation
- `github-client.ts` — GitHub API integration
- `svn-client.ts` — SVN repository client
- `slack-teams-client.ts` — Slack / Teams notification integration
- `extensions-service.ts` — VS Code extension bridge
- `logger.ts` — Structured logging

## Do Not Edit

- `lib/api-client-react/src/generated/` — Auto-generated React Query hooks.
- `lib/api-zod/src/generated/` — Auto-generated Zod validators.
- `pnpm-lock.yaml` — Managed by pnpm.

## System Boundaries & Gotchas

- **PORT Environment Variable**: The API server throws an error on startup if `PORT` is missing.
- **Test Suite**: Vitest discovers colocated unit tests and per-package integration tests. Coverage reports are generated in `coverage/`; add module-specific thresholds as pure logic coverage is introduced.
- **Ollama**: While earlier docs mentioned Gemma3/Ollama, the current implementation defaults strictly to an OpenAI-compatible endpoint. Do not attempt to use native Ollama adapters.
- **Supply-Chain Defense**: `minimumReleaseAge: 1440` in `pnpm-workspace.yaml` requires all npm packages to be at least 1 day old before installation. Do NOT disable this setting. Use `minimumReleaseAgeExclude` sparingly for trusted organizations only.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **Docuvia** (5159 symbols, 8731 relationships, 160 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "main"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit changes without running `detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/Docuvia/context` | Codebase overview, check index freshness |
| `gitnexus://repo/Docuvia/clusters` | All functional areas |
| `gitnexus://repo/Docuvia/processes` | All execution flows |
| `gitnexus://repo/Docuvia/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
