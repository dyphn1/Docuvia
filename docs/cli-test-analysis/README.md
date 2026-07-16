# CLI Command Test Gaps & Concurrency Validation Analysis (2026-07-16)

> **Multi-Lateral Validation & Stress Test Results:**
> The team has completed comprehensive code walkthroughs, real SQLite / Git integration testing, and concurrency stress testing for all CLI commands.
> High-severity concurrency race conditions and exit-blocking bugs discovered previously (such as `init` migration conflicts, `sync` state clobbering, and the failure of `finally` cleanup on exit) have been fully resolved.
>
> To maintain directory hygiene and focus on core concerns, we have consolidated all commands' genuinely open issues (Confirmed — Open test gaps) into this single document. All other fully-resolved, non-open temporary logs and status files have been completely cleaned up.

---

## 1. Status Summary

| Command           | Status      | Validation Summary & Fix Records                                                               |
| :---------------- | :---------- | :--------------------------------------------------------------------------------------------- |
| `init`            | ✅ Resolved | The single-flight concurrency lock has fully resolved database migration conflicts.            |
| `analyze`         | ✅ Resolved | Implemented LLM decision-extraction & markdown cleanup; resolved the exit-blocking bug.        |
| `impact`          | ✅ Resolved | Added `console.log` assertions; SQL/LIKE injection defense design has been verified.           |
| `status`          | ✅ Resolved | Added `ui.header` assertions; switched `process.exit` to `process.exitCode`.                   |
| `sync-knowledge`  | ✅ Resolved | Added fast-forward/push status assertions; resolved the exit-blocking bug.                     |
| `clean`           | ⚠️ 1 Open   | Only the Windows `EBUSY` exception path has not been mock-triggered in unit tests.             |
| `doctor`          | ⚠️ 2 Open   | The hooks `fs.stat` failure branch is untested; concurrent `doctor` + `hydrate` is unaudited.  |
| `export-topology` | ⚠️ 2 Open   | Embedded JSON data in HTML is never parsed/validated; `--out` as an existing file is untested. |
| `hydrate`         | ⚠️ 2 Open   | Concurrency under `bulkLoadGraph` is untested; lacks an idempotency short-circuit cache.       |
| `query`           | ⚠️ 3 Open   | Interactive TTY input & Ctrl+C paths are untested; prompt payload size lacks guardrails.       |
| `review`          | ⚠️ 1 Open   | Large/binary file PR payloads have not been stress-tested.                                     |
| `snapshot`        | ⚠️ 1 Open   | Read-only directory write failures (EACCES/EROFS) are untested.                                |
| `sync`            | ⚠️ 2 Open   | `readStdin()` is completely untested; invalid `commitSha` formats are untested.                |
| `uninstall`       | ⚠️ 1 Open   | Concurrency with DB writes during uninstall is untested.                                       |

---

## 2. Confirmed — Open Issues

The following items are confirmed test gaps or open issues verified by the team. Future iterations should prioritize adding coverage for these execution paths:

### 2.1 Exception & Edge-Case Gaps

1. **Windows `EBUSY` File Locking Untested (`clean` & `uninstall`)**
   - **Description**: `clean-workflow.ts`'s `fs.unlink` throws `EBUSY` on Windows if the DB file is held by another process. While wrapped in a `try/catch` and mapped to a `DocuviaError`, this exception path has never been mock-triggered in unit tests.
2. **`doctor` Hooks File-Stat Rejection Untested**
   - **Description**: The `.catch(() => null)` block on `doctor.ts:92-93` is used to handle failure to stat hook files. However, `doctor.unit.test.ts` always mocks `fs.stat` to resolve successfully (`size: 100`), leaving the `DOCTOR_CLAUDE_NOT_FOUND` / `DOCTOR_CURSOR_NOT_FOUND` branches unexercised.
3. **`export-topology` `--out` as an Existing File**
   - **Description**: If the `--out` parameter points to an existing file instead of a directory, `fs.mkdirSync(outDir, { recursive: true })` throws an error. It is caught gracefully by the outer `try/catch` and fails the spinner, but no test covers this.
4. **`snapshot` Read-Only Directory Write Failure Untested**
   - **Description**: No test simulates a write failure (EACCES/EROFS) during the snapshot temp-dir render or the knowledge-branch pack step.
5. **`sync` Invalid Commit SHA Format Untested**
   - **Description**: The CLI forwards `commitSha` directly to the Git provider. If the format is invalid, it propagates to the generic catch block instead of crashing, but this is untested.

### 2.2 Integration & Data-Verification Gaps

1. **`export-topology` Embedded JSON Graph Data Never Verified**
   - **Description**: Existing tests only assert that the HTML output contains the `<!DOCTYPE html>` string. The embedded `var GRAPH = ...` JSON blob injected by `topology-html-template.ts` is never extracted or validated.
2. **`sync` `readStdin()` Untested**
   - **Description**: All tests in `sync.unit.test.ts` either pass a `commitSha` explicitly or hit the interactive TTY branch, leaving the piped Standard Input (`readStdin()`) logic completely untested.

### 2.3 Concurrency & Performance Defense Gaps

1. **Interactive TTY Input & Ctrl+C Untested (`query`)**
   - **Description**: The interactive input loop using `ui.askInput` (`query.ts:92-109`) and the Ctrl+C abort path are fully mocked out and never exercised.
2. **`query` Prompt Size Limit Defense Missing**
   - **Description**: `formatPromptOutput` has no truncation or size-capping guardrails for incoming/outgoing/l3 relationships. If a queried node has thousands of relationships, the prompt size could inflate uncontrollably.
3. **Repeated Queries Memory-Scope Cleanup Untested**
   - **Description**: Unlike `hydrate` or `impact` tests, `query.unit.test.ts` never spies on or validates `docuviaMemory.deleteScope` to ensure scope cleanup on success/failure.
4. **`hydrate` Concurrency Stress-Testing & Idempotency Cache**
   - **Description**: `HydrateWorkflow` opens the database in read-write mode. Though protected by the init-lock, the concurrent behavior of `bulkLoadGraph` has not been stress-tested. Additionally, `HydrationService.hydrate()` unconditionally reads git and runs `bulkLoadGraph` every call, lacking an already-up-to-date fast path.
