---
id: IFCE-005
title: Rename `sync` to `publish`; Keep `sync-knowledge` Separate
status: accepted — pending implementation
date: 2026-07-28
domains: [interface]
supersedes: []
superseded_by: []
---

# Rename `sync` to `publish`; Keep `sync-knowledge` Separate

## Context

Flagged repeatedly (and explicitly skipped by the automated roadmap sweep on 2026-07-28 as
needing a human decision — see [roadmap-and-open-items.md, item 3](../../analysis/roadmap-and-open-items.md))
as a source of confusion: `docuvia sync` and `docuvia sync-knowledge` share a name stem but do
unrelated things, and the shared stem is the wrong way round relative to what each command
actually does:

|           | `sync`                                                                                                                                                         | `sync-knowledge`                                                                                                                          |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Target    | HTTP Cloud API backend (`DOCUVIA_API_URL` + `MCP_PAT`)                                                                                                         | Git remote, the hidden `docuvia-knowledge` branch                                                                                         |
| Direction | One-way **push** only — [sync.ts](../../../../artifacts/cli/src/commands/sync.ts) calls `docuviaApi.sync()`, which POSTs decisions out; there is no fetch/pull | True two-way **sync** — [sync-knowledge.ts:48](../../../../artifacts/cli/src/commands/sync-knowledge.ts#L48) fetches, merges, then pushes |
| Wiring    | Manual/CI only — not referenced by any hook                                                                                                                    | Auto-invoked on every push via [`.husky/pre-push`](../../../../.husky/pre-push#L18) — the default, core behavior                          |
| Lock      | None                                                                                                                                                           | `KnowledgeBranchLock`                                                                                                                     |

The word "sync" is a better description of the _bidirectional_ branch reconciliation than of the
_one-way_ API push it's currently attached to — and the shorter, more prominent name ended up on
the optional/peripheral command while the always-on default behavior carries the longer,
more-qualified name. The existing user-guide for `sync-knowledge` already has to spell out
"Unlike the `sync` command which pushes L3 decisions to the remote API server..." to disambiguate
— documentation having to explain away a naming collision is itself the symptom.

Two paths were discussed:

1. Rename one command so the two no longer share a stem.
2. Merge both under one entry point disambiguated by a flag or subcommand, analogous to
   `git checkout <branch>` vs `git checkout -- <path>`.

## Decision

**Path 1 — separate rename.** `sync` is renamed to `publish` (single verb, consistent with the
existing style of `analyze`/`review`/`impact`/`query`/`snapshot`/`hydrate`/`doctor`). `sync-knowledge`
is left exactly as-is.

Path 2 (merging under one verb with a mode flag/subcommand) was considered and rejected:

- The two commands don't share enough operational identity to justify one entry point: different
  remote systems (HTTP API vs. git remote), different auth (PAT vs. git credentials), different
  lock domains, different flag sets (`sync` takes `--commitSha`/`--interactive`; `sync-knowledge`
  takes neither), and different callers (one is hook-invoked non-interactively, the other is
  manual/CI). Merging would trade "confusing command name" for "confusing disambiguating flag" —
  not a net simplification.
- `git checkout` is itself a cautionary example, not a model to copy: overloading "switch branch"
  and "restore file" under one verb was confusing enough that Git 2.23 (2019) split it into
  `git switch` and `git restore`.
- This codebase already has a working precedent for keeping opposite-direction, related operations
  as separate verbs rather than one verb plus a mode flag: `snapshot` (export graph → git branch)
  and `hydrate` (import git branch → graph) are not `docuvia knowledge --export`/`--import`.

Implementation is **not done yet** — this ADR records the naming decision so the rename can be
carried out as its own scoped task. When implemented, it touches: `CLI_COMMANDS`/
`CLI_COMMAND_DESCRIPTIONS`/`CLI_COMMAND_FLAGS` in `cli-commands.ts`, the `cli.ts` dispatch entry,
`commands/sync.ts` (rename to `commands/publish.ts`, `syncCommand` → `publishCommand`), the
`sync.log` naming, user-guide (`cli/sync.md` → `cli/publish.md`, `cli.md`'s command table),
`workflows/sync-execution-flow.md`, `adr/cli-driven-architecture.md`'s `docuvia sync` section, and
associated unit/integration tests. It does **not** touch anything keyed on the literal string
`"sync-knowledge"` (`PRE_PUSH_SYNC_KNOWLEDGE_MARKER` in `git-constants.ts`, `.husky/pre-push`,
`sync-knowledge.ts`), since that command is unaffected.

## Consequences

- **Positive**: The two commands no longer share a name stem, so a user can no longer confuse
  which one talks to which remote purely from the name. `sync-knowledge`'s user-guide no longer
  needs a disambiguation paragraph explaining what it isn't.
- **Negative**: `publish` is a rename of a shipped (if unwired) command — anything outside this
  repo that scripts `docuvia sync <projectId>` directly (as opposed to going through the
  `pre-push` hook, which never called it) breaks until updated to `docuvia publish`.
- **Neutral**: Blast radius is intentionally on the _unwired_ command. `sync-knowledge` — the one
  actually load-bearing in automation (`pre-push`) — is untouched, so this decision carries no risk
  to the existing Tier B push flow ([PLAT-007](../platform/PLAT-007-tiered-background-knowledge-evolution.md)).
