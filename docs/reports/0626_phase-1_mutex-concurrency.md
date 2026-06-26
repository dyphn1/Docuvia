# Verification Report: Item 6.2.4 — Mutex / Concurrency Control
- **Date**: 2026-06-26
- **Phase & Item**: Phase 1 - Mutex / Concurrency Control
- **Target File**: `artifacts/api-server/src/routes/metabolism.ts`
- **Status Update Required**: ❌ ERROR

### Description of Failure
1. **🔴 CRITICAL — Fake in-memory mutex** (`metabolism.ts:17`): `let isMetabolismRunning = false` is a single-process boolean. ADR-008 §2 explicitly requires "distributed Postgres job queue using `FOR UPDATE SKIP LOCKED` combined with a `locked_at` timestamp." The implementation provides zero distributed coordination.

2. **🔴 CRITICAL — Unauthenticated `/metabolism-tick` endpoint** (`metabolism.ts:164`): The primary tick endpoint has NO authentication. Anyone can trigger background work (LLM calls, GitHub API calls), exhausting API budgets and causing duplicate processing.

3. **🔴 CRITICAL — Race condition on `isMetabolismRunning`**: The check-then-set pattern is not atomic. Two concurrent requests can both read `false` and both proceed to execute `runMetabolism()`, causing duplicate L3 node promotions and wasted API quota.

4. **🟡 HIGH — No `FOR UPDATE SKIP LOCKED`**: The pending L3 node query has no row-level locking. Multiple concurrent metabolism ticks can select and process the same rows.

5. **🟡 HIGH — No `locked_at` timestamp or zombie-reaper recovery**: If a metabolism tick crashes mid-flight, stale locks persist indefinitely.

6. **🟡 HIGH — No Dead Letter Queue**: ADR-008 requires DLQ routing with 3 retries → `DEAD_LETER_FILE`. No DLQ logic exists.

7. **🟠 MEDIUM — No optimistic locking for pipeline state**: ADR-008 §4 specifies conditional `UPDATE` statements. No such pattern exists.

8. **🟠 MEDIUM — No concurrent execution test**: ADR-008 §Verifiability requires concurrent test runners attempting to claim the same task. No such test exists.

### Recommended Fix
1. Replace `let isMetabolismRunning` with a PostgreSQL advisory lock or `FOR UPDATE SKIP LOCKED` row claim pattern.
2. Add `locked_at` timestamp column to pending task queries for zombie recovery.
3. Add authentication to `/metabolism-tick` (API key or internal-only).
4. Implement DLQ routing for failed tasks.
5. Add concurrent execution tests per ADR-008 §Verifiability.
