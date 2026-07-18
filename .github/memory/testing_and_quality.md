# Testing Navigation & Quality Gates

## Test Boundaries

- Unit tests are colocated with source files as `*.unit.test.ts` (e.g. `lib/core/src/memory/graph-store.unit.test.ts`).
- `artifacts/cli` splits its `test/` directory into `test/unit/` and `test/integration/`, each with its own script (`test:unit`, `test:integration`) alongside the combined `test` script.
- There is no root-level `test:smoke` or `test:coverage` script in this workspace. Run `pnpm test` (recursive across packages) or `pnpm --filter <package> run test` for a single package.

## Observed Test Patterns (Docuvia2)

- **`GraphStore` tests use a real temporary SQLite file, not a DB mock.** `lib/core/src/memory/graph-store.unit.test.ts` opens a fresh `.docuvia/local.db` under `os.tmpdir()` per test via `GraphStore.open()`, and tears it down afterward. The reasoning, per the implementation plan: "the file is the interface" — mocking `better-sqlite3` would hide real migration/lock/schema bugs.
- **`TestSandbox`** (`artifacts/cli/test/support/sandbox.ts`) spawns the real CLI as a subprocess (`execa` + `tsx` against `src/cli.ts`) inside a fresh temp directory, optionally running `git init` first. This drives true end-to-end command tests, e.g. `artifacts/cli/test/integration/commands/init.test.ts` and `artifacts/cli/test/integration/init-cli-mcp-symmetry.test.ts` (which asserts the CLI and the MCP tool produce equivalent results for the same command).
- **Individual services are unit-tested with mocked interfaces**, following the constructor-injection convention in `lib/core/src/interfaces/` — a service under test is constructed with hand-written fakes/mocks for its required dependencies rather than a real `GraphStore` or subprocess.
- **Verifying narrow coverage fixes**: when the terminal `--coverage` reporter truncates the "Uncovered Line #s" column, don't trust the truncated summary table. Read the raw `coverage/coverage-final.json` statement/branch maps directly to confirm a specific line range is actually hit. This technique caught a real gap during Phase 1 Slice 4 (Tier C) verification: two of six required gating tests (a mid-run budget-exhaustion branch and a system-load-high skip path) were missing despite the underlying feature code working correctly — the fix was two added tests, confirmed via the raw coverage JSON, not the terminal table.

## Verified totals (point-in-time snapshots — re-check, don't assume current)

- Early `init`-only session: `@workspace/core` 116 tests, `@workspace/cli` 14 tests.
- Phase 1 Slice 4 (Tier C) session: 115 test files / 747 tests repo-wide, all green; `lib/ui-core` at 37 files / 242 tests.

There is no CI pipeline, lint script, or coverage-ratchet configuration in this workspace yet. Do not assume old Docuvia's CI sequence (CodeScene/Codacy scans, `db push` to PostgreSQL, Playwright suites, backend/frontend coverage ratchets) applies here — none of that tooling or infrastructure exists in Docuvia2.
