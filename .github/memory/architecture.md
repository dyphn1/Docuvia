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

## 🌊 Tiered Background Knowledge Evolution (Phase 1 rollout)

`analyze` incrementally evolves the knowledge graph across three cost/latency tiers instead of always re-running full extraction (see the indexing-cost-benchmark reasoning: GitNexus ~5min / Graphify ~40min / LSP ~3min full-project cost):

- **Tier A** — real-time, per-file delta ingestion (`run-delta-ingestion.ts`), cheap, always runs.
- **Tier B** — batched LSP-escalation pass with a commit-cap throttle (`run-tier-b-batch.ts`), wired into `analyze --escalate-to-lsp`.
- **Tier C** — budgeted, async LLM decision-extraction queue (`lib/ui-core/src/workflows/analyze/tier-c-*.ts`: `tier-c-queue`, `tier-c-budget`, `tier-c-throttle`, `tier-c-commit-filter`, `tier-c-candidates`, `run-tier-c-drain`, plus shared `decision-parsing.ts`), draining commit-message and contract-symbol decision rows into L3 persistence. Consumption is folded into the existing `analyze --escalate-to-lsp && snapshot` pre-push composition with a wall-clock cap — deliberately NO new CLI command or flag (see `conventions.md`).

Key decisions, each recorded as a lettered section in `docs/gitbook/analysis/phase1-decision-integration.md` (§7/§8 = Tier B, §9 = Tier C):

- **State persistence pattern**: tier queues/budgets (`tierBQueue`, `tierCQueue`, `tierCBudget`) live as JSON keys inside the existing `docuvia_meta` row — no new tables. Budget resets are lazy (checked/reset to a fresh UTC-date window on read), not cron-driven.
- **Embedded in-process LLM model is deferred, not built.** Tier C calls whatever `ILlmClient` bridge is already configured; a local/embedded model is parked behind named measured-pain re-entry triggers rather than being spec'd speculatively.
- **Crash-safety pattern legitimately differs by tier**: Tier B uses batch-level "stage-then-finalize" (a pending-batch marker so the queue only clears after the corresponding `snapshot` succeeds, since L2 rows ride the snapshot). Tier C uses per-item "persist-then-dequeue" instead, because its L3 decision rows never ride the snapshot (that's a Phase 2 concern) — there is no later step to stage against. When designing a future tier's persistence, check whether there's a genuinely separate later step the effect must wait for; if not, per-item persist-then-dequeue is simpler and correct.
- Commit-message decision extraction resolves its anchor node by walking the commit's changed-file list for the first file with an existing L2 node (an extrapolation of the directory-target anchor rule used elsewhere).
- Throttling follows the PLAT-006 pattern: single-flight lock + daily budget + a one-shot `os.loadavg()` check, with a documented Windows no-op (no `loadavg` support there).

Phase 1 slice order: Slice 1 (L3 persistence) → Slice 2 (Tier A) → Slice 3 (Tier B) → Slice 4 (Tier C) → Slice 5 (`doctor` reliability — collects deferred items: LLM endpoint `checkAvailability()`/reachability, LSP binary presence, legacy-hook detection, `uninstall` hook removal, `impact --escalate-to-lsp` wire-or-remove decision).

## ✅ Verified state (accumulated across sessions)

- `docuvia init` works end-to-end — git branch creation, `.docuvia/local.db` with correct schema/rows, `.docuvia/logs/init.log` JSONL logging, agent-integration file writes for Cursor/Claude/generic-markdown platforms with `--global`-gated machine-global config write per the ported ADR-035 decision — via both the real CLI subprocess and the MCP tool.
- `analyze` now exists and runs all three background-knowledge tiers described above. Snapshot as of the Phase 1 Slice 4 (Tier C) session: 115 test files / 747 tests repo-wide, all green (`lib/ui-core`: 37 files / 242 tests). Treat any specific test count as a point-in-time snapshot, not a ceiling — re-check rather than assume stale.

## 🚧 Not yet built (this section predates the tiered rollout — re-verify before trusting)

The original milestone list here (`analyze`, `status`, `clean`, `review`, `sync`, `snapshot`, `query`, `export --topology`, `impact`) predates the Phase 1 background-knowledge rollout. `analyze` and `snapshot` now exist with substantial functionality (see above). Confirm current command surface via `artifacts/cli/src/commands/` before assuming a command doesn't exist.

## 🧭 Navigation

- Docuvia2 is now self-hosted: use **Docuvia2's own CLI** (`docuvia impact <target>`, `docuvia query`, `docuvia analyze`) against its own repo to locate modules, trace execution flows, and assess blast radius before editing — not GitNexus or another sibling product. GitNexus's integration (`CLAUDE.md`/`AGENTS.md` sections, `.claude/skills/gitnexus/`) was removed 2026-07-22 once Docuvia's own analyze/impact pipeline worked end-to-end on its own codebase.
- Before trusting `impact`/`query` output, confirm the local graph is actually populated (`docuvia status` → `L2 Nodes` > 0) — an earlier benchmark run found the AST worker pipeline crash-looping and producing an empty graph; re-verify this isn't still the case rather than assuming it works.
