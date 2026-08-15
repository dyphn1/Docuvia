---
id: IFCE-006
title: Rename `init` to `install` for Naming Symmetry with `uninstall`
status: accepted
date: 2026-08-14
domains: [interface]
supersedes: []
superseded_by: []
---

# Rename `init` to `install` for Naming Symmetry with `uninstall`

## Context

Raised during a design-discussion session (2026-08-14): agents driving the Docuvia CLI by
inference — guessing a command name instead of reading `--help` first — most often guess wrong on
the setup command specifically, reaching for `install` before `init`. This is a reported
observation from that session (colleague/agent feedback), not an internally-measured metric —
recorded here as-reported, not inflated into a measured claim.

The mismatch isn't just a surface coincidence. The codebase's own internal vocabulary already
leans `install`/`uninstall`: `ClaudePlatform`'s hook-management methods are named
`installHooks()`/`uninstallHooks()` (see
[roadmap-and-open-items.md, item 26](../../analysis/roadmap-and-open-items.md)), predating this
ADR. `init` is the outlier that never picked up the same vocabulary as its own counterpart command.

Root cause: two different CLI naming traditions collided. `init` follows the `git init`/`npm init`
bootstrapping convention, which has no widely-used antonym (there is no common `uninit`).
`uninstall` follows the `npm install`/`pip install` package-lifecycle convention, whose antonym is
exactly `install`. Docuvia adopted the antonym-less half of one tradition (`init`) for setup and
the antonym-bearing half of the other tradition (`uninstall`) for teardown — the two verbs were
never going to read as a pair.

## Decision

**Rename `init` to `install`.** No backwards-compatible alias — matches
[IFCE-005](IFCE-005-rename-sync-to-publish.md)'s accepted precedent of a clean break over a
compatibility shim.

**Scope boundary, deliberately narrow — the CLI-facing presentation layer only** (same discipline
IFCE-005 used):

Touches: `CLI_COMMANDS.INIT` → `CLI_COMMANDS.INSTALL` (`"init"` → `"install"`) and its entries in
`CLI_COMMAND_DESCRIPTIONS`/`CLI_COMMAND_FLAGS` (`cli-commands.ts`), `cli.ts`'s `handleInit` →
`handleInstall` dispatch entry, `commands/init.ts` → `commands/install.ts` (`initCommand` →
`installCommand`), the `INIT_*` → `INSTALL_*` keys in `ui-messages.ts`, the user-guide page
(`user-guide/cli/init.md` → `install.md`, plus `cli.md`'s command table), this domain's own
[README.md](README.md) index table, and `AGENTS.md`/`CLAUDE.md`/`README.md`'s current
(non-historical) references to `docuvia init`, plus the associated unit/e2e test file names.

Does **not** touch: `InitWorkflow`, `INIT_EVENTS`/`INIT_MESSAGES`, `init-workflow.ts` and its
sibling files under `lib/ui-core/src/workflows/init/`, or `.docuvia/logs/init.log` — same reasoning
IFCE-005 used for `SyncWorkflow`/`sync.log` staying put under `publish`: internal vocabulary
describes the implementation to itself, not the word a user types, and a partial internal rename
would be noisier than a clean split between the two vocabularies.

**Explicitly out of scope**: historical/frozen documents that record what happened at a point in
time — `docs/cli-test-analysis/*` benchmark reports and any `roadmap-and-open-items.md` entry
already marked `Shipped`/`Fixed` — are not retroactively edited to say `install`; they correctly
describe `docuvia init` because that was its name when the event they describe happened.

## Consequences

- **Positive**: `install`/`uninstall` read as a pair on sight, matching the vocabulary the codebase
  already uses internally (`installHooks()`/`uninstallHooks()`). Removes the specific
  command-name-guessing failure reported from real agent/CLI usage.
- **Negative**: `install` is a rename of the single most-referenced, first-run command in the
  project — unlike `sync` (IFCE-005's rename target, described there as "unwired," called by no
  hook), `init` is the universal onboarding entry point. Blast radius is real: a rough grep at
  decision time found roughly 114 files referencing `docuvia init`/`CLI_COMMANDS.INIT`/
  `installHooks` across the repo (docs, tests, source); most of that is historical/test-fixture
  noise per the out-of-scope carve-out above, but the live-doc + source subset still needs a
  deliberate pass, not a blind find-and-replace across all 114.
- **Neutral**: Like IFCE-005, blast radius is confined to the CLI-facing rename — no hook, lock, or
  automation path changes behavior. Tier A/B/C's triggers (`analyze`, `snapshot`, pre-push) never
  call `init`, so none of [PLAT-007](../platform/PLAT-007-tiered-background-knowledge-evolution.md)'s
  automated flow is affected.

## Open follow-up

Exact file-by-file rename list and PR sequencing is implementation work, not part of this decision
— to be tracked as its own item when implementation starts. Separately, `init`'s own idempotency gap
(`init --platform=X` re-runs full ingestion instead of scoping down like `uninstall --platform=X`
does) was a related but distinct bug, tracked as
[roadmap item 35](../../analysis/roadmap-and-open-items.md) — **fixed 2026-08-15** (`InitWorkflow`
now detects an already-populated graph and skips discovery/parse/persist/pack on repeat `init`
calls); no longer blocks this rename from proceeding.
