# `doctor` — Verified Test-Gap Status (2026-07-15)

Checked against `artifacts/cli/src/commands/doctor.ts`, `lib/ui-core/src/workflows/doctor/doctor-workflow.ts`,
and `lib/schema/test/sqlite/diagnostic-runner.unit.test.ts`.

| #   | Claim                                                          | Verdict              | Evidence                                                                                                                                                                                                                                    |
| --- | -------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `fs.stat` rejection branch (hooks not found) never tested      | **Confirmed — open** | `doctor.unit.test.ts`'s `beforeEach` always mocks `fs.stat` to resolve `{size:100}`; the `.catch(() => null)` path (`doctor.ts:92-93`) driving `DOCTOR_CLAUDE_NOT_FOUND`/`DOCTOR_CURSOR_NOT_FOUND` is never exercised.                      |
| 2   | Hardcoded English success messages                             | Overstated           | Accurate description, but no i18n framework exists anywhere in this codebase.                                                                                                                                                               |
| 3   | Only 3 diagnostics tested, no 50+ rendering test               | Overstated           | The render loop (`doctor.ts:59-67`) is a plain `Object.entries()` iteration with no count-sensitive logic.                                                                                                                                  |
| 4   | Conflicting skip combos (`all skips true`) untested            | Stale                | `doctor-workflow.unit.test.ts:28-37` tests `skipDb+skipGit+skipLogs=true` → `{allPassed:true, diagnostics:{}}`.                                                                                                                             |
| 5   | Can't detect a corrupted physical SQLite DB                    | Overstated           | `diagnostic-runner.unit.test.ts:55-82` tests bad `integrity_check`/pragma-throw paths; `test/integration/commands/doctor.test.ts` runs a real on-disk DB end-to-end. Only literal byte-corruption (vs. mocked pragma response) is untested. |
| 6   | `doctor` running concurrently with `hydrate` populating the DB | **Confirmed — open** | No test anywhere exercises this; same class of unaudited concurrency gap flagged as a follow-up in `init-concurrency-status.md`.                                                                                                            |
| 7   | Idempotency / caching not tested                               | False                | `DoctorWorkflow` has no cache of any kind — it's a stateless recompute every call. The claim presumes a mechanism that doesn't exist.                                                                                                       |

**Open**: #1 (hooks `fs.stat` rejection branch — cheap to close), #6 (concurrent `doctor` + `hydrate` — unaudited, low priority).
**Bugs observed**: None.
**Tests run**: `doctor.unit.test.ts` (4/4), `test/integration/commands/doctor.test.ts` (1/1), `doctor-workflow.unit.test.ts` (14/14), `diagnostic-runner.unit.test.ts` (6/6) — all pass.
