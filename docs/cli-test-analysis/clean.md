# `clean` — Verified Test-Gap Status (2026-07-15)

The original 7 speculative claims for this command were checked against the actual source
(`artifacts/cli/src/commands/clean.ts`, `lib/ui-core/src/workflows/clean/clean-workflow.ts`) and
tests (`clean.unit.test.ts`, `clean-workflow.unit.test.ts`, `docuvia-memory.unit.test.ts`). Most
were stale or overstated; one real gap remains.

| #   | Claim                                                     | Verdict              | Evidence                                                                                                                                                                                  |
| --- | --------------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Memory-scope unregister only checked via a spy call count | Stale                | `docuvia-memory.unit.test.ts:48-56` already proves `deleteScope()` clears all values; `clean.unit.test.ts:58-66` confirms it's called once per run.                                       |
| 2   | `UI_MESSAGES.CLEAN_SUCCESS` fragile if translated         | Overstated           | The constant exists (`ui-messages.ts:50`), but no i18n framework exists anywhere in this CLI — there is nothing to translate against.                                                     |
| 3   | No test for a 5GB DB / partial deletion failure           | Overstated           | `CleanWorkflow.execute()` does one `fs.unlink(dbPath)` — an atomic syscall with no size-dependent or partial-deletion branching to test.                                                  |
| 4   | Invalid/non-existent `cwd` not tested                     | Confirmed (benign)   | Untested, but tracing the code shows a missing dir just resolves to `exists=false` → "No local database found to clean." No crash risk.                                                   |
| 5   | Windows `EBUSY` file-lock not tested                      | **Confirmed — open** | `clean-workflow.ts:42-50` wraps `fs.unlink` in try/catch → wrapped `DocuviaError`, but no test ever makes `fs.unlink` throw. Only "exists→deleted" and "doesn't exist" paths are covered. |
| 6   | Background `sync` holding a DB lock not tested            | Overstated           | Same code path as #5 (any locked-file failure hits the same catch); not a distinct gap.                                                                                                   |
| 7   | No idempotency test (clean on an already-clean repo)      | Stale                | `clean-workflow.unit.test.ts:39-49` "reports deleted:false when no database exists" directly covers this.                                                                                 |

**Open**: #5 — the `fs.unlink` failure/`EBUSY` catch branch is real, untested code.
**Bugs observed**: None.
**Tests run**: `clean.unit.test.ts` (3/3 pass), `clean-workflow.unit.test.ts` (3/3 pass).
