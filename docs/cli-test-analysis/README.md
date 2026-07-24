# CLI Command Test Gaps & Concurrency Validation Analysis (2026-07-16)

> **Multi-Lateral Validation & Stress Test Results:**
> The team has completed comprehensive code walkthroughs, real SQLite / Git integration testing, and concurrency stress testing for all CLI commands.
> High-severity concurrency race conditions and exit-blocking bugs discovered previously (such as `init` migration conflicts, `sync` state clobbering, and the failure of `finally` cleanup on exit) have been fully resolved.
>
> To maintain directory hygiene and focus on core concerns, we have consolidated all commands' genuinely open issues (Confirmed — Open test gaps) into this single document. All other fully-resolved, non-open temporary logs and status files have been completely cleaned up.
>
> **Update (2026-07-17, PLAT-007 Slice 2 dispatch 2b):** the two command-pair concurrency gaps that gated the post-commit hook flip are now closed by real-CLI-process integration tests — `analyze`+`snapshot` (`artifacts/cli/test/integration/commands/analyze-snapshot-concurrency.test.ts`: 3+3 concurrent processes over a genuine delta ingestion, asserting exit codes, `PRAGMA integrity_check`, a single project row, and `git fsck` on the knowledge branch) and `doctor`+`hydrate` (`doctor-hydrate-concurrency.test.ts`: 3+3 concurrent processes, same DB-integrity assertions; `--skip-git` sidesteps only the remote-reachability probe, which touches neither the DB nor the knowledge lock). The status table below reflects this.

---

## 1. Status Summary

| Command           | Status      | Validation Summary & Fix Records                                                                                       |
| :---------------- | :---------- | :--------------------------------------------------------------------------------------------------------------------- |
| `init`            | ✅ Resolved | The single-flight concurrency lock has fully resolved database migration conflicts.                                    |
| `analyze`         | ✅ Resolved | Implemented LLM decision-extraction & markdown cleanup; resolved the exit-blocking bug.                                |
| `impact`          | ✅ Resolved | Added `console.log` assertions; SQL/LIKE injection defense design has been verified.                                   |
| `status`          | ✅ Resolved | Added `ui.header` assertions; switched `process.exit` to `process.exitCode`.                                           |
| `sync-knowledge`  | ✅ Resolved | Added fast-forward/push status assertions; resolved the exit-blocking bug.                                             |
| `clean`           | ⚠️ 1 Open   | Only the Windows `EBUSY` exception path has not been mock-triggered in unit tests.                                     |
| `doctor`          | ⚠️ 1 Open   | The hooks `fs.stat` failure branch is untested. Concurrent `doctor` + `hydrate`: ✅ covered (2026-07-17, dispatch 2b). |
| `export-topology` | ⚠️ 2 Open   | Embedded JSON data in HTML is never parsed/validated; `--out` as an existing file is untested.                         |
| `hydrate`         | ⚠️ 1 Open   | Lacks an idempotency short-circuit cache. Concurrency under `bulkLoadGraph`: ✅ covered (2026-07-17, dispatch 2b).     |
| `query`           | ⚠️ 3 Open   | Interactive TTY input & Ctrl+C paths are untested; prompt payload size lacks guardrails.                               |
| `review`          | ⚠️ 1 Open   | Large/binary file PR payloads have not been stress-tested.                                                             |
| `snapshot`        | ⚠️ 1 Open   | Read-only directory write failures (EACCES/EROFS) are untested.                                                        |
| `sync`            | ⚠️ 2 Open   | `readStdin()` is completely untested; invalid `commitSha` formats are untested.                                        |
| `uninstall`       | ⚠️ 1 Open   | Concurrency with DB writes during uninstall is untested.                                                               |

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
4. **`hydrate` Idempotency Cache** _(concurrency half closed 2026-07-17, dispatch 2b)_
   - **Description**: `HydrationService.hydrate()` unconditionally reads git and runs `bulkLoadGraph` every call, lacking an already-up-to-date fast path. The concurrency half of this item — `bulkLoadGraph` under concurrent read-write opens — is now stress-tested by `doctor-hydrate-concurrency.test.ts` (3 concurrent `doctor --skip-git` + 3 concurrent `hydrate` real CLI processes, DB integrity asserted).

---

## 3. Supported Language CLI Benchmark Reports

To perform AST / Parser benchmarking and stress tests across all 11 supported languages in `Docuvia2`, the following benchmark execution reports have been created, each comparing Docuvia2 against GitNexus, Graphify, and Code-Review-Graph (CRG) on two real-world target repositories. Reports not yet marked ✅ are still empty shells (pending execution):

