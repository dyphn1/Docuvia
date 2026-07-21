# Phase 2, Items 1–2 — `sync-knowledge` Scheduling & Remote-Sync Auto-Push (2026-07-21)

> **Input:** [Roadmap & Open Items](roadmap-and-open-items.md), Phase 2 items 1 ("`sync-knowledge`
> scheduling") and 2 ("Remote sync auto-push story"). Both were raised together because the
> roadmap's own item 1 explicitly ties them: whichever pre-push composition point `sync-knowledge`
> gets must not double-fetch, and that composition choice is easier to reason about once item 2's
> shape (or lack of one) is also settled. Numbering follows this project's `PREFIX-NNN` contract
> convention (see `phase2-l3-distribution.md` for the precedent this format follows); prefix
> `SKSCHED`.

---

## Problem

Two related but distinct scheduling gaps existed:

1. **`sync-knowledge`** (git-level knowledge-branch reconciliation with `origin` — fetch, fast-
   forward/push/Tree-Adoption-merge) had no automatic trigger anywhere. Its own doc comment already
   blessed "a scheduled task or CI step" as the follow-up, but nothing wired it up.
2. **`sync`** (pushes locally-generated L3 decisions to a separate hosted backend API, requiring an
   explicit `projectId` + PAT) also has no automatic trigger — entirely manual today.

These are not the same mechanism. `sync-knowledge` operates against the source repo's own `origin`
remote and needs no credentials beyond normal git remote access; `sync` talks to a different,
credentialed system entirely (`IRemoteSyncClient`, PAT-gated). The roadmap grouped them because
both are "the background loop should maybe do this automatically" questions, not because they share
an implementation.

## 1. `sync-knowledge` scheduling — decided & shipped

**SKSCHED-001 — Compose `sync-knowledge` onto the existing pre-push hook, after `snapshot`, and
nowhere else.** The pre-push hook chain becomes
`analyze --escalate-to-lsp && snapshot && sync-knowledge`, still unconditionally `exit 0` (never
blocks the push — PLAT-007's honest-degradation contract). Rejected: a second hook, a scheduled
task, or a CI step.

- **Why pre-push, and only pre-push:** the roadmap's "must not double-fetch" concern is resolved by
  wiring `sync-knowledge` into exactly one place. Composing it into the post-commit hook as well
  (or instead) would fetch the knowledge branch once per commit; pre-push is the one place PLAT-007
  already established as "network I/O is acceptable here" (the user's own push is already a network
  operation, typically heavier than this batch).
- **Why not a new scheduler:** PLAT-007 rejected OS-scheduled idle timers and resident daemons
  consistently (ADR-027, PLAT-006, IFCE-002) as "a daemon-manager in disguise." A pre-push
  composition needs no scheduler at all — same reasoning that put Tier B on pre-push in the first
  place.
- **Why after `snapshot`, not before or in parallel:** reconciling the knowledge branch only matters
  once a fresh local snapshot commit exists to reconcile; chaining after `snapshot` via `&&` mirrors
  the existing Tier A/B chain semantics exactly (each step only runs if the previous one exited 0).

**SKSCHED-002 — `git-constants.ts`'s `PRE_PUSH_HOOK_CONTENT` placeholder comment (`# Phase 2: a
sync-knowledge step composes here`) is replaced with the real composition**, not left as
documentation for a future slice.

**SKSCHED-003 — Hooks already installed before this change need an in-place upgrade, not a silent
no-op.** `installPrePushHook` previously had no legacy-upgrade branch (PLAT-007 shipped it as
"brand-new... no legacy pre-push hook to upgrade"). That's no longer true once this composition
ships onto an already-adopted hook. Mirrors `installPostCommitHook`'s existing legacy-upgrade
technique exactly:

- `PRE_PUSH_HOOK_MARKER` (`"docuvia analyze --escalate-to-lsp"`) stays the "is a Docuvia pre-push
  hook installed at all" check — present in both old and new content.
- A new `PRE_PUSH_SYNC_KNOWLEDGE_MARKER` (`"docuvia sync-knowledge"`) distinguishes the current
  content from the frozen `LEGACY_PRE_PUSH_HOOK_CONTENT` (the exact pre-SKSCHED content, kept
  verbatim for exact-match replacement).
- `installPrePushHook`: marker present but sync-knowledge marker absent → exact-content-match
  replace (`writeHookFile`, not `appendHookFile`) — never a duplicate block.
- `removePrePushHook`: strips whichever content variant (current or legacy) is present, same
  two-step strip `removePostCommitHook` already uses.

**SKSCHED-004 — No dedicated `doctor --fix` repair method for this case, unlike the post-commit
duplicate-block repair.** The post-commit repair method exists because a hand-edited legacy block
could break the exact-content strip and produce a real duplicate. Here, `installPrePushHook`'s
upgrade path already self-heals on the next `docuvia init` — no separate repair plumbing is
proportionate to add speculatively. If a hand-edited-legacy-block duplicate case is ever actually
observed for pre-push (mirroring what motivated the post-commit repair), add the equivalent repair
then, not now.

**SKSCHED-005 — `doctor` gains a `pre_push_hook` diagnostic**, distinct from the existing `git_hook`
key (a different hook file, a different state space): not-installed → PASS (a legitimate state,
matches `git_hook`'s own "not installed" precedent); installed-but-stale (marker present, sync-
knowledge marker absent) → FAIL, suggesting `docuvia init`; installed-and-current → PASS.

## 2. Remote sync auto-push — explicitly parked, not decided

**SKSCHED-006 — Item 2 is deliberately left undecided, not designed.** Auto-wiring `sync` into the
background loop is a credential-management decision, not a scheduling one: `sync` requires
`projectId` + PAT, and nothing in this codebase persists those non-interactively today — every call
site passes them explicitly (`SyncWorkflow.execute({ projectId, ... })`, CLI args). Making a hook
call `sync` unattended means either:

- storing a PAT somewhere a background git hook can read it without a human present, or
- some other credential-brokering mechanism that does not exist yet,

either of which is itself a decision requiring explicit security review (secret-at-rest handling),
not a byproduct of a scheduling ticket. Parked per this project's established "measured, not
estimated" re-entry pattern (roadmap items 9/10 use the same shape): re-open when either (a) a real
user reports the manual `sync` step as friction in practice, or (b) a concrete credential-storage
design is proposed and separately reviewed. Neither exists today.

## 3. Rejected alternatives

- **A second git hook dedicated to `sync-knowledge`** — rejected; doubles the hooks a user has to
  reason about/uninstall for no benefit over composing onto the existing Tier B pre-push chain.
- **OS-scheduled task / cron / CI step** — rejected, consistent with PLAT-007's repeated rejection
  of daemon-manager-shaped scheduling; pre-push needs no external scheduler.
- **Deciding item 2's shape now** (e.g. a stored-PAT design) — rejected as premature; no measured
  need exists, and credential storage deserves its own reviewed decision, not a rider on a
  scheduling ticket.

## Implementation

Shipped in one pass (2026-07-21):

- `lib/core/src/git/git-constants.ts` — `PRE_PUSH_SYNC_KNOWLEDGE_MARKER` added;
  `LEGACY_PRE_PUSH_HOOK_CONTENT` freezes the pre-SKSCHED hook body verbatim; `PRE_PUSH_HOOK_CONTENT`
  now composes `sync-knowledge` after `snapshot`; `GitMessages.UPGRADED_LEGACY_PRE_PUSH_HOOK` added.
- `lib/core/src/git/knowledge-git.service.ts` — `installPrePushHook` gains the legacy-upgrade
  branch (`hasCurrentPrePushHook` helper distinguishes "installed" from "installed and current");
  `removePrePushHook` strips both content variants.
- `lib/ui-core/src/workflows/doctor/doctor-messages.ts` /
  `lib/ui-core/src/workflows/doctor/doctor-workflow.ts` — new `PRE_PUSH_HOOK` diagnostic key and
  `runPrePushHookDiagnostic`, wired alongside the existing post-commit `runGitHookDiagnostic` under
  the same `skipGit` gate.
- Tests: `lib/core/src/git/knowledge-git.service.unit.test.ts` (legacy-upgrade + dual-content-strip
  cases, mirroring the post-commit precedent), `lib/ui-core/test/workflows/doctor-workflow.unit.test.ts`
  (new `pre_push_hook` diagnostic cases).

**Verification (independent re-check, not the implementer's self-report):** `pnpm run build`
green; `lib/core` 216/216, `lib/ui-core` 281/281, `artifacts/cli` integration
(`uninstall.test.ts` + `doctor-fix-git-hook.test.ts`, real git, no mocks) 3/3. ESLint clean.
