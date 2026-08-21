# Roadmap & Open Items

> **Purpose:** this is the single place for everything **not yet decided or shipped**. Everything
> that _has_ shipped lives in its governing ADR — [PLAT-007](../adr/platform/PLAT-007-tiered-background-knowledge-evolution.md)
> for the tiered background loop (Tiers A/B/C + `doctor` reliability), [IMPT-002](../adr/impact/IMPT-002-lsp-for-absolute-quality.md)
> for the LSP tri-layer and language coverage — not here. This file replaces the scattered
> Gemini deep-dive reports and the Phase 1 planning/decision trail that used to live under
> `docs/gitbook/analysis/`; those are retired once their content is captured below or in an ADR.
>
> Items are ordered roughly by priority/dependency, not by date. When one of these gets decided,
> move the decision into its governing ADR (or a new one) and delete the row here.

## Phase 2 — Distribute (items 1-3 decided & shipped)

L3 distribution (storage shape + merge strategy) is decided and shipped — see
[Phase 2, Item 1 — L3 Distribution Strategy](phase2-l3-distribution.md) for the full contract
(`L3DIST-001`..`008`) and implementation record (2026-07-21).

`sync-knowledge` scheduling and the remote-sync auto-push question are both resolved (one shipped,
one explicitly parked) — see
[Phase 2, Items 1-2 — sync-knowledge Scheduling & Remote-Sync Auto-Push](phase2-sync-knowledge-scheduling.md)
for the full contract (`SKSCHED-001`..`006`) and implementation record (2026-07-21).

### 3. `sync` vs `sync-knowledge` naming

> **Shipped — decided and implemented 2026-07-28. `sync` renamed to `publish`;
> `sync-knowledge` unchanged. See [IFCE-005](../adr/interface/IFCE-005-rename-sync-to-publish.md)
> for the decision and the (deliberately narrow) scope boundary.**

## Phase 3 — Consume (mostly working, minor follow-ups)

### 4. Surface L3 "why" data in `review`/`impact` output

> **Shipped — implemented and committed by automated roadmap sweep on 2026-07-28 (`492e93ba`).**

`review`/`impact` now attach each impacted node's L3 decisions/context to its blast-radius
results, showing _why_ a symbol changed alongside _what_ changed — the differentiator vs.
GitNexus-class tools this item was tracking.

### 5. Richer `export-topology`

> **Shipped — implemented and committed by automated roadmap sweep on 2026-07-28 (`949a65d8`).**

Node/link JSON now carries L2 type, decision content/confidence/validity/source commits, and edge
commit-sha/diff-summary, so `export-topology`'s existing interactive HTML viewer (in place since
2026-07-12, see [`cross-product-cli-benchmark.md`](cross-product-cli-benchmark.md) action item 5's
correction) can render a richer topology without a second query round-trip.

## Phase 4 — Agent Ergonomics & CLI Symmetry (2026-08-14 design session)

Seven items below (29-35) came out of one design-discussion session focused on reducing
agent-side friction when driving Docuvia: skill/MCP surface for read paths, output formats,
init-time Tier B/C options, an agent-authored L3 write path, and a fine-grained hook-lifecycle
command. Each item's direction is settled; several carry an explicit open sub-question that
wasn't resolved in that session and needs its own follow-up before implementation starts. The
related `init` → `install` naming rename is tracked separately as
[IFCE-006](../adr/interface/IFCE-006-rename-init-to-install.md) (status: proposed), not as a
roadmap item, per this project's convention of promoting a settled rename straight to ADR.

### 29. MCP read-path tools (`query`/`impact`/`context`) — resume the already-planned rebuild

Not new scope: [`artifacts/cli/src/mcp/tools/index.ts`](../../../artifacts/cli/src/mcp/tools/index.ts)'s
own comment already names `context`/`impact`/`query`/`analyze`/`extract`/`clean`/`status`/
`detectChanges`/`sync` as tools the pre-rewrite Docuvia had, with "register each new tool here as
it's rebuilt" as the stated plan. Currently only `docuvia_init` is registered. Motivation from this
session: the only way an agent currently calls Docuvia's read paths is
[`.claude/hooks/docuvia-hook.js`](../../../.claude/hooks/docuvia-hook.js) shelling out to
`npx --no-install docuvia query ...` on every `Grep`/`Glob`/`Bash`/`Read` call — a fresh CLI
process spawn per call. MCP tools would replace that with a structured call against a persistent
server. Scope: at minimum `query`/`impact`; `context` and the rest of the original list are
candidates, not committed.

### 30. `docuvia-*` skill set mirroring `gitnexus-*`, installed via `docuvia init`'s skill option

