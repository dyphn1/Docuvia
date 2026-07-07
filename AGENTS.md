# Docuvia — AI Developer Guide

> Full-stack TypeScript monorepo (Node 24, Express 5, React+Vite, PostgreSQL+Drizzle, MCP). Ingests VCS history into a queryable knowledge graph via Agentic RAG.

## 🧠 Law of State Handoff Awakening (CRITICAL)

**Before making any structural changes, writing new features, or making architectural decisions, all Agents MUST read `.github/memory/MEMORY.md` to load past architectural decisions, error boundaries, and workflow constraints.** Do not assume your initial context contains all the tacit knowledge of the project.

**Before modifying any core mechanism, all Agents MUST check `docs/gitbook/development/patterns/README.md` to see if a Mechanism Playbook exists.** If it does, you MUST read the playbook and obey its `Agent Guardrails & Invariants` section to ensure implementation consistency.

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

# Test (api-server and cli — kg-engine has no test script)
pnpm test                      # vitest run --root ../.. (from api-server and cli)
pnpm run test:coverage

# Dev servers
pnpm --filter @workspace/api-server run dev   # PORT env var required, listens on $PORT
pnpm --filter @workspace/kg-engine run dev    # Vite dev server, port 18774

# Database
pnpm --filter @workspace/db run push          # Apply schema to dev DB
pnpm --filter @workspace/db run push-force    # Destructive push
```

## CI Pipeline Order

The CI pipeline runs this exact sequence (enforced via `.github/workflows/ci.yml`). Replicate locally when making cross-package changes:

1. **Lint & Code Health**: `pnpm run lint`, CodeScene Hotspot check, and Codacy security scan.
2. **Build**: `pnpm --filter @workspace/api-spec run codegen` -> `pnpm run typecheck` -> `pnpm -r --if-present run build`.
3. **Database**: `pnpm --filter @workspace/db run push` (to a real PostgreSQL instance).
4. **Smoke & E2E**: `pnpm run test:smoke` and Playwright suites for `@workspace/kg-engine` and `docuvia-vscode`.
5. **Coverage Ratchet**: `pnpm run test:coverage` (Fails if Backend < 85% or Frontend < 70%).

## Testing Conventions & Quality Gates

> **Compliance with ADR-033**: Docuvia enforces strict testing and quality gates. All AI agents and developers MUST adhere to these rules.

- **TDD (Mandatory)**: Follow the Red → Green → Refactor loop. One cycle per commit. For bugs, write a failing regression test first, then fix.
- **Coverage Ratchet**: Test coverage is a release gate. Backend coverage must stay ≥ 85%, and Frontend coverage must stay ≥ 70%.
- **Test Lanes**:
  - `pnpm test:smoke`: Fast (< 5 min) suite for core critical paths only.
  - `pnpm test`: Full regression suite.
- **Code Health & Security**: CodeScene (Hotspot Code Health) and Codacy (Security) scans must pass with zero new Critical/High issues. Every commit must leave touched files with a higher or equal health score.
- **Unit tests**: `*.unit.test.ts` co-located with source. Covered by root `vitest.config.ts`.
- **Integration tests**: `artifacts/<package>/test/integration/`.
- **Test runner**: Vitest with root config at `vitest.config.ts`. The shared setup file (`artifacts/api-server/test/setup/setup.ts`) auto-provides defaults for `PORT`, `DATABASE_URL`, `AI_INTEGRATIONS_OPENAI_*`.
- **DB tests**: Wrap with `withRollback(...)` from `lib/test-utils/src/db.ts`. Use factories from `lib/test-utils/src/factories.ts`.
- **External HTTP**: Mocked via MSW. Handlers in `artifacts/api-server/test/setup/msw/handlers.ts`; large fixtures in `artifacts/api-server/test/setup/msw/fixtures/`.
- **k6 load tests**: In `artifacts/api-server/test/k6/`.

## Architecture Notes

- **API-first**: Never manually write API types or fetch hooks. Edit `lib/api-spec/openapi.yaml`, run codegen. Orval generates Zod schemas → `@workspace/api-zod` and React Query hooks → `@workspace/api-client-react`.
- **Knowledge tiers**: L1 (global tags), L2 (architecture modules), L3 (implementation details anchored to commits). Stored in DB tables `l1_tags`, `l2_nodes`, `l3_nodes`.
- **Git-isomorphic**: Knowledge syncs via the `docuvia-knowledge` orphan branch.
- **Intent router**: `lib/core/src/services/intent-router.ts` routes queries across vector/graph/direct/hybrid with temporal decay.
- **Webhook middleware order**: `/api/webhooks/github` is mounted with `express.raw()` **before** `express.json()` so HMAC signature validation works (see `src/app.ts`).

## Gotchas

- **`PORT` env var required** at api-server startup (no default).
- **`pnpm lint` = `prettier --check`**, not a real linter (no ESLint configured).
- **`pnpm test` runs both api-server and cli tests** (kg-engine has no test script).
- **Supply-chain defense**: `minimumReleaseAge: 1440` in `pnpm-workspace.yaml` blocks packages <1 day old.
- **Native Ollama support** — set the provider to `ollama` and configure `OLLAMA_BASE_URL` (defaults to `http://127.0.0.1:11434/v1`).
- **autoInstallPeers: false** — add peer deps manually.
- **Node 24+ required**; corepack-enabled pnpm 9.
- API server uses **esbuild** for bundling (not tsc). See `build.mjs`.

