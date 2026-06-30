# Docuvia — AI Developer Guide

> Full-stack TypeScript monorepo (Node 24, Express 5, React+Vite, PostgreSQL+Drizzle, MCP). Ingests VCS history into a queryable knowledge graph via Agentic RAG.

## 🧠 Law of State Handoff Awakening (CRITICAL)

**Before making any structural changes, writing new features, or making architectural decisions, all Agents MUST read `.github/memory/MEMORY.md` to load past architectural decisions, error boundaries, and workflow constraints.** Do not assume your initial context contains all the tacit knowledge of the project.

## Workspace Layout

```
artifacts/
  api-server/     Express API, MCP, ingestion, Agentic RAG routing (entry: src/index.ts, esbuild bundle)
  kg-engine/      React+Vite frontend (entry: src/main.tsx)
  vscode-client/  VS Code extension (release via tag push, packages .vsix)
  ast-core/       AST analysis logic
  mockup-sandbox/ UI prototyping only (not production)
lib/
  db/             Drizzle ORM schema + migrations (21 tables, drizzle-kit push)
  api-spec/       OpenAPI spec (openapi.yaml) — single source of truth
  api-client-react/  Auto-generated React Query hooks (do not edit)
  api-zod/           Auto-generated Zod validators (do not edit)
  integrations-openai-ai-server/  OpenAI-compatible client wrapper
scripts/          preinstall.mjs (blocks npm/yarn), utilities
```

## Developer Commands

```bash
pnpm install                    # npm/yarn blocked by preinstall script

# Codegen — run after EVERY openapi.yaml change
pnpm --filter @workspace/api-spec run codegen   # Runs orval then pnpm -w run typecheck:libs

# Typecheck (two-phase: libs tsc --build first, then per-package)
pnpm run typecheck

# Build (typecheck + compile all packages)
pnpm run build

# Lint (prettier --check only, not a full linter)
pnpm run lint
pnpm run format                # prettier --write

# Test (api-server only — kg-engine has no test script)
pnpm test                      # vitest run --root ../.. (from api-server)
pnpm run test:coverage

# Dev servers
pnpm --filter @workspace/api-server run dev   # PORT env var required, listens on $PORT
pnpm --filter @workspace/kg-engine run dev    # Vite dev server, port 18774

# Database
pnpm --filter @workspace/db run push          # Apply schema to dev DB
pnpm --filter @workspace/db run push-force    # Destructive push
```

## CI Pipeline Order

The CI runs this exact sequence — replicate locally when making cross-package changes:

1. `pnpm --filter @workspace/api-spec run codegen` (generates Zod schemas + React Query hooks)
2. `pnpm run typecheck`
3. `pnpm -r --if-present run build` (with `NODE_ENV=production` for Vite)
4. `pnpm --filter @workspace/db run push` (to a real PostgreSQL)
5. `pnpm run test:coverage`

## Testing Conventions

- **Unit tests**: `*.unit.test.ts` co-located with source. Covered by root `vitest.config.ts`.
- **Integration tests**: `artifacts/<package>/test/integration/`.
- **Test runner**: Vitest with root config at `vitest.config.ts`. The shared setup file (`artifacts/api-server/test/setup/setup.ts`) auto-provides defaults for `PORT`, `DATABASE_URL`, `AI_INTEGRATIONS_OPENAI_*`.
- **DB tests**: Wrap with `withRollback(...)` from `artifacts/api-server/test/support/db.ts`. Use factories from `artifacts/api-server/test/support/factories.ts`.
- **External HTTP**: Mocked via MSW. Handlers in `artifacts/api-server/test/setup/msw/handlers.ts`; large fixtures in `artifacts/api-server/test/setup/msw/fixtures/`.
- **k6 load tests**: In `artifacts/api-server/test/k6/`.

## Architecture Notes

- **API-first**: Never manually write API types or fetch hooks. Edit `lib/api-spec/openapi.yaml`, run codegen. Orval generates Zod schemas → `@workspace/api-zod` and React Query hooks → `@workspace/api-client-react`.
- **Knowledge tiers**: L1 (global tags), L2 (architecture modules), L3 (implementation details anchored to commits). Stored in DB tables `l1_tags`, `l2_nodes`, `l3_nodes`.
- **Git-isomorphic**: Knowledge syncs via the `docuvia-knowledge` orphan branch.
- **Intent router**: `src/lib/intent-router.ts` routes queries across vector/graph/direct/hybrid with temporal decay.
- **Webhook middleware order**: `/api/webhooks/github` is mounted with `express.raw()` **before** `express.json()` so HMAC signature validation works (see `src/app.ts`).

