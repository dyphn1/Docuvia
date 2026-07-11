# Architecture & Design Memory

## Scope

Docuvia2 is a from-scratch rebuild of only the local-SQLite-backed CLI and its embedded MCP server. There is NO Postgres, NO `artifacts/api-server`, NO `artifacts/vscode-client`, and NO web frontend in this workspace — those remain behind in old Docuvia (`D:\GitHub\Docuvia`), untouched. Do not assume any package, service, or endpoint from old Docuvia exists here unless you've verified it in this repo.

## 🛡️ Core Architectural Invariants (Verified)

1. **`GraphStore` is the one shared memory/state layer**
   - `lib/core/src/memory/graph-store.ts` opens exactly one `better-sqlite3` connection per process invocation — not one connection per service, as old Docuvia had with 9 independent connections.
   - It runs schema migrations on open (via `@workspace/schema`) and owns a `ReadWriteLock` instance (writer-exclusive / multi-reader serialization) as an instance field.
   - It exposes only narrow, typed repos under `lib/core/src/memory/repos/` (`projects-repo.ts`, `files-repo.ts`, `tags-repo.ts`, `graph-repo.ts`, `fts-repo.ts`). There is NO generic raw-SQL escape hatch on its public interface — every query is a named repo method.

2. **Schema single source of truth: `lib/schema`**
   - `lib/schema` (`@workspace/schema`) owns hand-written, versioned SQL migration files (`lib/schema/src/sqlite/migrations/0001_init.sql`), a small hand-written migration runner (`migration-runner.ts`, no external library), and hand-written row types (`types.ts`).
   - There is NO Drizzle ORM anywhere in this workspace — deliberately dropped. Old Docuvia had two parallel schema definitions (a raw-SQL file and a separate Drizzle query-builder layer) that could drift out of sync; Docuvia2 has exactly one.

3. **Composition-root functions, no DI container**
   - Each command capability gets exactly one composition-root function. `lib/core/src/composition/build-init-capability.ts` is the ONLY place in production code allowed to directly construct service classes (`new WorkspaceGitService()`, etc.) for the `init` capability.
   - There is deliberately NO `di/container.ts`, NO `DI_TOKENS`, NO `resolveConfiguredService`. Old Docuvia had those (a 17-line flat `Map<symbol, instance>`), but every production call site bypassed it anyway via hardcoded constructor defaults, so it was not ported.
   - Rule going forward: every service dependency is a required constructor parameter (no defaults), and no service constructs its own dependencies internally.

4. **Constructor-injection interfaces are real, not decoration**
   - `lib/core/src/interfaces/` (`IWorkspaceGitService`, `IFileDiscovery`, `IAstProcessor`, `IConfigScanner`, `IVcsScanner`) are actually used as production constructor-injection points — not just test-mocking decoration, as in old Docuvia.

5. **CLI and MCP both call the same composition root**
   - `artifacts/cli/src/commands/init.ts` and `artifacts/cli/src/mcp/tools/init.ts` both call the same `buildInitCapability(...)`. This fixes old Docuvia's asymmetry, where the MCP server never used the CLI's DI setup (it did `new Service()` directly) and where MCP's `query` tool reached into the CLI package's command file for shared formatting logic instead of both consuming shared `@workspace/core`.

## 📦 Packages (pnpm workspace)

- `lib/ast-core`, `lib/plugins-ast` — tree-sitter parsing engine + language grammars, lifted verbatim from old Docuvia (self-contained, unmodified).
- `lib/schema` (`@workspace/schema`) — the SQLite schema SSOT (see invariant 2).
- `lib/core` (`@workspace/core`) — the real core:
  - `memory/` — `GraphStore` + repos (invariant 1).
  - `interfaces/` — production DI seams (invariant 4).
  - `services/` — `WorkspaceGitService`, `VcsScannerService` (lifted as-is), `FileDiscoveryService` (rewired to take a `GraphStore`/`ProjectFilesRepo` instead of opening its own connection), `AstProcessingService` + `AstWorkerPool` + `ast-worker.ts` (lifted with only construction-pattern changes — the worker-pool parsing logic and its documented shutdown-vs-crash regression fix are untouched), `ConfigScannerService` (rewritten from scratch as a data-driven rule table, replacing an untested 168-line if/else string-matching chain).
  - `services/init/` — the `InitCommand` orchestrator decomposed into small, independently-testable step files (`ensure-git-branch-and-hooks.ts`, `seed-project-row.ts`, `run-discovery-pipeline.ts`, `run-parse-and-persist.ts`, `init-temp-lifecycle.ts`, `init-result.ts`), replacing old Docuvia's 136-line `InitService.init()` god-method that mixed raw DDL execution, three separate DB connections, idempotency logic, and process-lifecycle management inline in one method.
  - `composition/` — composition-root functions (invariant 3).
- `artifacts/cli` (`@workspace/cli`) — the CLI + its embedded MCP server, both genuinely thin: they call into `@workspace/core` via composition-root functions rather than containing business logic themselves (invariant 5).

## ✅ Verified state (this session)

- `docuvia init` works end-to-end — git branch creation, `.docuvia/local.db` with correct schema/rows, `.docuvia/logs/init.log` JSONL logging, agent-integration file writes for Cursor/Claude/generic-markdown platforms with `--global`-gated machine-global config write per the ported ADR-035 decision — via both the real CLI subprocess and the MCP tool.
- `@workspace/core`: 116 tests, `@workspace/cli`: 14 tests, all passing.

## 🚧 Not yet built

Only `init` exists (plus the `mcp` server-launch command, with only the `init` tool registered on it so far). `analyze`, `status`, `clean`, `review`, `sync`, `snapshot`, `query`, `export --topology`, and `impact` are the next milestones, built one at a time and each reviewed before moving to the next, per the project's own established workflow. Do not assume any of these commands exist yet.

## 🧭 Navigation

- Use **GitNexus** (`impact`, `query`, `context`) to locate modules, trace execution flows, and assess blast radius before editing.
- GitNexus's own index needs to be rebuilt against Docuvia2's actual code (`node .gitnexus/run.cjs analyze`, or `npx gitnexus analyze` if not yet set up) — it is NOT inherited from old Docuvia's index. A stale, inherited index would describe an entirely different codebase (with the API server, VS Code client, and frontend that don't exist here).
