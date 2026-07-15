# `status` — Verified Test-Gap Status (2026-07-15)

Checked against `artifacts/cli/src/commands/status.ts`, `lib/ui-core/src/workflows/status/status-workflow.ts`,
and `lib/schema/src/sqlite/graph-store.ts`.

| #   | Claim                                             | Verdict              | Evidence                                                                                                                                                                                                                    |
| --- | ------------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `ui.header` call not verified (only `ui.info`)    | **Confirmed — open** | `status.ts:25` calls `ui.header(UI_MESSAGES.STATUS_HEADER)`; `status.unit.test.ts` mocks `ui.header` but the success test never asserts it was called.                                                                      |
| 2   | English-dependent assertions                      | False                | No i18n exists anywhere in the repo.                                                                                                                                                                                        |
| 3   | No number-formatting test for millions of nodes   | False                | `status.ts:26-28` does plain string interpolation — there is no number-formatting logic (no `toLocaleString`) to have a bug in.                                                                                             |
| 4   | No invalid-`cwd` checks                           | False                | Unlike `init`, `statusCommand`'s `cwd` is always `process.cwd()` from the real CLI entrypoint — never user input. Any bad resolved path already hits the tested `DB_OPEN_FAILED` → "run docuvia init" path.                 |
| 5   | Mock bypasses SQLite DB reads                     | Overstated           | True at the CLI-command level, but `store.projects.count()`/`store.graph.count()` are tested against real SQLite in `graph-store.integration.test.ts`.                                                                      |
| 6   | No test for status while DB is locked             | Overstated           | `graph-store.ts:125-130` sets `busy_timeout` and WAL mode (ADR-032) specifically so readonly readers proceed concurrently with a writer — the scenario is deliberately engineered against, though no dedicated test exists. |
| 7   | No test for repeated `status` calls (idempotency) | False                | `status` is strictly read-only — there is no state for repeated calls to diverge on.                                                                                                                                        |

**Open**: none — #1 was closed by adding a `ui.header` assertion to the success-path test alongside the bug fix below.

**Bug fixed (2026-07-15)**: Same bug class as `snapshot` (see [snapshot.md](./snapshot.md)) — `statusCommand`'s catch block called `process.exit(1)` (`status.ts:35`) before the `finally` block's `docuviaMemory.deleteScope(scopeId)` (line 37) could run. Fixed by switching to `process.exitCode = 1`; `status.unit.test.ts` now asserts `process.exit` is never called, `deleteScope` still ran, and (closing #1 too) that `ui.header` was called on the success path.

**Tests run**: `status.unit.test.ts` (2/2), `status-workflow.unit.test.ts` (3/3), `graph-store.integration.test.ts` (23/23) — all pass.
