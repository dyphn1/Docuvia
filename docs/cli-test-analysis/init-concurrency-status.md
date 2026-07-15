# `init` Concurrency Audit — Status (2026-07-14)

Follow-up to `init.md`'s original test-gap analysis (that file has since been removed — its
claims are fully superseded by the verification below). Those claims were checked against source
and running tests; two turned out to be stale (already fixed elsewhere), one was overstated, and
the concurrency gap (#6) turned out to be a real, reproducible crash — worse than "untested". This
doc records where that work landed and what's still open.

## What was verified against the original `init.md` claims

| #   | Claim                                                             | Verdict                                                                                                                  |
| --- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 1   | Empty `cwd` not tested                                            | Confirmed — fixed (test added)                                                                                           |
| 2   | `UI_MESSAGES.INIT_SUCCESS` + fragile `stringContaining` assertion | **False** — that constant doesn't exist; the real test uses an exact match                                               |
| 3   | DB integrity not tested                                           | **Stale** — `init.test.ts` already asserted this before this session                                                     |
| 4   | Invalid `platformFilter` chars untested                           | Overstated — unknown-slug path already has error handling and a test                                                     |
| 5   | No multi-language / real file-system coverage                     | Confirmed — fixed (test added)                                                                                           |
| 6   | No concurrent-`init` coverage                                     | Confirmed, **and more severe than stated**: reproduces a real crash + a silent data-duplication bug, not just a test gap |
| 7   | Idempotency not tested                                            | **Stale** — already covered by an existing test                                                                          |

## Bugs found and fixed (both under #6, both required a fix, not just a test)

1. **Migration race** — two `docuvia init` processes racing a fresh workspace both saw
   `schema_migrations` as empty and both tried to record the same migration filename, throwing
   `Failed to apply migrations` / `database is locked` and exiting 1.
   - Fix: [migration-runner.ts](../../lib/schema/src/sqlite/migration-runner.ts) wraps the
     check-and-apply sequence in a single `IMMEDIATE` transaction; `graph-store.ts` added a
     cross-process file lock (`acquireInitLock`/`releaseInitLock`, same shape as the existing
     `acquireKnowledgeLock` in `libgit2-provider.ts`) around the WAL-mode switch + migration step.

2. **Duplicate `projects` row** (found only after fixing #1 and re-stress-testing) — two racing
   processes could both observe "no project row yet" and both insert, silently creating 2 rows
   with no error at all. Worse than the crash: nothing surfaces it.
   - Fix: `ProjectsRepo.getOrInsert()` ([projects-repo.ts](../../lib/schema/src/sqlite/repos/projects-repo.ts))
     does the check-and-insert inside one `IMMEDIATE` transaction; `seed-project-row.ts` now calls
     it instead of composing `getFirst()` + `insert()` itself.

## Tests added

- `artifacts/cli/test/unit/commands/init.unit.test.ts` — empty `cwd` rejects before touching `docuviaApi.init`.
- `artifacts/cli/test/integration/commands/init-multi-language.test.ts` (new) — seeds one fixture
  per language (TS/Python/Go/Java), asserts each produces a real parsed symbol in `l2_nodes`, not
  just a `project_files` row.
- `artifacts/cli/test/integration/dist-build.test.ts` — races several `init` processes against the
  compiled `dist/cli.js` (not `tsx` — see that file's comment for why `tsx` couldn't reproduce this
  reliably), 5 rounds × 4 processes, asserting every process exits 0 and `projects` ends with
  exactly 1 row.

**Known limitation**: the concurrency regression test is inherently timing-dependent (OS
process-scheduling jitter). Running 5 rounds drives detection probability close to 100% for a
real regression, but it isn't perfectly deterministic — an occasional flake on an unrelated,
heavily-loaded CI run is possible. Standalone reruns (8+ consecutive) and a manual 60-process bash
stress test were clean after the fix.

## Verification performed

- All previously-existing tests in `lib/schema`, `lib/ui-core`, `lib/core`, and `artifacts/cli`
  still pass after the interface change (`IProjectsRepo.getOrInsert`) — required updating ~10 mock
  objects typed against that interface.
- Full `artifacts/cli` suite (24 files / 95 tests) run 3× clean after the fix.
- `pnpm --filter @workspace/schema build`, `@workspace/ui-core build`, `@workspace/core build`,
  `@workspace/contracts build` all typecheck clean.

## Follow-ups / not yet done

1. ~~Other steps in the `init` workflow may have the same class of race, unaudited.~~ **Resolved** —
   a follow-up session's audit found exactly this ("check persisted state, then conditionally
   mutate it, no lock around the pair") unprotected in three more places
   (`KnowledgeGitService.ensureKnowledgeBranch()`'s `branchExists()` check, `installPostCommitHook()`'s
   marker check, and `writeOrAppend()`'s check-then-append), and closed the whole class at once with
   a coarse workspace-level single-flight lock around the entire `init` command — see
   [PLAT-006](../gitbook/adr/platform/PLAT-006-init-single-flight-lock.md).
2. ~~User raised a broader architectural idea: a "single-flight" / leader-registration pattern...~~
   **Resolved, with a correction**: PLAT-006 adopted a single-flight _lock_ (not leader/follower
   outcome-mirroring — a waiter reruns `init` itself under the lock rather than replaying another
   process's result, relying on `init`'s existing idempotency to make the rerun a fast no-op).
   PLAT-006 also flags that **this doc's original claim of a "Postgres advisory lock" /
   `orphan-branch-r-w-protocol.md` precedent in old Docuvia was fabricated** — that filename and the
   string "advisory lock" do not exist anywhere in this repo or old Docuvia's docs; do not cite it.
   The real precedent, found later, was legacy ADR-027 ("Hook-Driven Thin Client"), though it turned
   out to solve an orthogonal problem (non-conflicting parallel work notified via a shared hook, not
   mutual exclusion over identical mutations).
3. ~~The `docs/cli-test-analysis/init.md` source doc itself was not corrected.~~ **Done** — as part
   of the broader `docs/cli-test-analysis/` reorg (2026-07-15), the original speculative `init.md`
   was removed since this doc fully supersedes it. See [README.md](./README.md) for the
   all-commands status table produced by that same reorg.
4. **Test pollution cleanup**: during manual reproduction, one command accidentally ran `docuvia
init` against the real `artifacts/cli` directory instead of a temp sandbox, creating
   `.claude/`, `.cursor/`, `.github/`, `CLAUDE.md`, `.cursorrules`, `.windsurfrules`, `llms.txt`.
   These were removed (confirmed with user) before this session ended. Worth double-checking
   `git status` at the start of the next session in case anything was missed.

## Current working-tree state (as of this doc)

Modified (not committed):

```
artifacts/cli/test/integration/commands/init.test.ts
artifacts/cli/test/integration/dist-build.test.ts
artifacts/cli/test/unit/commands/init.unit.test.ts
lib/contracts/src/interfaces/graph-store.interfaces.ts
lib/core/src/git/hydration.service.unit.test.ts
lib/schema/src/sqlite/graph-store.integration.test.ts
lib/schema/src/sqlite/graph-store.ts
lib/schema/src/sqlite/migration-runner.ts
lib/schema/src/sqlite/repos/projects-repo.ts
lib/ui-core/src/utils/ensure-hydrated.unit.test.ts
lib/ui-core/src/workflows/export-topology/export-topology-workflow.unit.test.ts
lib/ui-core/src/workflows/hydrate/hydrate-workflow.unit.test.ts
lib/ui-core/src/workflows/impact/impact-workflow.unit.test.ts
lib/ui-core/src/workflows/init/init-workflow.unit.test.ts
lib/ui-core/src/workflows/init/seed-project-row.ts
lib/ui-core/src/workflows/init/seed-project-row.unit.test.ts
lib/ui-core/src/workflows/query/query-workflow.unit.test.ts
lib/ui-core/src/workflows/review/review-workflow.unit.test.ts
lib/ui-core/src/workflows/snapshot/snapshot-workflow.unit.test.ts
lib/ui-core/src/workflows/status/status-workflow.unit.test.ts
lib/ui-core/src/workflows/sync/sync-workflow.unit.test.ts
```

New (untracked, intentional):

```
artifacts/cli/test/integration/commands/init-multi-language.test.ts
docs/cli-test-analysis/init-concurrency-status.md  (this file)
```

Nothing has been committed yet — no commit was requested this session.
