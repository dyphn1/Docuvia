---
id: PLAT-006
title: Coarse-Grained Single-Flight Lock for `init`, Not Leader/Follower Outcome-Mirroring
status: accepted
date: 2026-07-14
domains: [platform, storage]
supersedes: []
superseded_by: []
---

# Coarse-Grained Single-Flight Lock for `init`, Not Leader/Follower Outcome-Mirroring

## Context

A prior session fixed two concurrent-`init` bugs found by stress-testing `docuvia init` racing itself
against a fresh workspace (see `docs/cli-test-analysis/init-concurrency-status.md`):

1. **Migration race**: two processes both saw `schema_migrations` empty and both tried to record the
   same filename → `UNIQUE` violation / `database is locked` crash. Fixed by wrapping the
   check-and-apply sequence in `migration-runner.ts` in a single `IMMEDIATE` transaction, plus a
   cross-process file lock (`acquireInitLock`/`releaseInitLock` in `graph-store.ts`) around the
   WAL-mode switch + migration bootstrap in `GraphStore.open()`.
2. **Duplicate `projects` row**: two processes both saw "no project row yet" and both inserted,
   silently creating two rows with no error. Fixed by `ProjectsRepo.getOrInsert()`, an atomic
   check-and-insert.

Both fixes are narrow — each locks only the one code path where a bug was actually caught. Auditing
the rest of the `init` workflow for the same class of bug ("check persisted state, then conditionally
mutate it, with no lock around the check+mutate pair") found it unprotected in at least three more
places, none of which were stress-tested:

- `KnowledgeGitService.ensureKnowledgeBranch()` — `branchExists()` is checked _before_ the
  knowledge-branch lock is acquired. Two racing processes can both observe "branch doesn't exist" and
  both proceed to pack a snapshot; the lock only serializes the two packs, it doesn't stop the second
  one from happening — net effect is a spurious duplicate initial commit on the knowledge branch.
- `KnowledgeGitService.installPostCommitHook()` — checks the hook marker and appends with no lock at
  all. Two racing processes can both see "no marker" and both append, duplicating the post-commit hook
  body (meaning `docuvia snapshot` fires twice per commit going forward, silently, forever).
- `writeOrAppend()` in `artifacts/cli/src/utils/fs-utils.ts`, shared by every platform integration
  installer (Claude/Cursor/generic-markdown): same unlocked check-then-append race, on files like
  `.cursor/hooks.json`.

Before this session, the user had proposed an architectural alternative to patching every site
individually: a leader/follower single-flight pattern scoped to the whole `init` command — the first
process becomes the leader and does the real work; any other concurrent process detects a leader is
already running, does not re-execute any phase itself, and instead registers a hook and passively waits
to receive completion/status updates from the leader, then mirrors its outcome.

This repo's ADRs and the predecessor Docuvia project's docs were searched for a prior write-up of this
idea. A previous session's status doc claimed the closest analog was a Postgres advisory lock guarding
orphan-branch writes, citing a file `orphan-branch-r-w-protocol.md`. That filename, and the string
"advisory lock", do not exist anywhere in either repo's docs tree — that citation was fabricated by
whichever session wrote it and should not be treated as a real precedent.

**Correction**: a real, related precedent does exist in this repo — legacy
[ADR-027](../legacy/ADR-027-sub-second-incremental-watch.md) ("Hook-Driven Thin Client"), later
superseded by [PLAT-004](PLAT-004-zero-interruption-invisible-indexing.md). ADR-027 describes exactly
the "no daemon, no IPC, processes converge via a shared on-disk hook" shape the user described: every
VS Code window runs its own file-watcher on `.docuvia/tmp/` and re-renders when anything changes it. It
was missed in the initial search because it doesn't use the literal terms searched for ("single-flight",
"leader election", "advisory lock") — a keyword-search gap, not an absence of precedent. However, it
solves a genuinely different problem: in ADR-027, every process does its **own, non-conflicting** real
work (each window parses its own dirty buffer) and the hook is a pure notify-to-re-render signal — no
mutual exclusion is needed because nobody is racing to mutate the _same_ row/file. `init`'s bug is the
opposite: N processes racing to perform the **identical mutation** on shared persistent state (same
migration, same project row, same branch commit, same hook file), which does need mutual exclusion.
ADR-027 is not "rejected as unsuitable" for `init` — it's orthogonal. What it _does_ carry over: fs.watch
on a shared path as a wake-up hook is an already-accepted pattern in this codebase (ADR-027 explicitly
tolerates "File-Watch Overhead" as a negative consequence), which means fs.watch is reasonable as a fast
optional wake-up layered on top of the poll+heartbeat baseline below — just not as the sole signal for
something correctness-critical, the way ADR-027 could afford for a UI-only, eventual-consistency signal.

## Decision

