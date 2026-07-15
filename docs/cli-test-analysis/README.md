# CLI Command Test Analysis — Status

This directory originally held 14 speculative per-command reports, each raising the same 7
templated claims about test gaps (i18n-fragile assertions, no scale testing, no concurrency
testing, no idempotency testing, etc.) without checking them against the actual source. Those
claims have since been verified one command at a time — checked against real source, real tests,
and (where relevant) real test runs — and reclassified as **Confirmed** (real, still open),
**Stale** (already covered elsewhere), **False** (the claim doesn't match the actual code), or
**Overstated** (partially true but exaggerated). The real bugs the verification pass surfaced have
since been fixed (2026-07-15), with logging added and regression tests locking each fix in.

Files for commands with no remaining confirmed issues have been removed. Files below are kept
only where at least one claim is still genuinely open.

## The original 7-category checklist

For reference, this is the checklist every command was screened against:

1. **Incomplete Functionality** — side-effects (spinner text, console output) asserted only indirectly.
2. **Missing Language Support** — hardcoded-English assertions. _(In practice: moot everywhere — no i18n framework exists anywhere in this CLI, so this category was False/Overstated for all 14 commands.)_
3. **Lack of Project Complexity** — tiny mocks vs. realistic scale.
4. **Incomplete Parameter & I/O Checks** — invalid/edge-case inputs untested.
5. **No Real Integration Coverage** — API mocked out, no real DB/filesystem/git verification.
6. **No Command Combination Checks** — concurrency between commands untested.
7. **No Idempotency Consideration** — repeated-run behavior untested.

## Status table

| Command                                   | Status                   | Remaining open items                                                                                                                                                                            |
| ----------------------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`analyze`](./analyze-status.md)          | ✅ Resolved              | see `analyze-status.md`'s own Follow-ups (LLM base-URL suffix edge case, one missing error-log line)                                                                                            |
| [`init`](./init-concurrency-status.md)    | ✅ Resolved (bugs fixed) | none — the "unaudited hook-install/branch-setup concurrency" follow-up was closed by [PLAT-006](../gitbook/adr/platform/PLAT-006-init-single-flight-lock.md)'s whole-command single-flight lock |
| [`clean`](./clean.md)                     | ⚠️ 1 open                | `EBUSY`/unlink failure untested                                                                                                                                                                 |
| [`doctor`](./doctor.md)                   | ⚠️ 2 open                | hooks `fs.stat` rejection branch untested; concurrent `doctor`+`hydrate` unaudited                                                                                                              |
| [`export-topology`](./export-topology.md) | ⚠️ 2 open                | embedded HTML/JSON graph data never verified; `--out` as existing file untested                                                                                                                 |
| [`hydrate`](./hydrate.md)                 | ⚠️ 2 open                | concurrency unaudited; no idempotency fast-path/test                                                                                                                                            |
| [`impact`](./impact.md)                   | ✅ Resolved              | —                                                                                                                                                                                               |
| [`query`](./query.md)                     | ⚠️ 3 open                | interactive Ctrl+C path untested; no prompt-size guard; no scope-cleanup test                                                                                                                   |
| [`review`](./review.md)                   | ⚠️ 1 open                | large/binary-file payload untested                                                                                                                                                              |
| [`snapshot`](./snapshot.md)               | ⚠️ 2 open                | spinner-text unasserted; read-only-directory untested                                                                                                                                           |
| [`status`](./status.md)                   | ✅ Resolved              | — (file kept as an audit record, like `init`'s)                                                                                                                                                 |
| [`sync-knowledge`](./sync-knowledge.md)   | ✅ Resolved              | — (file kept as an audit record, like `init`'s)                                                                                                                                                 |
| [`sync`](./sync.md)                       | ⚠️ 2 open                | `readStdin()` untested; invalid `commitSha` format untested                                                                                                                                     |
| [`uninstall`](./uninstall.md)             | ⚠️ 1 open                | concurrent DB write untested                                                                                                                                                                    |

Legend: ✅ resolved · ⚠️ open, low-severity coverage gaps only (no known behavioral bugs remaining).

## Bugs found and fixed (2026-07-15)

These were discovered by reading the real code paths while checking the speculative claims, not
by the claims themselves. All have since been fixed, logged where relevant, and covered by
regression tests.

1. **`process.exit()` called before `finally` in six commands** — `analyze`, `clean`, `hydrate`,
   `snapshot`, `status`, and `sync-knowledge` all called `process.exit(1)` inside a `catch`, ahead
   of a `finally` block that calls `docuviaMemory.deleteScope(scopeId)`. `process.exit()`
   terminates immediately and does not unwind through `finally` (confirmed with a minimal repro),
   so the memory-scope cleanup never actually ran on error in production. The existing unit tests
   mocked `process.exit` to throw instead of truly exiting, which let `finally` run under the mock
   and masked the bug. `review` and `sync` already avoided this correctly by using
   `process.exitCode = 1` instead — `clean`, `hydrate`, `snapshot`, `status`, and `sync-knowledge`
   were fixed the same way in this session. `analyze` had the identical bug, independently found
   and fixed (also to `process.exitCode`) by a concurrent session's `analyze <targetPath>` LLM
   feature work — see [analyze-status.md](./analyze-status.md). `init.ts`'s single-flight-lock
   restructuring ([PLAT-006](../gitbook/adr/platform/PLAT-006-init-single-flight-lock.md), also
   concurrent with this session) independently resolved its own `process.exit()` call sites by
   deferring them to after the lock-release `finally`, which is safe since nothing follows them —
   a different mechanism than `process.exitCode`, but the same outcome: cleanup always runs before
   exit. Regression tests assert `process.exit` was never called and `deleteScope` still ran for
   each of the five commands fixed directly in this session.
2. **`sync-state.json` race under concurrent `sync`** — `lib/ui-core/src/workflows/sync/sync-state.ts`
   did an unguarded read-modify-write of the dedup-state file. Two concurrent `docuvia sync` runs
   could silently clobber each other's update, losing a synced-content-hash entry. Fixed with a
   cross-process file lock (`withSyncStateLock`, same shape as `init`'s `acquireInitLock`) wrapping
   the load→mutate→push→save cycle in `sync-workflow.ts`. Regression test:
   `sync-state.unit.test.ts`'s "serializes concurrent load-mutate-save cycles instead of racing" —
   without the lock this test is flaky/fails; with it, both concurrent hashes are preserved
   deterministically.
3. **`uninstall` aborted everything on the first platform failure** — the per-platform
   `uninstallHooks` loop in `artifacts/cli/src/commands/uninstall.ts` had no per-iteration
   try/catch, so one platform throwing skipped both the remaining platforms and the database
   cleanup step, with only a generic top-level warning and no indication of what was left in
   place. Fixed: each platform's failure is now caught individually, logged (via the pino-backed
   logger, with the platform name and error), reported to the user, and the loop continues; the
   database cleanup step always runs afterward regardless of platform failures; a final summary
   warning lists everything that failed, and `process.exitCode` is set to 1 if anything did.
   `workspaceRoot` is now also validated non-empty at the top of the command (the same class of
   gap `init.ts` already guarded against). Regression tests in `uninstall.unit.test.ts`.
4. **`query --limit` behaved inconsistently for invalid values** — a negative `--limit` yielded
   **unlimited** results from the FTS-backed path (SQLite treats a negative `LIMIT` as unlimited)
   but a **truncated-to-near-empty** result from the name-ref/neighbor path
   (`Array.prototype.slice(0, negative)`), inside the same `QueryService.search()` call. Fixed by
   normalizing an invalid `limit` (non-integer, ≤ 0, `NaN`) to the default of 10 in one place —
   `QueryService.search()` itself, so every caller (CLI, MCP server, tests) gets the same safe
   behavior — with a logged warning; `query.ts` additionally warns the user directly and doesn't
   forward an invalid `--limit` into `docuviaMemory`. Regression tests in
   `query.service.unit.test.ts` and `query.unit.test.ts`.

## Individual command status files

- [`init-concurrency-status.md`](./init-concurrency-status.md) — `init` (resolved; bugs fixed)
- [`analyze-status.md`](./analyze-status.md) — `analyze` (resolved; LLM decision-extraction feature + test-gap fixes)
- [`clean.md`](./clean.md)
- [`doctor.md`](./doctor.md)
- [`export-topology.md`](./export-topology.md)
- [`hydrate.md`](./hydrate.md)
- [`impact.md`](./impact.md)
- [`query.md`](./query.md)
- [`review.md`](./review.md)
- [`snapshot.md`](./snapshot.md)
- [`status.md`](./status.md)
- [`sync-knowledge.md`](./sync-knowledge.md)
- [`sync.md`](./sync.md)
- [`uninstall.md`](./uninstall.md)