## Gotchas

- **`PORT` env var required** at api-server startup (no default).
- **`pnpm lint` = `prettier --check`**, not a real linter (no ESLint configured).
- **`pnpm test` only runs api-server tests** (kg-engine has no test script).
- **Supply-chain defense**: `minimumReleaseAge: 1440` in `pnpm-workspace.yaml` blocks packages <1 day old.
- **No native Ollama support** — use an OpenAI-compatible proxy (LiteLLM, etc.).
- **autoInstallPeers: false** — add peer deps manually.
- **Node 24+ required**; corepack-enabled pnpm 9.
- API server uses **esbuild** for bundling (not tsc). See `build.mjs`.

## Agent Workflow

This repo has 10 subagents defined in [.github/agents/](.github/agents/) for Claude/Copilot orchestration. For complex multi-step work, dispatch to the appropriate agent rather than doing everything in one turn. See `.github/copilot-instructions.md` for the orchestrator state machine.

## Key File Paths

| What                           | Path                                                  |
| ------------------------------ | ----------------------------------------------------- |
| OpenAPI spec                   | `lib/api-spec/openapi.yaml`                           |
| Orval codegen config           | `lib/api-spec/orval.config.cjs`                       |
| Drizzle config                 | `lib/db/drizzle.config.cjs`                           |
| DB schema                      | `lib/db/src/schema/` (21 tables)                      |
| API server entry               | `artifacts/api-server/src/index.ts`                   |
| Express app + middleware order | `artifacts/api-server/src/app.ts`                     |
| API routes                     | `artifacts/api-server/src/routes/` (24 route modules) |
| Intent router                  | `artifacts/api-server/src/lib/intent-router.ts`       |
| VS Code extension docs         | `artifacts/vscode-client/design/ROUTER.md`            |
| Vitest config                  | `vitest.config.ts` (root)                             |
| CI pipeline                    | `.github/workflows/ci.yml`                            |
| Release (VSIX)                 | `.github/workflows/release.yml`                       |

## Do Not Edit

- `lib/api-client-react/src/generated/` — Auto-generated React Query hooks.
- `lib/api-zod/src/generated/` — Auto-generated Zod validators.
- `pnpm-lock.yaml` — Managed by pnpm.

<!-- gitnexus:start -->

# GitNexus — Code Intelligence

This project is indexed by GitNexus as **Docuvia** (4384 symbols, 8823 relationships, 182 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

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

| Resource                                 | Use for                                  |
| ---------------------------------------- | ---------------------------------------- |
| `gitnexus://repo/Docuvia/context`        | Codebase overview, check index freshness |
| `gitnexus://repo/Docuvia/clusters`       | All functional areas                     |
| `gitnexus://repo/Docuvia/processes`      | All execution flows                      |
| `gitnexus://repo/Docuvia/process/{name}` | Step-by-step execution trace             |

## Cross-Repo Groups

This repository is listed under GitNexus **group(s): my_workspace** (see `~/.gitnexus/groups/`). For cross-repo analysis, use MCP tools `impact`, `query`, and `context` with `repo` set to `@<groupName>` or `@<groupName>/<memberPath>` (paths match keys in that group’s `group.yaml`). Use `group_list` / `group_sync` for membership and sync. From the project root: `node .gitnexus/run.cjs group list`, `node .gitnexus/run.cjs group sync <name>`, `node .gitnexus/run.cjs group impact <name> --target <symbol> --repo <group-path>` (the `.gitnexus/run.cjs` path is repo-root-relative).

## CLI

| Task                                         | Read this skill file                                        |
| -------------------------------------------- | ----------------------------------------------------------- |
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md`       |
| Blast radius / "What breaks if I change X?"  | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?"             | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md`       |
| Rename / extract / split / refactor          | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md`     |
| Tools, resources, schema reference           | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md`           |
| Index, status, clean, wiki CLI commands      | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md`             |

<!-- gitnexus:end -->