**Reject leader/follower outcome-mirroring. Adopt one coarse workspace-level lockfile scoped to the
whole `init` command; a process that can't acquire it waits, then runs `init` normally, relying on
`init`'s existing idempotency checks to make its own run a fast no-op — not on receiving or replaying
the leader's result.**

Concretely:

- One lockfile guards the entire `init` command (not just DB bootstrap, as `acquireInitLock` does
  today). A process that finds the lock held waits for it, rather than proceeding.
- The lock is heartbeat-refreshed: the holder touches the lockfile's mtime periodically (e.g. every
  ~10s) while `init` runs. Waiters treat the lock as stale only if its mtime hasn't advanced in some
  multiple of the heartbeat interval, combined with a PID-liveness check (`process.kill(pid, 0)`) —
  not the current fixed 60s-mtime-staleness / 10s-wait-deadline scheme in `acquireInitLock`, which is
  sized for a sub-second DB bootstrap and would misfire (a waiter steals the lock from a live leader)
  once `init`'s file-discovery + AST-parsing phase runs long on a large repo.
- Once a waiter acquires the lock, it runs `init` exactly as if it had won the race — no special
  "I was a follower" code path. Its exit code, stdout, and messages are its own genuine output, not a
  copy of the leader's. On an idempotent, already-initialized workspace this resolves in milliseconds
  (branch-exists / hook-marker / `getOrInsert` checks all short-circuit).
- No IPC, no status-file protocol, no stdout-replay between processes.
- This also serves as crash recovery for free: if the leader dies mid-`init` (DB half-migrated, branch
  created but hook not installed), the next process to acquire the lock completes the init via its
  normal run, rather than needing a distinct "leader crashed" fallback path.

The two already-shipped per-site fixes (migration `IMMEDIATE` transaction + `acquireInitLock`, and
`ProjectsRepo.getOrInsert()`) are **kept, not superseded** — they are storage-layer invariants that
matter for any command touching the DB, not `init`-specific patches (e.g. two concurrent `docuvia
snapshot` processes could hit the same migration race with no `init` involved at all). The new coarse
`init`-command lock additionally closes the three unaudited races above, and the general class of
future `init`-phase races, without bespoke per-site locks for each one.

Follow-up (not yet scheduled): consolidate the near-duplicate lockfile logic across `acquireInitLock`
(`lib/schema/src/sqlite/graph-store.ts`), `acquireKnowledgeLock` (`lib/libgit2/src/libgit2-provider.ts`),
and the new command-level lock into one shared utility (wx-create, heartbeat, PID+mtime staleness,
retry-on-`EPERM`/`EBUSY` for Windows AV/indexer interference). Also flagged, independent of this
decision: `writeOrAppend()` catches _all_ read errors (not just `ENOENT`) and treats them as "file
doesn't exist," clobbering the target file on errors like `EACCES`/`EISDIR` — a latent data-loss bug
to fix regardless of the locking work.

**Observability requirement, independent of whether/when the coarse lock ships**: all three unaudited
sites are silent today — none of them log anything when the race actually fires, which is exactly why
they went undetected without deliberate multi-process stress testing. Each site's check-then-act should
become a **recheck immediately after acquiring whatever lock is available** (the pattern the two shipped
fixes already use via `IMMEDIATE` transactions), and log a `warn` specifically when that recheck flips
the outcome — e.g. "knowledge branch was created concurrently by another process, skipping duplicate
initial commit," or "post-commit hook was already installed by a concurrent process." That log line is
the signal that should have caught this originally, and it remains valuable defense-in-depth even after
the coarse lock ships, since it also guards any caller path that reaches these functions from outside
`init` (e.g. a future command that re-installs hooks directly). Likewise, `writeOrAppend()`'s error
handling should distinguish `ENOENT` (silently fine) from any other read error and `warn` before
clobbering, instead of treating all errors identically.

## Consequences

**Easier:**

- Every future `init` phase gets race-safety for free by construction (it runs under the command-level
  lock), instead of needing its own audited lock — closes a whole bug class rather than one instance.
- No IPC/status-protocol surface to build, version, or debug across Windows/macOS/Linux.
- Crash recovery is the same code path as the happy path — no separate "leader died" branch to get
  wrong or leave untested.

**Harder / risks introduced:**

- The heartbeat + PID-liveness staleness check is more state than the current fixed-timeout lock and
  needs its own tests (heartbeat cadence, clock skew tolerance, PID reuse after a crash — a known,
  accepted caveat when combined with mtime).
- A coarse lock serializes _all_ `init` work, including the file-discovery/AST-parsing phase — on a
  very large repo, a second invocation now waits for the full first run rather than failing fast or
  partially proceeding. Accepted: correctness over latency for a command that's not a hot path.
- This lock only serializes `init` against `init`. It does not by itself cover `init`-vs-`snapshot`
  concurrency (e.g. a post-commit hook firing `snapshot` while a second `init` is mid-run) — that's
  already partially handled by the knowledge-branch lock and WAL + `busy_timeout`, but was not
  re-verified under load as part of this decision and remains a separate concern.