## Agent Workflow

This repo has 10 subagents defined in the `.github/agents/` directory for Claude/Copilot orchestration:

- [Requirement Analyzer](.github/agents/requirement-analyzer.agent.md)
- [Backend Developer](.github/agents/backend-developer.agent.md)
- [Frontend Developer](.github/agents/frontend-developer.agent.md)
- [Database Schema Expert](.github/agents/database-schema-expert.agent.md)
- [API Architect](.github/agents/api-architect.agent.md)
- [Task Verifier](.github/agents/task-verifier.agent.md)
- [Document Writer (MD)](.github/agents/document-writer-md.agent.md)
- [Memory Keeper](.github/agents/memory-keeper.agent.md)
- [Shell Script Expert](.github/agents/shell-script-expert.agent.md)
- [Tool Maker](.github/agents/tool-maker.agent.md)

For complex multi-step work, dispatch to the appropriate agent rather than doing everything in one turn. See `.github/copilot-instructions.md` for the orchestrator state machine.

## Key File Paths

| What                           | Path                                                           |
| ------------------------------ | -------------------------------------------------------------- |
| OpenAPI spec                   | `lib/api-spec/openapi.yaml`                                    |
| Orval codegen config           | `lib/api-spec/orval.config.cjs`                                |
| Drizzle config                 | `lib/db/drizzle.config.cjs`                                    |
| DB schema                      | `lib/db/src/schema/` (21 tables)                               |
| API server entry               | `artifacts/api-server/src/index.ts`                            |
| Express app + middleware order | `artifacts/api-server/src/app.ts`                              |
| API routes                     | `artifacts/api-server/src/routes/` (24 route modules)          |
| Intent router                  | `artifacts/api-server/lib/core/src/services/intent-router.ts`  |
| VS Code extension docs         | `docs/gitbook/development/vscode-client/00-router-overview.md` |
| Vitest config                  | `vitest.config.ts` (root)                                      |
| CI pipeline                    | `.github/workflows/ci.yml`                                     |
| Release (VSIX)                 | `.github/workflows/release.yml`                                |

## Do Not Edit

- `lib/api-client-react/src/generated/` — Auto-generated React Query hooks.
- `lib/api-zod/src/generated/` — Auto-generated Zod validators.
- `pnpm-lock.yaml` — Managed by pnpm.

<!-- gitnexus:start -->

# GitNexus — Code Intelligence

This project is indexed by GitNexus as **Docuvia** (5297 symbols, 11134 relationships, 245 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> Index stale? Run `node .gitnexus/run.cjs analyze` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? `npx gitnexus analyze` (npm 11 crash → `npm i -g gitnexus`; #1939).

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows. For regression review, compare against the default branch: `detect_changes({scope: "compare", base_ref: "main"})`.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `query({search_query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `context({name: "symbolName"})`.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

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