| Language       | Test Report File                                               | Target Project 1 (P1)              | Target Project 2 (P2)   | Status                                            |
| :------------- | :------------------------------------------------------------- | :--------------------------------- | :---------------------- | :------------------------------------------------ |
| **C**          | [`c-cli-benchmark.md`](./c-cli-benchmark.md)                   | `redis/redis`                      | `git/git`               | ⏳ Pending                                        |
| **C++**        | [`cpp-cli-benchmark.md`](./cpp-cli-benchmark.md)               | `llvm/llvm-project`                | `tensorflow/tensorflow` | ⏳ Pending                                        |
| **C#**         | [`csharp-cli-benchmark.md`](./csharp-cli-benchmark.md)         | `PowerShell/PowerShell`            | `dotnet/orleans`        | ✅ Completed (2026-07-24, no-LLM structural pass) |
| **Go**         | [`go-cli-benchmark.md`](./go-cli-benchmark.md)                 | `moby/moby`                        | `gin-gonic/gin`         | ⏳ Pending                                        |
| **Java**       | [`java-cli-benchmark.md`](./java-cli-benchmark.md)             | `spring-projects/spring-framework` | `google/guava`          | ⏳ Pending                                        |
| **JavaScript** | [`javascript-cli-benchmark.md`](./javascript-cli-benchmark.md) | `facebook/react`                   | `expressjs/express`     | ⏳ Pending                                        |
| **PHP**        | [`php-cli-benchmark.md`](./php-cli-benchmark.md)               | `laravel/framework`                | `WordPress/WordPress`   | ⏳ Pending                                        |
| **Python**     | [`python-cli-benchmark.md`](./python-cli-benchmark.md)         | `django/django`                    | `fastapi/fastapi`       | ⏳ Pending                                        |
| **Ruby**       | [`ruby-cli-benchmark.md`](./ruby-cli-benchmark.md)             | `rails/rails`                      | `discourse/discourse`   | ⏳ Pending                                        |
| **Rust**       | [`rust-cli-benchmark.md`](./rust-cli-benchmark.md)             | `BurntSushi/ripgrep`               | `tauri-apps/tauri`      | ⏳ Pending                                        |
| **TypeScript** | [`typescript-cli-benchmark.md`](./typescript-cli-benchmark.md) | `microsoft/vscode`                 | `nestjs/nest`           | ⏳ Pending                                        |

### 3.1 C# Benchmark — Key Findings (2026-07-24)

Full detail: [`csharp-cli-benchmark.md`](./csharp-cli-benchmark.md). The LLM-gated surface (Docuvia2 L3 extraction, GitNexus `wiki`, Graphify's semantic layer) was explicitly skipped this pass — see that report's §4 for what a follow-up session still owes. Two findings stand out as worth prioritizing:

1. **`analyze`'s sha fast-path does not detect uncommitted working-tree edits.** A 1-line uncommitted change to a tracked file was invisible to `docuvia analyze` on both target repos ("already up to date with HEAD"), while GitNexus's mtime/hash-based check correctly detected the same edit. This matches the **documented** design in [PLAT-007](../gitbook/adr/platform/PLAT-007-tiered-background-knowledge-evolution.md) (Tier A's sha fast-path is intentional — it's what keeps the post-commit hook cheap), but the benchmark exposed a UX gap: when a human runs `docuvia analyze` manually (not via the git hook), there is no signal that uncommitted changes were skipped. Worth a follow-up: either a log/console note when the fast-path short-circuits with a dirty working tree, or explicit documentation in `analyze --help`.
2. **`impact`/blast-radius returns only 1 file for foundational symbols** (`PSCmdlet`, `IGrain`) where CRG's traversal surfaces hundreds-to-thousands. This matches the **documented** single-hop design in [IMPT-001](../gitbook/adr/impact/IMPT-001-sql-single-hop-blast-radius.md) (a deliberate fast heuristic filter, not the final word — see [IMPT-002](../gitbook/adr/impact/IMPT-002-lsp-for-absolute-quality.md)'s LSP escalation tier for the multi-hop-quality path). Since `--escalate-to-lsp` / Tier B wasn't exercised in this no-LLM-adjacent session, the benchmark cannot yet confirm whether LSP escalation closes this gap in practice — flagged as the natural next benchmark slice.
3. Minor: `docuvia uninstall` still leaves `.docuvia/` and the hidden `docuvia-knowledge` branch behind (manual `git branch -D` required); `export-topology`'s default `--collapse` setting undersells graph density (0 links shown until `--collapse=symbol` is passed).
   > **Fixed (2026-07-24, same-day follow-up):** `uninstall` now deletes the `docuvia-knowledge` branch (`IGitProvider.deleteBranch` → `IKnowledgeGitService.deleteKnowledgeBranch`) and wholesale-removes `.docuvia/` (`removeDocuviaDataDir`), both gated by `--keep-db` alongside `local.db`'s own removal — see [`uninstall`'s execution-flow doc](../gitbook/workflows/uninstall-execution-flow.md). `export-topology`'s collapsed view now reports the folded-away relationship count (`stats.foldedLinkCount`) in the CLI success message instead of silently showing a low link count with no explanation — see `TopologyBuilderService`.