- Re-evaluate this decision if a real use case needs live progress reporting to a waiting process
  (not just "waiting… done") — that would justify the IPC machinery this ADR explicitly rejects today.

## Advice

A second-opinion design review (consulted directly on this decision, given full context: the two
shipped fixes, the three newly-found unaudited races, and the user's leader/follower proposal) agreed
the diagnosis — one bug class, five instances — was correct, but pushed back on the follower half of
the proposal specifically:

- Idempotent phases mean "wait, then rerun" produces the identical end state as "wait, then mirror the
  leader's result," with far less machinery (no IPC, no outcome protocol) and better crash-recovery
  behavior (a rerun completes a crashed leader's work; a mirror needs its own fallback for that case).
- "Passive, non-polling" cross-process notification was assessed as not realistically achievable in a
  portable way — `fs.watch` is unreliable across platforms (especially Windows), and named
  pipes/sockets require running a small server for a command invoked once per workspace lifetime.
  Lockfile polling at 100–250ms (already used by `acquireInitLock`/`acquireKnowledgeLock`) is
  indistinguishable from events at CLI-invocation timescales.
- Recommended keeping the two existing per-site storage fixes as-is (they're correctness properties of
  the storage layer, not `init`-specific), adding the one coarse command-level lock, and explicitly
  _not_ adding three more bespoke per-site locks to the newly-found races — that would trade one
  maintainability problem (patch every site) for another (five lockfiles with subtly different
  staleness rules).
- On the overengineering question the user raised: concurrent `init` was judged not to be user
  error alone but a plausible product-shaped occurrence, since Docuvia2's own `init` installs itself
  into multiple AI-agent/editor integration points (`.claude/`, `.cursor/`, MCP config) — the class of
  tools most likely to invoke `init` programmatically and concurrently. Combined with the failure mode
  being silent and permanent (a duplicated post-commit hook keeps firing twice per commit indefinitely,
  not just once), a lock reusing an existing pattern was judged to clear the cost/benefit bar; the
  leader/follower notification protocol was judged not to.

> **Implementation Status (2026-07-18 reconciliation)**:
>
> - The **observability requirement** (lines 114-125 above) shipped: `KnowledgeGitService.ensureKnowledgeBranch()`
>   and `installPostCommitHook()` both recheck inside their lock and log a `warn`
>   (`GitMessages.CONCURRENT_INITIAL_COMMIT_SKIPPED` / `CONCURRENT_HOOK_INSTALL_SKIPPED`) when the
>   recheck flips the outcome; `writeOrAppend()` (`artifacts/cli/src/utils/fs-utils.ts`) now
>   distinguishes `ENOENT` from other read errors and warns before treating a non-`ENOENT` failure as
>   "file doesn't exist," closing the clobbering bug flagged in the Follow-up paragraph above.
> - The **consolidation follow-up** is partially done: a generalized shared lock utility now exists
>   (`lib/contracts/src/utils/process-lock.ts` — wx-create, heartbeat, PID+mtime staleness, matching
>   this ADR's design) and has **two** consumers: the CLI `init` command lock this ADR designed, and
>   (undocumented here until now) Tier C's drain-step throttle
>   (`tier-c-throttle.ts`'s `tryAcquireTierCLock()`, added in Slice 4 — see
>   [Phase 1 — Decision Integration §9f](../../analysis/phase1-decision-integration.md)), which
>   explicitly reused "the PLAT-006 single-flight lock pattern." `acquireInitLock`
>   (`graph-store.ts`) and `acquireKnowledgeLock` (`libgit2-provider.ts`) remain separate,
>   non-consolidated implementations — so this follow-up is no longer accurately described as
>   "not yet scheduled," but it isn't finished either.
> - **Scope gap found and closed same day (2026-07-18)**: "one lockfile guards the entire `init`
>   command" (Decision, above) was true only for the CLI entry point until this fix — the MCP tool
>   `docuvia_init` (`artifacts/cli/src/mcp/tools/init.ts`) called the underlying API directly and
>   never acquired this lock, so two concurrent MCP-triggered inits (or one MCP + one CLI) weren't
>   mutually exclusive, despite this ADR naming AI-agent/editor integration points as the realistic
>   concurrent-trigger scenario in the Advice section above. Fixed by extracting the lock
>   acquire/release into a shared `withInitCommandLock` helper
>   (`artifacts/cli/src/utils/init-command-lock.ts`) used by both the CLI command and the MCP tool.
>   Regression test: `init-cli-mcp-symmetry.test.ts`'s "MCP docuvia_init waits for the
>   init-command lock instead of bypassing it" — deterministically holds the lock and asserts the
>   MCP call blocks until release, rather than relying on an in-process race (verified not to
>   reliably reproduce the original bug: same-process async calls around synchronous
>   better-sqlite3 work don't interleave mid-critical-section the way separate OS processes do).