> **Shipped — 2026-08-21 (PR #176).** Four task-routed skill files shipped: `docuvia-exploring`,
> `docuvia-impact-analysis`, `docuvia-knowledge-graph`, `docuvia-agent-authored`. Installed via
> `docuvia init --skills` (opt-in), removed via `docuvia uninstall --skills` (symmetric). Templates
> in `artifacts/cli/src/constants/skill-templates.ts`, installer/uninstaller in
> `artifacts/cli/src/skills/install-skills.ts`. See [IFCE-007](../adr/interface/IFCE-007-docuvia-skill-set.md)
> for the full design decision.

Confirmed direction: task-routed skill files (in the shape of the user's existing
`gitnexus-exploring`/`gitnexus-impact-analysis`/etc. skill set) for Docuvia, so an agent gets
guided which command/format fits a given task instead of relying solely on the `AGENTS.md`/
`CLAUDE.md` prose mandate. Installation: an opt-in skill-list option on `docuvia init`, symmetric
removal via `docuvia uninstall` — not a fixed bundle baked into every `init` run, per the
self-installable/uninstallable requirement raised alongside item 34 below. Precedent this repo
already has for a project-local skill: [`.claude/skills/no-magic-strings/`](../../../.claude/skills/no-magic-strings).

Found alongside this and fixed in 2026-08-16 (issue #51): `.claude/hooks/docuvia-hook.js` used to
build its `npx --no-install docuvia query "${target}" --format=prompt` shell command via direct
string interpolation of `target` (`execSync`) — a real shell-injection exposure, separate from the
spawn-overhead concern above. It now passes `target` as a literal argv element through
`execFileSync` (with a Windows `npx.cmd` name resolution), and a committed gate test
(`artifacts/cli/test/unit/constants/docuvia-hook-js-injection-gate.unit.test.ts`) runs the real
script against a shell-breakout payload and asserts the live `.claude/hooks/docuvia-hook.js` stays
byte-identical to the `DOCUVIA_HOOK_JS` template.

### 31. `--format` gains `json`, extends beyond `query`

> **Shipped — 2026-08-18 (issue #52).** `--format` is now shared across `query`/`impact`/`review`
> via the single `CLI_OUTPUT_FORMATS` enum (`human`/`prompt`/`json`) in `cli-flags.ts`, with a
> fail-fast value gate (`resolveOutputFormat`) so a typo'd value can never silently degrade to the
> human renderer. `json` serializes each command's structured result verbatim to stdout
> (`LocalQueryResult` / `ImpactResult` / `ChangeDetectionResult`) with the banner/spinner
> suppressed; `impact` emits the JSON literal `null` (exit 0) when the target doesn't resolve. The
> JSON shapes are deliberately the un-reshaped API result objects so they double as the contract
> for item 29's MCP tools and item 30's skill files (now shipped, see IFCE-007).

Currently `--format` exists only on `query` (`QUERY_OUTPUT_FORMATS`: `human`/`prompt` —
[`cli-flags.ts`](../../../artifacts/cli/src/constants/cli-flags.ts)); `impact`/`review` have no
`--format` at all. Confirmed direction: add a `json` value to the shared enum, and extend
`--format` support to `impact`/`review` reusing that same enum rather than each command inventing
its own flag. Tied to item 29: MCP tools return structured data natively, so `--format=json`
mainly serves the Bash-fallback path and non-MCP platforms; which format an agent should reach for
in which situation is expected to live in item 30's skill files (now shipped, see IFCE-007).

### 32. `init` gains an opt-in Tier B/C escalation option — resolved via the same agent-authored backfill mechanism as item 33

> **Shipped — 2026-08-15 (via item 33's write path; no separate mechanism was built for this item
> specifically).** As the "Resolved" paragraph below already concluded, `init` needed no bespoke
> seed/backfill logic of its own — item 33's `analyze <targetPath> --agent-authored` write path
> (now shipped, see item 33's own banner) supplies exactly the continuous backfill, starting from
> the first post-`init` commit and onward, this item was asking for. The one gap it doesn't close —
> pre-existing code no agent has ever touched — has no LLM-inferred rationale and, per issue #58,
> this is **by design, not a bug**: the previously-claimed "push-time LLM-inference fallback" for
> that history does not exist (full ingestion enqueues no Tier C candidates, and the design intent
> is that an agent's rationale is injected while it is writing the code, not re-inferred from a
> diff later). What issue #58 did fix is the automatic trigger itself — the post-commit hook now
> backgrounds with `nohup` + a log-file redirect so its delta ingestion and `--flush-staged-l3`
> drain actually survive the hook shell's exit, with doctor's `post_commit_ingestion` check and
> `status`'s Tier C queue metric making a dead pipeline visible (see issue #58).

`init` already queues every parsed file for Tier B ([`init.md`](../user-guide/cli/init.md) step
3); Tier B/C's stage-then-finalize design already gives resumability. Confirmed direction: an
opt-in flag on `init` (reusing `analyze`'s existing `--escalate-to-lsp` name rather than inventing
a new one, per this project's own command-convergence test) to drain Tier B immediately at init
time instead of waiting for the first push, with a loop-until-drained runner bounded by a
wall-clock cap for large repos (a single 120s batch won't clear a vscode-scale queue).

**Resolved (2026-08-15), superseding the "candidate approaches" originally listed here**: the two
heuristics first proposed — recent-N-commits backfill vs. no-L3-coverage-first file selection —
were solving the wrong problem. They assumed Tier C needed to _pick_ which history to re-infer
over. In practice, code written after `init` is almost always authored by an AI coding agent that
has already read and analyzed the part it's changing before that change ever reaches commit — true
both for the first commits right after a fresh `init` (no Tier C data yet) and for every ordinary
commit afterward in steady-state development. Nothing needs re-inferring; the missing piece was
always a **backfill path** for analysis the agent already produced, not a new analysis pass. That
is exactly item 33's `source='agent-authored'` write path below — so 32 doesn't need its own seed
mechanism. It needs item 33's write path to fire from the first post-`init` commit onward,
continuously, not just once. This also matches Docuvia's core design principle of accumulating the
graph incrementally over time rather than recomputing it in batches — the same rationale behind
the Tier A/B/C split itself.

The one case this doesn't cover: code that has _never_ been touched by an agent-authored commit
(pre-existing code nobody has revisited since). That has no recorded rationale — and **corrected
2026-08-16 (issue #58)**: this paragraph's earlier claim that such code "falls to Tier C's
heavier, push-time LLM-inference fallback" was wrong. Full ingestion (`init`/empty-graph `analyze`)
enqueues zero Tier C candidates, so LLM-inferred Tier C only ever covers code touched by a
post-`init` commit (via delta ingestion). That is consistent with the design intent above —
rationale for pre-existing code is injected by the agent when it touches it, not re-inferred from
a diff — and the issue's fix was to make the automatic trigger (post-commit hook) reliable and
its failure visible, not to add a whole-history LLM re-inference pass.

### 33. Agent-authored L3 write path — new Tier C provenance, write surface confirmed

> **Shipped — 2026-08-15.** `analyze <targetPath> --agent-authored` persists agent-supplied
> decisions verbatim (no LLM call) with `source='agent-authored'` in `l3_nodes`, alongside the
> pre-existing default `source='analyze'` — see `L3DecisionSources` in
> [`graph-store.interfaces.ts`](../../../lib/contracts/src/interfaces/graph-store.interfaces.ts).
> The payload (`{"decisions":[{"title","content","nodeType","confidence"}]}`) is read from stdin by
> default or from `--decisions-file=<path>` — see
> [`analyze.ts`](../../../artifacts/cli/src/commands/analyze.ts).
>
> **`commit-l3-write` (item 34) shipped as a stage-then-flush mechanism — correcting this item's
> own original framing.** Earlier wording here (and the broader PostToolUse-hook framing this
> roadmap floated) reads as if a per-edit `PostToolUse` hook might fire the write. That was
> explicitly rejected by the human owner in a round-2 design decision the same day ("triggering
> every time isn't good, not recommended" — too noisy) in favor of a plain git hook: one write per
> commit covers a whole commit's rationale at once rather than a fragment per edit, and works for
> every platform that runs `git commit`, not just the two with a hook-execution mechanism.
> `analyze <file> --agent-authored --stage` appends to a local staging file,
> `.docuvia/pending-l3-decisions.json` — no DB open, no LLM call — see
> [`pending-l3-decisions-store.ts`](../../../lib/ui-core/src/workflows/analyze/pending-l3-decisions-store.ts).
> A new post-commit hook step, `docuvia analyze --flush-staged-l3` (see
> [`run-flush-staged-l3.ts`](../../../lib/ui-core/src/workflows/analyze/run-flush-staged-l3.ts) and
> `POST_COMMIT_HOOK_CONTENT` in
> [`git-constants.ts`](../../../lib/core/src/git/git-constants.ts)), then drains only the staged
> entries whose file is in _that_ commit's changed-file list into `l3_nodes`, tagged with the real
> commit sha — everything else stays staged for a later commit to pick up. The prose mandate
> driving `--stage` (no technical trigger exists otherwise) lives in `AGENTS.md`/`CLAUDE.md`/
> `.github/copilot-instructions.md`, next to each file's existing Docuvia-First read-path section.

Confirmed direction: let the agent that just made a code change write its own rationale directly
into `l3_nodes` (`source='agent-authored'` provenance, alongside the existing `source='llm-inferred'`
merge pattern Tier B's Provider 2 section above already defines) instead of relying only on Tier
C's async LLM-inference-from-diff path. Because this path starts no LSP/LLM call — it is a pure
data write of content the agent already has — it is cheap enough to fire at commit time without
violating Tier A's "structurally forbidden from starting LSP/LLM work" rule (this file's Tier A
section, item 4); the existing LLM-inferred Tier C stays as the heavier, push-time fallback for
changes with no agent-recorded rationale.

**Write surface confirmed (2026-08-14)**: converges into the existing `analyze <targetPath>`
command (already documented as "focused LLM decision extraction ... persisted to `l3_nodes`" —
this just adds who is allowed to author the content) rather than a new verb, per the project's
command-convergence principle. Not yet implemented.

**Relationship to item 32**: this write path is what item 32's init-time and steady-state backfill both resolve to — not a separate mechanism. See item 32's update above.

### 34. `docuvia hooks list/enable/disable` — per-behavior hook lifecycle management

> **Shipped — 2026-08-15.** `docuvia hooks list/enable/disable/check` ships — see
> [`hooks.ts`](../../../artifacts/cli/src/commands/hooks.ts) and the full command reference,
> [`hooks.md`](../user-guide/cli/hooks.md). Three toggleable behaviors — `context-injection`,
> `commit-l3-write`, `tier-b-c-prepush` — all default-enabled, see `DEFAULT_HOOKS_CONFIG` in
> [`hooks.interfaces.ts`](../../../lib/contracts/src/interfaces/hooks.interfaces.ts). Persistence is
> a flat `.docuvia/hooks-config.json`, not a `docuvia_meta` row: the two raw, dependency-free
> platform hook scripts can't open SQLite without spawning a second `npx` process per call, which
> would be a real, continuous latency cost at `context-injection`'s per-tool-call frequency.
> `check <name>` is the internal/scripted verb the
> `tier-b-c-prepush` pre-push `&&` chain and the post-commit flush step use to gate themselves — see
> [`hooks.md`](../user-guide/cli/hooks.md) for its exit-code contract. The "Open, deliberately
> deferred" skill-file-installation question below is unaffected by this shipment and stays open.

Confirmed direction, in response to real usage feedback that pre-push-triggered Tier B/C work
feels too slow/blocking for an agent's workflow: a new `docuvia hooks` subcommand managing at
least three independently-toggleable hook behaviors — `context-injection` (item 29/30's
PreToolUse-style context hook), `commit-l3-write` (item 33's new lightweight commit-time write),
and `tier-b-c-prepush` (the existing pre-push Tier B/C batch, gaining a name and an explicit on/off
switch it doesn't have today). `init`/`uninstall` keep owning "install/remove everything for
platform X"; `docuvia hooks` owns fine-grained enablement after the fact.

**Relationship to items 32/33's backfill resolution**: `commit-l3-write` is the mechanism items 32
and 33 resolve to — matching Docuvia's incremental-accumulation philosophy, it defaults to
**enabled**, not merely available. It stays a toggle like every other hook in this list, not a
forced-on behavior: once `docuvia hooks` ships (alongside IFCE-006's `install` rename), a user can
run `docuvia hooks disable commit-l3-write` to opt out of the Tier C backfill entirely if they
don't want it.

**Resolved (2026-08-21, PR #176)**: skill files live under `init --skills`/`uninstall --skills`
(see [IFCE-007](../adr/interface/IFCE-007-docuvia-skill-set.md)), not under `docuvia hooks` —
skills are static file drops, not runtime hook registrations, so they don't share a management
surface with the hook lifecycle commands. This was the originally-intended separation; the
"deliberately deferred" note was waiting for IFCE-006's `init` → `install` rename to land before
deciding, but the implementation confirmed the separation is correct as-is.

### 35. `init --platform=X` isn't actually scoped the way `uninstall --platform=X` is

> **Fixed 2026-08-15.** `InitWorkflow.execute()`
> ([`init-workflow.ts`](../../../lib/ui-core/src/workflows/init/init-workflow.ts)) now detects an
> already-populated graph — a project row plus `l2Nodes > 0`, the same test
> `analyze-workflow.ts`'s `dispatchAutoMode()` already uses for its own empty-graph check, inverted
> — right after opening the store, and returns immediately via a new `buildSkippedInitResult()`,
> skipping discovery/parse/persist/pack entirely. Verified live: `docuvia init` run twice against a
> real repo — first run did full ingestion in ~2s, second run took ~540ms and left `local.db` and
> the knowledge-branch SHA completely unchanged. The fix applies to **any** repeat `docuvia init` on
> an already-initialized workspace, not just `--platform=`-scoped calls — `InitWorkflow` never sees
> that flag at all (`--platform=` only ever reaches `configureAgentIntegrations`, a separate,
> already-correctly-scoped call in `init.ts`). `init --force` was deliberately **not** added — a
> considered recommendation, not an oversight: `docuvia analyze` (incremental) and `docuvia clean` +
> `docuvia init` (full wipe) already cover "I want a real refresh," and this project favors an
> existing command over a new flag when the essence is the same. Full detail:
> [`implement_init-platform-scoping-fix.md`](../../ai_plans/implement_init-platform-scoping-fix.md).

Verified in [`lib/ui-core/src/workflows/init/init-workflow.ts`](../../../lib/ui-core/src/workflows/init/init-workflow.ts):
`execute()` always runs the full discovery → parse → persist sequence regardless of whether
`.docuvia/`/`local.db` already exist — there is no branch that detects an already-initialized
workspace and skips straight to installing just the requested platform's integration files.
`uninstall --platform=X`, by contrast, is genuinely scoped (touches only that platform's files,
leaves the DB and other platforms alone). Running `docuvia init --platform=cursor` a second time
on an already-set-up repo currently re-does full ingestion as a side effect of what should be a
light "add one more platform" operation.

Confirmed as a real gap; fix direction (not yet fully speced): `init` should detect an existing
graph and skip discovery/parse/persist, reducing a repeat `--platform=` call to the same weight as
its `uninstall` counterpart. Related to, but independent of, the `init` → `install` rename
([IFCE-006](../adr/interface/IFCE-006-rename-init-to-install.md)) — this is a behavior fix, that
was a naming fix.

**Sequencing (2026-08-15)**: fix this before IFCE-006's `init` → `install` rename ships. Landing
the renamed `install` command while it still carries this scoping bug just moves the bug to a new
name instead of fixing it — the behavior fix should land first, then the rename.

## Known open technical items (small, tracked, unowned)

### 8. Race C — `query` (foreground read) vs. `analyze` (background write)

> **Shipped — implemented and committed by automated roadmap sweep on 2026-07-28 (`23aebb42`).**

This was the one scenario in the concurrency lock matrix below without a gating test (unlike
`analyze`+`snapshot`/`doctor`+`hydrate`, gated since Slice 2). `query-analyze-concurrency.test.ts`
now closes that gap directly — exercising real concurrent CLI processes and asserting well-formed,
non-torn output plus `local.db` integrity, rather than relying on WAL's non-blocking behavior as an
unverified given.

Reference — core workflow lock matrix (kept for context, not re-verified line-by-line against
every workflow; treat as a design reference, not a test oracle):

| Workflow           | DB Lock                  | Knowledge Branch Lock  | Notes                             |
| ------------------ | ------------------------ | ---------------------- | --------------------------------- |
| `init`             | 🔴 WriteLock (IMMEDIATE) | ❌ none                | migrations uninterrupted          |
| `analyze` (Tier A) | 🔴 WriteLock (IMMEDIATE) | ❌ none                | incremental L2/L3 write, no git   |
| `snapshot`         | 🟢 ReadLock (shared)     | 🔴 KnowledgeBranchLock | protects temp dir & branch writes |
| `sync-knowledge`   | ❌ none                  | 🔴 KnowledgeBranchLock | push/pull knowledge branch        |
| `hydrate`          | 🔴 WriteLock (IMMEDIATE) | ❌ none                | batch L2 rebuild                  |
| `doctor`           | 🟢 ReadLock (shared)     | ❌ none                | read-only                         |

### 9. Embedded in-process LLM model

Deferred, not built. Both Tier B's edge-resolution provider seam and Tier C's endpoint decision
(PLAT-007) name this as a future option, never scheduled. **Concrete, measured re-entry trigger**
(not speculative): (a) Tier B degradation JSONL lines show LSP-absent/timeout on ≥25% of batches
over a sustained real-usage window, or (b) Tier C's daily budget is measurably exhausted by
routine extraction volume such that per-file compensation through the CLIProxyAPI bridge is
demonstrably unaffordable. Neither number exists yet — this stays parked until one does.

### 10. `tierBQueue` staleness/eviction policy

Deferred — the "infinitely growing backlog" premise is overstated (the queue is already deduped by
file and bounded by repo file count). The one cheap addition already shipped: queue size is logged
in Tier B's JSONL batch-summary line, so a future eviction decision (if ever needed) will be
data-driven rather than speculative.

> **Rechecked 2026-07-28** — `filesQueued` is still emitted on every `analyze.tier_b.summary` JSONL
> line (`run-tier-b-batch.ts`'s `finalizeBatch`). No growth signal has shown up in it; policy stays
> deferred, no code change warranted.

### 11. Hydrate-then-delta optimization

> **Shipped — implemented and committed by automated roadmap sweep on 2026-07-28 (`f2f44d30`).**

An empty `local.db` next to an already-populated knowledge branch no longer triggers a full
re-parse of HEAD. It now resolves the hydration commit and its paired `Docuvia-Source` sha first
and delta-ingests from there, falling back to the original full-ingestion path whenever either half
of that pairing can't be resolved.

### 13. Dirty-index hash edge

Delta ingestion takes blob hashes from the git index but reads content at `headSha`; a dirty index
can mismatch the `files` dedup table. Confirmed harmless today (Tier B never calls the same code
path — `collectFilesToParse` is Tier A only), but worth rechecking if either tier's design changes.

> **Rechecked 2026-07-28** — `collectFilesToParse` (`run-delta-ingestion.ts`) still has exactly one
> call site (Tier A's delta ingestion); `listTrackedFilesWithBlobHash` still hashes off the git
> index while content comes from `headSha`, so the mismatch is real but still unreachable from
> Tier B. Neither tier's design has changed since the original note — still harmless, no code
> change.

### 14. `getChangedFilesSince` asymmetry footgun

No-arg mode merges in untracked files; an explicit `baseRef` (even `"HEAD"`) does not. Documented
and pinned by integration tests today, but an easy trap for a future call site that doesn't know
the asymmetry exists.

> **Rechecked 2026-07-28** — the `if (!baseRef && !toRef)` branch in `getChangedFilesSince`
> (`git-local-provider.ts`) and its regression test ("single-ref legacy mode ... regression guard"
> in `git-local-provider.integration.test.ts`) are both still in place, and no new call sites have
> been added since. The asymmetry is intentional design, not a bug — documented + tested is its
> correct terminal state, nothing to fix.

### 15. Degraded batch still advances `lastTierBBatchSha`

A fully-degraded Tier B batch (LSP absent) still seeds/advances the commit-cap baseline at the
next snapshot, even though its queued entries stay unprocessed. Harmless today (pre-push runs
regardless of the cap), but interacts with any future "rebuild the queue from `lastTierBBatchSha`"
recovery story.

> **Rechecked 2026-07-28** — confirmed still true and still harmless: `isTierBCommitCapExceeded`
> (now driven by the `tierBChangedBytes` accumulator, §9m item 1) only feeds two advisory surfaces
> — `analyze`'s one-line nudge and `doctor`'s always-`PASS` diagnostic message — neither `publish`
> nor any other workflow gates on it. A degraded batch's `finalizePendingTierBBatch` still
> unconditionally zeroes the accumulator, but with nothing blocking on the cap this stays
> informational-only drift, no code change.

### 16. Tier B "file exists" check is working-tree, not HEAD

Implemented as an exists-in-working-tree check rather than exists-at-HEAD, since the LSP session
reads live files off disk. Consistent with item 13 above; not a bug, just worth remembering if
Tier B ever operates against something other than the live working tree.

> **Rechecked 2026-07-28** — still exactly as documented: `dispatchQueue` in `run-tier-b-batch.ts`
> checks `fs.existsSync` against the working tree, with the assumption already spelled out in its
> own doc comment. No change needed.

### 17. Go Tier B (LSP escalation) is effectively non-functional — `references` resolution fails near-universally against gopls

> **Fixed 2026-08-04.** `initializeSession` (`lsp-edge-provider-base.ts`) sent a completely empty
> `capabilities: {}` on `initialize` — confirmed live against a real gopls v0.23.0 that without
> `textDocument.documentSymbol.hierarchicalDocumentSymbolSupport: true` declared, it answers
> `documentSymbol` with the flat `SymbolInformation` shape, whose `location.range.start` is a
> declaration's start (e.g. the `func` keyword) rather than its identifier's — every `references`
> lookup at that position fails with gopls's own `"no identifier found"`. Fixed by declaring the
> capability (base-class-level, one line, every language benefits). Reverified against the exact
> `gin` batch this item describes: **92/98 files processed, 804 corrected edges applied** (was
> 3/98, 0 edges) — the remaining 6 are the separate, already-documented build-tag/timeout gaps
> below, not this bug. `GRPH-006`'s `supportsQualifiedContainment` question (last paragraph below)
> is still open and unaffected by this fix.

Found 2026-08-03 during the Go CLI benchmark pass (full detail:
[`go-cli-benchmark.md`](../../cli-test-analysis/go-cli-benchmark.md) §3.1/§1.2, summary in
[`README.md`](../../cli-test-analysis/README.md) §3.3 item 1). `docuvia analyze --escalate-to-lsp`
against `gin-gonic/gin` — with `doctor` confirming `lsp_binary_go: PASS` (gopls resolved and
reachable) — processed its 98-file Tier B queue and failed **95 of them**: 2 timed out during
gopls's initial workspace load, and ~93 returned gopls's own `"no identifier found"` error within
milliseconds of each other. Only 3/98 files processed, 0 corrected edges applied — the batch ran
for ~128s and produced strictly nothing.

**Traced to** [`lsp-edge-provider-base.ts:663-669`](../../../lib/core/src/lsp/lsp-edge-provider-base.ts):
`textDocument/references` is requested at `symbol.selectionRange.start`, where `symbol` comes from
`textDocument/documentSymbol`'s response for the file. The near-universal, near-instant, identical
error text across almost every symbol in almost every file (not a handful of edge cases) points at
a systemic position/response-shape mismatch specific to how gopls's Go `documentSymbol` responses
are structured or interpreted here — **not yet root-caused past this point.** Next step: log gopls's
raw `documentSymbol` response for one real `gin` file and diff it against what
`containsPosition`/`symbol.selectionRange` in the base provider expect.

Distinct from item 16 above and from the pre-existing `GRPH-006` `supportsQualifiedContainment`
gap on `GoLspEdgeProvider` (which never even became observable in this run — this bug sits upstream
of it, since `references` fails before containment shape would matter). Every other language's Tier
B provider shares the same `lsp-edge-provider-base.ts` code path, so this may be Go-specific (gopls
response shape) or may be a latent bug other languages happen not to trigger — not yet determined
which.

**Status: fixed 2026-08-04** (see the note at the top of this item) — was: not fixed, silently
returning a 0-edge "success" rather than surfacing that nothing usable was extracted.

### 18. Git-knowledge-branch pack-step crash (`Error: write EOF`) on large repos

> **Fixed 2026-08-04.** Two independent bugs, one masking the other — full detail in
> [`go-cli-benchmark.md`](../../cli-test-analysis/go-cli-benchmark.md) §1.1's addendum. (1) The
> real failure: a symbol/file name colliding with a Windows-reserved device name (`Aux`, `con`,
> `nul`, ...) renders to a git tree path (`knowledge/.../Aux.md`) that `git fast-import` itself
> refuses (`fatal: invalid path`, git's own cross-platform `core.protectNTFS` guard, on by default
> on every OS) — real repro was moby's `pkg/progress.Aux` (Docker's `JSONMessage.Aux` field). (2)
> Why it crashed instead of failing cleanly: `runFastImport` (`fast-import.ts`) had an `"error"`
> listener on `child` but never on `child.stdin` — a distinct `EventEmitter`. When git aborted
> mid-stream, the in-flight stdin write failed and, unhandled, threw as an uncaught exception,
> crashing the whole process before git's real stderr message ever surfaced — which is why two
> separate benchmark passes (`vscode` and `moby`) saw only a bare pipe error with no visible cause.
> Fixed: `sanitizeSegment` (`snapshot-renderer.service.ts` + its mirrored copy in
> `l3-card-renderer.ts`) now mangles reserved-device-name segments; `runFastImport` now handles the
> `child.stdin` error gracefully so any future fast-import rejection surfaces as a normal
> `DocuviaError` instead of crashing. Reverified against this session's own leftover `moby`
> database (136,329 nodes / 157,139 edges) — packs successfully, no crash.
>
> First seen 2026-07-29 (TypeScript pass, `vscode`, 288,726 nodes) as follow-up work item 1; second
> reproduction 2026-08-03 (Go pass, `moby`, 136,329 nodes) is what finally supplied the real,
> reproducible trigger.

### 19. Go same-package, no-import cross-file `calls` edges are never persisted — `ScopeResolver.resolveCall()` has no Go-package-aware branch

> **Fixed 2026-08-06.** Added a directory-scoped fallback branch to `ScopeResolver.resolveCall()`
> ([`scope-resolver.ts`](../../../lib/core/src/graph/scope-resolver.ts)): a new
> `goFilesByDirectory` index (populated in `registerFile`) lets an unresolved call from a `.go`
> source fall back to checking same-directory sibling `.go` files' locals, mirroring Go's real
> directory-scoped package visibility (no import needed). Deliberate approximation: directory
> equality stands in for "same package," not a real `package`-declaration comparison — an external
> test package (`package foo_test` in a `_test.go` file sharing the directory) would be mismatched,
> but internal test packages (`package foo`) are the overwhelmingly common convention, and
> Docuvia2 doesn't persist per-file package names today; recorded as an accepted imprecision, not
> chased further. Verified: the previously-pinned regression test in
> `persist-ast-graph.unit.test.ts` (was titled `"KNOWN GAP: a same-package, no-import Go cross-file
call is never persisted as a 'calls' link"`) now asserts the `calls` link IS persisted, and
> passes. Two new unit tests in `scope-resolver.unit.test.ts` cover the positive Go case and a
> negative TS/JS case proving the fallback is strictly gated on the `.go` extension — no behavior
> change for other languages. Full `lib/core` suite: 389/389 passing, independently re-verified by
> `task-verifier`. Known minor gap, non-blocking: if two sibling `.go` files declare the
> same-named symbol (e.g. two build-tag-gated variants — legal Go), resolution is deterministic
> (first-registered wins) but arbitrary (no build-tag/GOOS/GOARCH awareness); unlike the
> `_test`-package caveat above, this one isn't yet noted inline in the new code — flagged here as a
> candidate follow-up, not fixed. Aside: `docuvia impact` on `scope-resolver.ts` returned "No
> dependents found" this session despite the file clearly being used elsewhere — a known gap in the
> impact tool's own dependency tracking, not evidence this file is dead code.

Found 2026-08-04 while investigating a topology-collapse symptom flagged in the Go benchmark pass
(full detail: [`go-cli-benchmark.md`](../../cli-test-analysis/go-cli-benchmark.md) §1.5, summary in
[`README.md`](../../cli-test-analysis/README.md) §3.3 item 7): `moby`'s `export-topology
--collapse=auto` degenerating to `"Links: 1"` was suspected to be a topology-folding bug. A real
bug _was_ found and fixed there — [`topology-builder.service.ts`](../../../lib/core/src/topology/topology-builder.service.ts)'s
`buildCollapsed` resolved a link endpoint's owning file via a single-hop `containingFileId` lookup,
silently dropping the link for a 2+-level `CONTAINS` chain (e.g. `file → class → method`); `toFileId`
now walks the full ancestor chain, with a cycle guard, regression-tested — but that fix is defensive
correctness, not the cause of `moby`'s own number.

**Traced to** [`scope-resolver.ts`](../../../lib/core/src/graph/scope-resolver.ts):
`ScopeResolver.resolveCall()` only resolves (1) a same-file local, or (2) an explicitly-`import`ed
name via JS/TS-shaped module-path resolution (`resolveModulePath`) — no branch exists for Go's
idiomatic same-package, no-import cross-file call convention. Live-verified via real AST parsing +
persistence against a synthetic 2-file Go fixture (`a.go: func Foo(){}` / `b.go: func Bar(){
Foo() }`, no import): the AST layer correctly _extracts_ the `Bar → Foo` call site
(`sourceFunction: "Bar", targetFunction: "Foo"` in `buildParseResponse`'s output), but `resolveCall`
returns `null` and `linkSymbolReference()` never inserts the `calls` row into `node_links` at all.
Locked in as a permanent regression-documenting test:
`persist-ast-graph.unit.test.ts`'s `"KNOWN GAP: a same-package, no-import Go cross-file call is
never persisted as a 'calls' link"`.

**Blast radius wider than the topology view alone**: since these edges are never written to the
graph in the first place (not folded away by any downstream heuristic — never persisted to begin
with), this also thins out `query`/`impact` results for Go same-package calls, anywhere Go code
calls a sibling-file, same-package function/method without an explicit import. `moby`'s
`export-topology --collapse=auto` `"Links: 1"` symptom is expected to still reproduce essentially
unchanged for this reason — not re-tested this pass, no updated number claimed.

**Status: fixed 2026-08-06** (see the note at the top of this item).

### 20. TypeScript `abstract class` declarations were never extracted into the knowledge graph

> **Fixed 2026-08-05.** `export abstract class Foo {}` parses as tree-sitter's own distinct
> `abstract_class_declaration` grammar node — not a modifier flag on `class_declaration` — and
> [`typescriptConfig`](../../../lib/plugins-ast/src/languages/typescript.ts)'s `classes` fallback
> array and compiled `queries.classes` string enumerated only `class_declaration`/
> `interface_declaration`/`enum_declaration`/`type_alias_declaration`; `abstract_class_declaration`
> was referenced nowhere else in the codebase. Every `export abstract class` in any TS/TSX file, in
> any repo Docuvia2 indexes, was silently missing from the knowledge graph entirely — not
> mis-ranked, not folded away, never a node. Confirmed live: direct SQLite inspection of a
> freshly-built `vscode` `local.db` showed zero node named `Disposable` for
> `src/vs/base/common/lifecycle.ts`, even though every other class in that file (123 nodes total)
> extracted correctly. Fixed by adding `ABSTRACT_CLASS_DECLARATION: "abstract_class_declaration"`
> ([`tree-sitter-node-types.ts:17`](../../../lib/plugins-ast/src/constants/tree-sitter-node-types.ts))
> and wiring it into both the `classes` fallback array and the compiled query in
> [`typescript.ts`](../../../lib/plugins-ast/src/languages/typescript.ts), mirroring
> `CLASS_DECLARATION`'s existing pattern. New regression test in
> [`ast-worker.fixture.unit.test.ts:485-519`](../../../lib/core/src/ast/ast-worker.fixture.unit.test.ts),
> verified via actual revert-and-rerun by both the implementer and, independently, `task-verifier`.
> Retroactively reframes every prior "`Disposable` resolves to the wrong node" finding in
> `typescript-cli-benchmark.md` (its §1/§4/§6.2) — the real class was never a resolution candidate
> to begin with, so that doc's already-shipped `findNodeByName` ranking fix (its §5.4) alone could
> never have found it. Only TypeScript was fixed/verified this pass — whether other languages'
> own `abstract class` grammar shapes share an analogous gap is unverified, flagged as a candidate
> follow-up, not assumed broken.

Found 2026-08-05 during a `vscode` re-verification pass — full detail in
[`typescript-cli-benchmark.md`](../../cli-test-analysis/typescript-cli-benchmark.md) §8.1, summary
in [`README.md`](../../cli-test-analysis/README.md) §3.2 item 6.

**Status: fixed 2026-08-05** (see the note at the top of this item) — was: not fixed, every
`abstract class` in any TypeScript repo silently absent from the graph with no error or warning.

### 21. Failed git-knowledge-branch pack + the very next ordinary read command silently destroys the whole local graph

> **Fixed 2026-08-05.** The single most severe bug found across this entire benchmark series —
> worse than item 18's crash above (at least a crash is visible) and worse than
> [`typescript-cli-benchmark.md`](../../cli-test-analysis/typescript-cli-benchmark.md) §6.3's
> already-fixed backward-`HEAD` delta-ingestion bug (which needed a deliberate `git reset --soft`):
> this one needs nothing unusual at all — an ordinary `init` on a large repo, one environmental
> hiccup in a best-effort background step, then one ordinary `status` call, and the entire graph is
> gone with no warning. Fixed via a 3-layer guard that respects the existing "git branch is the
> durable source of truth, `local.db` is an ephemeral rebuildable cache" architecture
> ([STOR-001](../adr/storage/STOR-001-git-branch-source-of-truth.md)/
> [STOR-002](../adr/storage/STOR-002-sqlite-ephemeral-query-engine.md)) rather than contradicting
> it: (1) a same-workspace "pending knowledge-branch write" meta flag
> (`META_KEY_KNOWLEDGE_PACK_PENDING`,
> [`git-constants.ts:118`](../../../lib/core/src/git/git-constants.ts)) set/cleared around the pack
> call ([`pack-current-graph.ts:52,58`](../../../lib/ui-core/src/workflows/snapshot/pack-current-graph.ts)),
> checked by `hydrate()`'s new `checkDestructiveRebuildGuard`
> ([`hydration.service.ts:215`](../../../lib/core/src/git/hydration.service.ts)) before rebuilding;
> (2) a magnitude-based catastrophic-shrink guard inside the same method as a cause-agnostic safety
> net (refuses when incoming data would represent a drastic drop from current, above a node-count
> floor); (3) `markSynced()` reordered to run _after_, not before, the pack attempt in both
> [`init-workflow.ts:174`](../../../lib/ui-core/src/workflows/init/init-workflow.ts) and
> [`run-full-ingestion.ts:112`](../../../lib/ui-core/src/workflows/analyze/run-full-ingestion.ts) —
> a second, independent contributing bug found while building this fix, where even a _successful_
> pack could leave the next read command seeing a false staleness mismatch; plus (4) a new `docuvia
hydrate --force`/`-f` escape hatch ([`cli.ts:173-175`](../../../artifacts/cli/src/cli.ts)) for when
> a destructive rebuild is genuinely wanted. A related bug surfaced while building this fix's own
> real-repo integration test: `SnapshotWorkflow` opened its store `readonly: true`, which would have
> thrown the moment the new pending-flag write tried to run during a real `snapshot` — fixed
> alongside (`readonly: false`, renamed `openStoreForSnapshot`,
> [`snapshot-workflow.ts:39-44`](../../../lib/ui-core/src/workflows/snapshot/snapshot-workflow.ts)),
> verified safe against both existing concurrency-gate integration tests
> (`analyze-snapshot-concurrency.test.ts`, `doctor-hydrate-concurrency.test.ts`).

Found 2026-08-05 during a `vscode` re-verification pass — full detail in
[`typescript-cli-benchmark.md`](../../cli-test-analysis/typescript-cli-benchmark.md) §8.2, summary
in [`README.md`](../../cli-test-analysis/README.md) §3.2 item 6: `docuvia init` against `vscode`
succeeded — Tier A ingestion completed, `local.db` had 292,770 L2 nodes / 379,776 edges (confirmed
via direct SQLite query) — but the git-knowledge-branch pack step at the end of `init` failed
(`git fast-import` exited with Windows `STATUS_DLL_INIT_FAILED`/`0xC0000142`, plausibly
environmental, not confirmed root-caused further); `init` still reported success (the pack failure
is designed to be non-fatal). Running two completely ordinary read commands afterward — `docuvia
status`, `docuvia query "Disposable"` — silently wiped `local.db` back to 0 nodes / 0 edges,
confirmed via direct SQLite query before and after.

**Traced to** every read-path command calling `ensureHydrated()`
([`ensure-hydrated.ts:20`](../../../lib/ui-core/src/utils/ensure-hydrated.ts)), which calls
`HydrationService.isStale()`
([`hydration.service.ts:238`](../../../lib/core/src/git/hydration.service.ts)) — a bare sha
comparison between `local.db`'s recorded last-synced knowledge-branch tip and the branch's actual
current tip. Since the pack failed, the branch never advanced, so this read as "stale," triggering
`hydrate()` — explicitly documented in-code as "rebuild-not-upsert, per STOR-002" — which reads
whatever the (unchanged, pre-pack-attempt) git branch has and unconditionally replaced `local.db`'s
graph tables via `bulkLoadGraph()`. Since that branch had zero committed graph data for this
workspace (the only pack attempt failed), the "rebuild" replaced 292,770 real nodes with 0.

Verified: new integration test
([`hydrate-pack-failure-data-loss-guard.integration.test.ts`](../../../artifacts/cli/test/integration/hydrate-pack-failure-data-loss-guard.integration.test.ts))
using a real temp git repo/`GraphStore`/`GitLocalProvider` reproduces the exact bug mechanics and
asserts node count is preserved. Independently re-verified by `task-verifier`, which also
independently confirmed the guard is load-bearing (bypassing it via the sanctioned `force: true`
path reproduced the original 100%-data-loss failure exactly). Full workspace: 160 test files / 1167
tests passing. One non-blocking gap noted by `task-verifier`: the CLI-level `--force` flag itself
and the "refused" message path have no dedicated test (the underlying logic is tested one layer
down) — worth a follow-up.

**Status: fixed 2026-08-05** (see the note at the top of this item) — was: not fixed, an ordinary
`init` + one background-step environmental hiccup + one ordinary read command could silently
destroy an entire local knowledge graph with no warning surfaced to the user.

### 22. `docuvia query`'s keyword search can't substitute for Read/Grep/Glob during exploratory work

> **Shipped — 2026-08-05.** `query`/`impact` results now carry a `matchType: "exact" | "keyword" |
"neighbor"` field, surfaced as `match_type="..."` in `--format=prompt` XML and a human-readable
> hint in CLI output (`lib/contracts/src/interfaces/query.interfaces.ts`,
> `lib/core/src/query/query.service.ts`, `artifacts/cli/src/commands/query.ts`). AGENTS.md/CLAUDE.md/
> `.github/copilot-instructions.md` (and their shared `docuvia init` template,
> `artifacts/cli/src/constants/init-templates.ts`) gained a 4th fallback trigger: a non-`exact`
> match_type on what should be a well-known symbol/file. Live-reconfirmed against the original 5
> comparison-table cases: `queryCommand` → `match_type="exact"`; `"query command"` → still the same
> wrong single hit, now visibly `match_type="keyword"`; `"cli commands list"` → `match_type="keyword"`;
> `docuvia-api` → `match_type="exact"`. The underlying matching algorithm itself is unchanged (still
> can't find `query.ts` from a concept phrase) — the fix makes the _confidence_ of a wrong/incomplete
> result visible so the fallback policy can catch it, not the matching itself smarter.

Exact symbol name lookups work well (return a real call graph, better than grep for that case).
AGENTS.md's "Docuvia-First Development Workflow (Mandatory)" section already documents three
fallback-to-Grep/Glob/Read triggers (empty or `tier_b_status="unprocessed"` result; exact source
text/formatting/diff needed; a dependency `impact` can't detect), and an empty-result failure mode
(free-text/comment search, a naming-style mismatch) correctly trips that policy. The surviving gap
is narrower: a concept-phrase query and a directory-style enumeration request each return a
non-empty, not-flagged-unprocessed result that is nonetheless wrong or incomplete — neither
condition trips any of the three documented triggers, so an agent following the current policy to
the letter would trust a wrong/incomplete answer as final rather than falling back. Full detail:
`docs/cli-test-analysis/docuvia-self-verification-2026-08-05.md`.

### 23. No first-class visibility into Tier B coverage breadth — `doctor` gives false confidence

> **Shipped — 2026-08-05.** `docuvia status` and `docuvia doctor` both now report Tier B coverage as
> a first-class metric (`lib/ui-core/src/workflows/status/status-workflow.ts`,
> `lib/ui-core/src/workflows/doctor/doctor-workflow.ts`'s new `tier_b_coverage` diagnostic, `FAIL`
> below a 50% threshold via `DEFAULT_TIER_B_COVERAGE_FAIL_THRESHOLD`). Live-verified against this
> repo's real database: `status`/`doctor`/`query`'s independent unprocessed-note all agreed exactly
> (74/484 processed, 15.3%) at verification time — `doctor`'s overall pass count correctly dropped to
> reflect the real gap instead of staying all-green. The underlying backlog itself is unchanged
> (still gated by the existing, correct-as-documented commit-cap throttle, item 15) — this fix is
> visibility only, not a change to how fast Tier B actually drains.

410 of 484 tracked files (84.7%) in Docuvia2's own repo have never been Tier B-processed (confirmed
via a note embedded in `query` output, reproduced across two unrelated queries) — down from 422/484
at initial test time, confirmed to move after a real `docuvia analyze --escalate-to-lsp` batch run
in the same session, i.e. a real, large, moving-but-slow backlog, not a stuck counter. `doctor`'s
`tier_b_commit_cap` check is hardcoded to always report `PASS` (see item 15 — that design decision
is correct on its own terms) but neither it nor anything else surfaces the actual "% of repo ever
Tier-B processed" figure as a first-class metric; it's only discoverable as an incidental note
inside individual `query` responses with zero incoming edges. Full detail:
`docs/cli-test-analysis/docuvia-self-verification-2026-08-05.md`.

### 24. Tier C's queue is permanently head-of-line-blocked by two always-first, always-failing items

> **Shipped — 2026-08-05, two fixes.** (1) `lib/ui-core/src/workflows/analyze/run-tier-c-drain.ts`/
> `tier-c-queue.ts`: a permanently-failing queue item is now evicted after
> `DEFAULT_TIER_C_MAX_ITEM_FAILURES` (3) consecutive failures instead of blocking every item behind
> it forever. (2) The actual root cause of every prior failure, found live-verifying fix (1):
> `lib/llm-api/src/fetch-llm-client.ts` built the chat-completions URL as
> `baseUrl + "/v1/chat/completions"` unconditionally, doubling to `.../v1/v1/chat/completions` (404)
> whenever `baseUrl` already ended in `/v1` — this environment's real
> `AI_DOCUVIA_INTEGRATIONS_OPENAI_BASE_URL=https://openrouter.ai/api/v1` always did, so 100% of Tier
> C LLM calls had failed since this repo's inception, misclassified as `bridge-unreachable`. New
> `buildCompletionsUrl()` strips a trailing `/v1` before appending the path. Live-verified: `docuvia
status`'s `L3 Decisions` moved from 0 (this repo's entire history) to a real positive count for the
> first time, confirmed via `.docuvia/logs/analyze.log`'s `analyze.tierC.item_success` events, across
> multiple real `docuvia analyze --escalate-to-lsp` runs.
>
> **Shipped — 2026-08-20, issue #145, two additional fixes.** (3) `handleTierCItemOutcome` now
> always returns `false` (continue) instead of `return outcome.reason ===
TierCFailReasons.BRIDGE_UNREACHABLE` — a bridge-unreachable failure no longer stops the entire
> drain loop, so subsequent items are processed in the same run. The poison-pill eviction mechanism
> still applies per item. (4) New `--tier-c-all` CLI flag (`docuvia analyze --escalate-to-lsp
--tier-c-all`) removes the wall-clock (12s) and item-count (20) caps, draining every queued
> Tier C item in one run until budget exhaustion or queue exhaustion. Wired through the full stack:
> `cli-flags.ts` → `cli.ts` → `analyze.ts` → `docuvia-api.ts` → `analyze-workflow.ts` →
> `run-tier-b-batch.ts` → `run-tier-c-drain.ts`.

All head-of-line-blocking scenarios are now resolved: the loop continues past failures (fix 3),
permanently-failing items are evicted after 3 consecutive failures (fix 1), and `--tier-c-all`
allows draining large queues in a single run (fix 4). The `no-anchor` item that was always first
will eventually be evicted by the poison-pill mechanism once its failCount reaches 3.
LLM endpoint. Full detail: `docs/cli-test-analysis/docuvia-self-verification-2026-08-05.md`.

### 25. Follow-up from item 22: `query`'s actual keyword/FTS matching quality is still unimproved

> **Shipped — 2026-08-06.** Root-caused with direct SQL inspection against this repo's own
> `.docuvia/local.db`, not guesswork: `"query" AND "command"` matched **0** `l2_nodes` rows even
> though `artifacts/cli/src/commands/query.ts` obviously matches both concepts — the default FTS5
> tokenizer (`unicode61`) does exact token matching with no stemming, so the plural directory
> segment `"commands"` and the singular query keyword `"command"` are two different tokens that
> never match each other. A self-test harness
> (`docs/cli-test-analysis/docuvia-self-verification-2026-08-06.md`) of 27 realistic concept-phrase/
> exact-symbol queries against this repo, run through the real CLI end-to-end, measured a **51.9%
> (14/27)** baseline — far worse than the single documented case suggested, confirming this was a
> systemic ranking bug, not a one-off. Three layered fixes closed it:
>
> 1. **`lib/schema/src/sqlite/migrations/0007_fts_porter_stemming.sql`** — rebuilds
>    `l2_nodes_fts`/`l3_nodes_fts` with `tokenize='porter unicode61'`, folding plurals/suffixes to a
>    shared stem (`"commands"`/`"command"` → `"command"`) at both index and query time. Verified
>    directly against a scratch copy of this repo's real database before committing to the
>    migration: `"query" AND "command"` went from 0 matches to exactly the query.ts symbol rows.
> 2. **`lib/schema/src/sqlite/repos/fts-repo.ts`** — `searchL2Nodes`/`searchL3Nodes` now try an
>    AND match (every keyword must match the same row) first, falling back to the previous OR
>    match only when AND finds nothing — closing item 25's originally-diagnosed "no fallback
>    strategy when the top FTS hit scores far below what an exact match would" gap.
> 3. **`lib/core/src/query/query.service.ts`** — the OR-fallback path re-ranks candidates by how
>    many distinct query keywords they cover (stable sort, BM25 rank as tiebreaker) before the
>    existing score bands are assigned, and `extractKeywords()` no longer drops meaningful
>    single-character tokens (this codebase's own Tier A/B/C vocabulary means `"tier c queue"` must
>    keep `"c"` or it becomes indistinguishable from `"tier b queue"` — the self-test harness
>    caught this as the one resolvable case still failing after fixes 1-2).
>
> Re-running the same 27-case harness after all three fixes: **100% (27/27)**. Also fixed the
> originally-diagnosed case verbatim: `docuvia query "query command"` now resolves to
> `artifacts/cli/src/commands/query.ts`. New/updated tests: `query.service.unit.test.ts` (keyword-
> coverage re-rank, single-char token retention), `graph-store.integration.test.ts` (AND-first/
> OR-fallback, porter stemming), `migration-runner.unit.test.ts` (migration 0007 schema + stemming
> behavior). Full session detail:
> `docs/cli-test-analysis/docuvia-self-verification-2026-08-06.md`.

Item 22's fix (`matchType`) only makes an agent able to _tell_ a match is low-confidence — it does
not make the match itself better. `docuvia query "query command"` still resolves to the wrong file
(`artifacts/cli/src/utils/init-command-lock.ts` instead of `artifacts/cli/src/commands/query.ts`),
now correctly labeled `match_type="keyword"` instead of looking as confident as an exact hit, but
still wrong. `lib/core/src/query/query.service.ts`'s FTS ranking (`store.fts.searchL2Nodes`/
`searchL3Nodes`) has no synonym/token-expansion step and no fallback strategy when the top FTS hit
scores far below an exact match would — a concept phrase composed of common words (e.g. "query",
"command") can outrank the actual target file if the target's own indexed name/description happens
to share fewer of those tokens than an unrelated file does. Two other numeric thresholds introduced
alongside items 23/24 are similarly unvalidated placeholders, each already flagged inline where they
live rather than needing a separate item here:
`DEFAULT_TIER_B_COVERAGE_FAIL_THRESHOLD` (`git-constants.ts`, 0.5) and
`DEFAULT_TIER_C_MAX_ITEM_FAILURES` (`git-constants.ts`, 3) — both have a doc comment noting they're
untuned, re-tune if real usage shows either is off. Not scheduled; no measured pain trigger exists
yet for any of the three (the concrete re-entry-trigger pattern items 9/17 already use) — parking
here rather than speculatively redesigning the ranking algorithm now.

### 26. Claude Code `PreToolUse` hook is inert outside formal plugin packaging

> **Path (a) shipped — 2026-08-06.** `ClaudePlatform.configureHooks()`
> ([`claude.platform.ts`](../../../artifacts/cli/src/platforms/claude.platform.ts)) now additionally
> merges a project-level hook entry into `.claude/settings.json`, using
> `CLAUDE_PROJECT_HOOKS_DIR = "${CLAUDE_PROJECT_DIR}/" + CLAUDE_HOOKS_DIR`
> ([`init-templates.ts`](../../../artifacts/cli/src/constants/init-templates.ts)) instead of the
> plugin-only `${CLAUDE_PLUGIN_ROOT}`. The existing plugin-style `.claude/hooks/hooks.json` write is
> completely unchanged (kept for a future real plugin distribution) — this is purely additive. The
> merge/prune logic (`mergeDocuviaHookIntoProjectSettings`/`pruneDocuviaHookFromProjectSettings`)
> never touches unrelated content already in `.claude/settings.json` (other top-level keys like
> `permissions`, other `PreToolUse` matchers), is idempotent across repeated `docuvia init` runs,
> and never overwrites a settings file it can't safely parse or whose `PreToolUse` field has an
> unexpected (non-array) shape — that last case was caught by independent `task-verifier` review via
> a live repro (not just code inspection), which found the initial implementation threw an uncaught
> `TypeError` on a malformed-but-valid-JSON `PreToolUse` value and would have hard-failed `docuvia
init` (aborting hook setup for every platform selected after Claude in that run); fixed with an
> explicit `Array.isArray` guard mirroring the prune side's existing one, plus a regression test.
> Verified: 16/16 tests passing in
> [`claude.platform.unit.test.ts`](../../../artifacts/cli/test/unit/platforms/claude.platform.unit.test.ts)
> (6 pre-existing + 10 new), clean typecheck. Path (b) stays exactly as documented below — blocked
> upstream by anthropics/claude-code#24529, not attempted.

Found 2026-08-05 (`docs_overhaul` session), reconfirmed live 2026-08-06. `docuvia init`'s
`ClaudePlatform.configureHooks()`
([`claude.platform.ts:143-163`](../../../artifacts/cli/src/platforms/claude.platform.ts)) writes
`.claude/hooks/docuvia-hook.js` plus a `.claude/hooks/hooks.json` whose `PreToolUse` command is
templated as `node ${CLAUDE_PLUGIN_ROOT}/hooks/docuvia-hook.js`
([`CLAUDE_PLUGIN_HOOKS_DIR`](../../../artifacts/cli/src/constants/init-templates.ts)). That
`${CLAUDE_PLUGIN_ROOT}` placeholder only resolves when the repo is loaded as a formal Claude Code
_plugin_ — there is no code path in `ClaudePlatform` that ever writes a plain-project
`.claude/settings.json` hook entry. Reconfirmed against this exact checkout: no
`.claude/settings.json` exists, `.claude/hooks/hooks.json` still contains the unresolved
`${CLAUDE_PLUGIN_ROOT}` command, and the automatic "inject `docuvia query`/`impact` context before
`Grep`/`Glob`/`Bash`/`Read`" hook has never actually fired here. `uninstallHooks()` is symmetric and
correctly cleans up whatever `installHooks()` wrote — not a bug in itself, just uninstalling
something that was never functionally wired up in this mode. The only thing currently making
Docuvia's docuvia-first mandate happen at all is the prose instruction baked into
AGENTS.md/CLAUDE.md — no technical enforcement layer backs it for a plain (non-plugin) checkout.

**Next step (scoped to Claude only for now):** decide between (a) `ClaudePlatform` additionally
writing a plain-project `.claude/settings.json` hooks entry with a resolvable absolute path instead
of `${CLAUDE_PLUGIN_ROOT}`, so the hook works the moment `docuvia init` runs in any checkout, or (b)
packaging Docuvia2 itself as a real, installable Claude Code plugin so the existing
`hooks.json`/`${CLAUDE_PLUGIN_ROOT}` path resolves as designed.

**2026-08-06 research, changes the picture:** verified against Claude Code's own docs/issue tracker
(via the `claude-code-guide` subagent, WebFetch-sourced, not from training memory) —

1. `${CLAUDE_PLUGIN_ROOT}` is not just "unresolved outside plugin context," it is a **currently-broken
   Claude Code platform bug**: the hook executor never sets it, even inside real plugin hooks —
   [anthropics/claude-code#24529](https://github.com/anthropics/claude-code/issues/24529). So path
   (b) cannot work today regardless of how well Docuvia2 packages itself as a plugin; it's blocked
   upstream, not by anything in this repo.
2. `${CLAUDE_PROJECT_DIR}` **does** resolve correctly in a project-level `.claude/settings.json`
   hook today — path (a) is technically buildable right now.
3. Plugin-scope hooks and project-scope hooks are **not deduplicated against each other** — per
   Claude Code's `hooks.md`, same-handler dedup only applies within one settings layer; a plugin
   hook and a project hook with the same `PreToolUse` matcher both fire, in parallel, every time. So
   if (a) and (b) were both active at once for the same user/repo, `docuvia-hook.js` would run twice
   per `Grep`/`Glob`/`Bash`/`Read` call (doubled latency against each side's own timeout budget,
   duplicate context injection) — a real conflict, not a hypothetical one.

**Decided direction for when both paths eventually coexist** (not built yet, parked until (b)
becomes viable): switch between them via a parameter/env var at _packaging_ time, not runtime — when
a future plugin-packaging step produces the plugin distribution, that step excludes/disables the
project-level (a) hook registration from what it ships, so a plugin install and a project-level
`docuvia init` never both register the same hook for the same user. Deliberately not implementing
this exclusion logic now — it has nothing to guard against yet, since (b) is inert until Anthropic
fixes #24529. Revisit once that issue closes.

**Immediate next step:** ~~ship (a) only~~ — done, see the "Path (a) shipped" note at the top of this
item.

**Deliberately out of scope here:** whether Cursor (`${CURSOR_PLUGIN_ROOT}`, same pattern in
`init-templates.ts`) or any other platform adapter has the identical gap, or the identical
upstream-bug situation. Re-check each platform separately once the Claude decision above lands,
rather than assuming the same fix (or the same bug) generalizes.

**Status: path (a) shipped 2026-08-06 (see top of item). Path (b) stays blocked upstream by
anthropics/claude-code#24529, not by anything decidable in this repo — the packaging-time exclusion
logic described above stays parked until that closes.**

### 27. Tier B LSP batches held an unbounded number of documents open at once — a bounded-LRU cache fix, live-verified against vscode

> **Fixed 2026-08-06.** `BaseLspEdgeProvider`
> ([`lsp-edge-provider-base.ts`](../../../lib/core/src/lsp/lsp-edge-provider-base.ts), shared by all
> 9 language Tier B providers) only closed a file once its own turn in the batch queue finished — a
> file opened transitively as another file's caller (via `resolveReferenceEdge`) stayed open until
> ITS OWN turn arrived, which for a huge, densely cross-referenced batch (vscode's 12,339-file
> queue) meant the LSP server could accumulate a number of simultaneously-open documents bounded
> only by the whole batch size, not by any deliberate cap. This was the previously-documented,
> previously-parked suspected cause of `typescript-cli-benchmark.md`'s "throughput collapse" finding
> (§3.2 finding 7, summarized in this file's own §3.2 item 7 above) — left open there as "a bounded-
> LRU close policy is the likely real fix" rather than chased further at the time. Trigger to act
> now: a manual standalone LSP probe against the same vscode checkout completed in ~6-7 minutes,
> faster than CRG's own comparison run against the same repo — evidence the bottleneck was
> Docuvia2's own open/close orchestration, not `tsserver`/`gopls` themselves being slow at vscode's
> scale. Fixed with a new `maxOpenFiles` config field (`EdgeResolutionProviderConfig`, default 50 via
> `DEFAULT_MAX_OPEN_FILES`) plus a genuine LRU eviction loop in `openAndGetSymbols`: cache hits bump
> recency, cache misses evict the least-recently-used entries _before_ the new file's own `didOpen`
> is sent, so the real LSP server itself never transiently exceeds the cap — not just the cache's
> own bookkeeping. Verified via a new unit test with a fake LSP client (4 files, cap of 2, replays
> real `DID_OPEN`/`DID_CLOSE` notification order, asserts concurrently-open count never exceeds the
> cap). Full `lib/core` + `lib/contracts` suites: 423 tests passing, zero regressions across all 9
> language provider test files. Independently re-verified by `task-verifier`, including confirming
> the eviction-before-open ordering by reading the code directly.
>
> **Live re-verification against the real vscode checkout** (`D:\GitHub\vscode`, existing Tier A
> already ingested — 293,309 L2 nodes): a scoped `docuvia analyze --escalate-to-lsp` run needed one
> unrelated environment fix first — this same clone's `typescript` devDependency had reverted to
> being aliased to the `@typescript/typescript6` preview package (no classic `lib/tsserver.js`), the
> exact environment gap `typescript-cli-benchmark.md` had already documented and fixed once before
> in this same clone; reinstalled a real standard `typescript@5.6.3` into `node_modules`
> (devDependency only, `--no-save`, no `package.json`/lockfile change kept). With that in place, one
> run of `analyze --escalate-to-lsp` advanced Tier B coverage from 558/12,339 to 707/12,339 (149 new
> files, real `documentSymbol`+`references` round-trips) within its normal per-language time budget
> — no mass-timeout collapse — before hitting a new, unrelated failure: the
> `typescript-language-server` process itself exited (code=1) partway through, on
> `extensions/copilot/src/extension/codeBlocks/node/test/codeBlockProcessor.spec.ts`. Zero edges
> were applied this run, plausibly because the files successfully processed before the crash — mostly
> `.d.ts` declaration files and test files early in the queue — had no in-batch cross-file callers
> yet; not confirmed further.
>
> **Conclusion**: real, if partial, live evidence the bounded-LRU fix resolves the specific
> "reopening files causes near-universal timeouts" collapse mechanism — the batch made substantial
> real progress instead of collapsing outright. It surfaced a separate, not-yet-root-caused new
> blocker (see item 28 below): since Tier B coverage is a persistent, monotonic counter and the
> crashing file was never dequeued as failed-and-skipped, it will likely re-crash at roughly the
> same point on the next run — a potential new head-of-line block, similar in shape to the
> already-fixed Tier C bug (item 24). stderr wasn't captured or logged anywhere accessible this
> session, so the crash's actual cause is still unknown.

**Status: fixed 2026-08-06** (see the note at the top of this item) — the specific
unbounded-open-files collapse mechanism is fixed and live-verified against vscode; item 28 below
tracks the separate, new crash it surfaced.

### 28. `tsserver` OOM-aborts partway through a large vscode Tier B batch (exit code 134/SIGABRT)

> **Fixed 2026-08-06.** The user's chosen remedy was "raise tsserver's heap ceiling," but the
> first implementation of that (a `NODE_OPTIONS=--max-old-space-size=4096` env override on the
> spawn, `lib/core/src/lsp/lsp-binary-resolver-strategies.ts`'s `buildEnv` hook in the npx
> fallback) was live-verified insufficient: a follow-up run
> against the same vscode checkout reproduced the identical exit-134 crash, on a third different
> file this time. Reading `typescript-language-server`'s own source explained why: it reads
> `initializationOptions.maxTsServerMemory` directly off the `initialize` request and pushes that
> as tsserver's own `--max-old-space-size` argument, independent of `NODE_OPTIONS` — the real
> mechanism, not the one first tried. Added an optional `initializationOptions` field to
> `LspLanguageConfig` (`lib/core/src/lsp/lsp-edge-provider-base.ts`; `BaseLspEdgeProvider` forwards
> it verbatim on `initialize`, a no-op for every other language) and wired TS's config to supply
> `{ maxTsServerMemory: 8192 }` (bumped from the empirically-insufficient 4096; the `NODE_OPTIONS`
> override stays as a harmless secondary fallback). Live-reverified against the same vscode
> checkout: zero exit-134 crashes, Tier B coverage advanced 778/12,339 → 1,090/12,339 (312 files,
> its best single-run progress across this whole investigation), **1,184 edges applied** (every
> prior vscode Tier B run, crashing or not, had reported exactly 0), and the run now ends the same
> way C# already does on a large solution — `"Tier B LSP batch exceeded its 120000ms timeout and
was aborted"`, an ordinary, expected degradation, not a crash cascade.

Found 2026-08-06, immediately after item 27's bounded-LRU fix let a Tier B batch against vscode make
real progress (558/12,339 → 707/12,339 files) for the first time without collapsing to near-universal
timeouts. Initially opaque: the `typescript-language-server` process exited (code=1) while processing
`extensions/copilot/src/extension/codeBlocks/node/test/codeBlockProcessor.spec.ts`, with no visible
reason (`LspJsonRpcClient` piped the child's stderr but never listened on it — fixed same-day as its
own small diagnostic-infrastructure commit, `fix(core): capture LSP child-process stderr instead of
discarding it`).

**Root-caused with that fix, same session.** Re-running the identical batch with stderr capture in
place (707/12,339 → 778/12,339 files, no code change to the LSP logic itself between the two runs)
reproduced the crash again — on a **different** file this time
(`extensions/copilot/src/extension/completions-core/vscode-node/extension/src/textDocumentManager.ts`,
not `codeBlockProcessor.spec.ts`) — and this time the captured stderr showed the real cause directly
from `typescript-language-server`'s own output: `"tsserver process has exited (exit code: 134, signal:
null). Stopping the server."` Exit code 134 is `128 + SIGABRT` — the classic signature of a V8 fatal
error aborting the process after failing to allocate more heap ("out of memory"), not a Docuvia2
logic bug and not tied to any one specific file's content (confirmed by it moving to a different file
on the second run). Plausible mechanism: item 27's fix lets Tier B do far more _real_ work per run now
(hundreds of genuine documentSymbol/references round-trips instead of stalling on mass timeouts),
which means `tsserver` now actually accumulates enough type-checking state across vscode's huge
multi-project-reference graph, within one long-lived session, to eventually exhaust its default heap
— a real, separate scale ceiling that the earlier throughput-collapse bug was likely masking by
failing everything before this ever became reachable.

**Status: fixed 2026-08-06** (see the note at top of this item) — was: root-caused (V8 OOM abort,
exit 134) but not yet fixed. The other candidate remedy considered but not needed — restarting the
LSP session on a genuine process-death instead of cascading every remaining queued file to instant
failure — stays parked; not chased since raising the real ceiling made the crash stop happening at
this scale. Revisit only if a future, even-larger repo reproduces exit 134 again despite 8192MB.

### 36. Project-aware + dependency-ordered Tier B sharding (issue #41)

> **Shipped — 2026-08-15.** Full plan + implementation record + measured acceptance:
> [`project-aware-tier-b-sharding-plan.md`](project-aware-tier-b-sharding-plan.md) (PRJ-001..007).
> Closes the last of the Tier B throughput thread (items 27/28 fixed the single-server ceiling; this
> item makes multi-process sharding actually engage by default).

Replaced the round-robin partition (`i % processCount`) with project-aware, dependency-ordered shards:
one server per owning project at the project root (PRJ-002), projects emitted bottom-up so callee nodes
persist before caller edges apply (PRJ-003), parallelism capped by cores _and_ memory
(`processMemoryEstimateMb`, PRJ-004), settle moved outside the deadline window (PRJ-005),
sub-threshold projects coalesced into a "misc" shard (PRJ-006), and a readiness poll after the settle
so a shard never processes against a not-yet-loaded graph (PRJ-007).

**Measured on tauri (10 cores / 16 GB):** sharded ≈ 95-109 s vs single-process ≈ 113-119 s; edge set is a
_superset_ (4772 ± ~10 vs a bit-exact single-run 4662 — +110 project-internal TS edges the repo-root
server missed, −2-3 `ContentModified` races that also occur pre-existing in single mode). Two findings
worth preserving: rust-analyzer loads the whole Cargo workspace regardless of `cwd`/`rootUri`, so rust
shards are memory-bound (2 shards / 16 GB, ~4.3 GB each); and the CLI previously hard-coded
`--lsp-processes` to `1`, silently disabling §4 — that default is removed (unset auto-derives).

### 57. Empty (never-ingested) graph is invisible to `doctor` / the flush path — no diagnostic, no CLI advice, no auto-AST

> **Fixed 2026-08-16.** The never-ingested state (`.docuvia/local.db` exists but the graph inside
> it is empty — no project row, or 0 L2 nodes) is now detected in two places:
>
> - `doctor` gains a `graph_empty` diagnostic (`DOCTOR_DIAGNOSTIC_KEYS.GRAPH_EMPTY`): the
>   local.db _file_ existing is `db_found`'s whole check, so it structurally can't see a graph
>   with nothing in it — the new check opens the store read-only and FAILs with "run `docuvia init`
>   first — decisions need a graph to attach to" when there's no project row or 0 L2 nodes, PASSes
>   with the live L2 count otherwise. Gated behind `skipDb` like the other
>   db-backed checks; a missing/unopenable db degrades to silently skipped (already covered by
>   `db_found`'s own FAIL).
> - `analyze --flush-staged-l3`'s result now carries `noGraphToAttach` (threaded through
>   `persistDecisions`'s return), and the CLI prints a loud nudge when it's set — the actionable
>   guidance previously existed only in the JSONL log, leaving a manual flush on an empty graph
>   with an unexplained "0 flushed, N left staged" that was indistinguishable from "pending
>   forever".
>
> **Deliberately NOT implemented: auto-triggering ingestion from the flush path.** The post-commit
> hook's first line already runs `docuvia analyze` (auto mode), which performs a full ingestion
> on an empty graph — so on the standard commit flow the graph self-heals before/alongside the
> flush. Auto-ingesting inside the flush itself would duplicate that work (two concurrent full
> ingests racing each other on the very state that's most fragile) inside a backgrounded,
> fire-and-forget hook line, for the marginal benefit of the one edge case where a human runs
> `--flush-staged-l3` by hand before any `analyze`/`init` ever ran. The loud nudge + doctor
> diagnostic cover that case.

### 37. Agent-authored L3 decisions on non-source files can never be flushed — silently retried forever

> **Fixed 2026-08-16.** `analyze <target> --agent-authored --stage` now validates the target
> before appending: a nonexistent path fails with `PATH_NOT_FOUND` (matching the direct
> `--agent-authored` path), and a single file with zero collectible source files fails with a
> clear `INVALID_INPUT` error ("cannot anchor a decision to X: it is not a parseable source
> file...") telling the agent to write against a parseable source file instead. The direct
> `--agent-authored` path (`runAgentAuthoredWrite`) received the same guard. Full writeup +
> correction: [issue #30 comments](https://github.com/dyphn1/Docuvia/issues/30).

Found 2026-08-16 while verifying `--agent-authored --stage` / `--flush-staged-l3` end-to-end on
issue #30's branch. `stagePendingDecisions` accepted any target path; the flush's anchor
resolution (`resolveAnchorL2NodeId`) needs an L2 node whose `node_key` matches the target (or the
first collected source file). L2 file nodes only exist for tree-sitter-parseable files, so a
single genuinely non-source file (e.g. `README.md`, `.yml`, `.json`) has no node and is skipped
by `collectSourceFiles` → `persistDecisions` returns `{persisted:0, deduped:0}` → the flush
retries that entry forever, with the "0 flushed, N left staged" summary giving no hint the entry
can never land. Two important nuances from the live repro:

- **The empty-graph case is _not_ a dead-end.** The original repro staged on `eslint.config.mjs`
  and reported "0 flushed, 1 left staged" — but `.mjs` _is_ a supported extension
  (`JAVASCRIPT_EXTENSIONS = [".js", ".jsx", ".mjs", ".cjs"]`) and the file _does_ have an L2
  node; the flush failed only because the local graph had 0 nodes (no `docuvia init` yet). That
  is the legitimate, by-design transient: the entry stays staged and retries, with
  `NO_GRAPH_TO_ATTACH` logging "run `docuvia init` first". Once `init` ran, it anchored fine.
- The permanent dead-end is strictly the non-source-file case above. The stage-time refusal
  fixes that without touching the (correct) transient retry semantics.

Deliberate design choice: refusing at stage time rather than making non-source files anchorable
(a synthetic project-level anchor, or parsing non-source files into the graph) — the latter is a
much larger change with an open design question (where should a doc/config decision attach?) and
no incremental payoff for the common source-file flow; revisit if agents routinely need to record
decisions against docs/configs.

## Rejected / considered-and-closed (kept for context, do not re-litigate without new evidence)

- **Self-built static scope-resolution pipeline** (bypass LSP with hand-guessed cross-file calls)
  — overruled; see PLAT-007's Rejected alternatives.
- **Composite "Semantic Drift Ratio" commit-cap** (blast-radius half) — rejected as an expensive
  hot-path addition with no measured need; the diff/blob-size half was adopted separately (now
  shipped in PLAT-007's Tier B commit-cap).
- **Docker-compose historical-replay E2E harness** — rejected as disproportionate; a throwaway
  `git clone` + replay script substituted and actually found the Windows LSP spawn bug.
- **Recursive contract-diffusion re-seeding** — a simpler one-pass design shipped instead; re-open
  only on a real observed cross-contract-chain drift case.
