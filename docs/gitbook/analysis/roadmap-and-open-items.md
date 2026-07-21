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

## Phase 2 — Distribute (item 1 decided & shipped; items 2-3 not yet designed)

L3 distribution (storage shape + merge strategy) is decided and shipped — see
[Phase 2, Item 1 — L3 Distribution Strategy](phase2-l3-distribution.md) for the full contract
(`L3DIST-001`..`008`) and implementation record (2026-07-21).

### 1. `sync-knowledge` scheduling

Its own code comment already blesses "a scheduled task or CI step" as the follow-up; nothing
wires it up automatically today. Must be decided **together with** Tier B's pre-push batch
(PLAT-007) so the two don't double-fetch on the same pre-push hook.

### 2. Remote sync auto-push story

`sync` today needs a manual `projectId`/PAT. Undecided: does the background loop ever push L3 to
the remote API automatically, or does that stay an explicit, user-triggered step indefinitely?

### 3. `sync` vs `sync-knowledge` naming

Flagged repeatedly as a source of confusion (two similarly-named commands, different scopes).
Candidate for the project's command-convergence principle (the "user-sentence test") — worth its
own small IFCE ADR once Phase 2's shape (items 1–2) is settled, since the naming decision depends
on what each command ends up doing.

## Phase 3 — Consume (mostly working, minor follow-ups)

### 4. Surface L3 "why" data in `review`/`impact` output

Read-path self-healing hydration already works end-to-end. Now that L3 distribution
([phase2-l3-distribution.md](phase2-l3-distribution.md)) is shipped, this is the next
differentiator vs. GitNexus-class tools — showing _why_ a symbol changed alongside _what_ changed.

### 5. Richer `export-topology`

No design blockers now that the graph is non-empty on a fresh clone (Tier A ships real data). Just
needs prioritization against the rest of this list.

## Feature proposals — not yet decided

### 6. Non-interactive `init` (`--yes` / `--non-interactive`)

**Problem:** `init`'s TTY-gated confirm prompt and the agent-integration multiselect both hang
indefinitely under CI/CD or scripted invocation (e.g. another tool benchmarking `docuvia init`).
Confirmed still true — `nonInteractive`/`--yes` do not exist anywhere in `init.ts` or the init
workflow as of 2026-07-19.

**Proposed shape** (design only, not owner-ruled):

- Add `nonInteractive: z.boolean().default(false)` to `InitInputSchema`; `--yes` (or
  `--non-interactive`) skips `askConfirm` and assumes consent.
- If non-interactive and `--platform` is not given: **skip agent-hook installation silently**
  (print "Skipped agent hook installation in non-interactive mode") rather than erroring —
  background/CI callers care about the core engine starting, not about global editor hooks being
  silently installed without authorization.
- Unlocks adding `docuvia init --yes` as a real CI pipeline first-step, and genuine E2E coverage
  of the AST-worker/DB-schema integration.
- Security note carried from the original proposal: non-interactive mode must still forbid any
  action touching global config (`~/.claude/`, etc.) unless explicitly flagged — same boundary
  IFCE-002 already enforces for `--global`.

### 7. `uninstall` global-config confirmation

`uninstall` can touch global, cross-project config (e.g. removing Docuvia's MCP entry from a
global `claude_desktop_config.json`). Flagged by the 2026-07-13 cross-product benchmark as a side
effect users should be warned about before it happens; no confirmation step exists today.

## Known open technical items (small, tracked, unowned)

### 8. Race C — `query` (foreground read) vs. `analyze` (background write)

Unlike the two already-closed concurrency races (`analyze`+`snapshot`, `doctor`+`hydrate`, both
gated by regression tests since Slice 2), this one has **no gating test anywhere**. WAL mode's
non-blocking read/write property likely makes it benign (a stale-but-consistent snapshot, not
corruption) — but that's an inference, not a verified claim. Worth a reliability-pass item if it's
ever worth confirming.

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

### 11. Hydrate-then-delta optimization

Correctness is fine as-is: an empty `local.db` next to a populated knowledge branch currently does
a full re-parse of HEAD, and `markSynced` prevents a later `ensureHydrated` from clobbering it with
a stale snapshot. On large repos, hydrating the snapshot first and then delta-ing from its
`Docuvia-Source` trailer to HEAD would be cheaper. Pure performance, not correctness — no urgency.

### 12. Delta log misattribution

Delta ingestion's reuse of `runParseAndPersist` writes `init.parse_failure`/
`init.file_skipped_oversized` events to `init.log` (so an oversize skip during delta ingestion
gets logged under the `init` event stream, not a delta-specific one). Wants an
event-name/log-target parameter threaded through the shared helper.

### 13. Dirty-index hash edge

Delta ingestion takes blob hashes from the git index but reads content at `headSha`; a dirty index
can mismatch the `files` dedup table. Confirmed harmless today (Tier B never calls the same code
path — `collectFilesToParse` is Tier A only), but worth rechecking if either tier's design changes.

### 14. `getChangedFilesSince` asymmetry footgun

No-arg mode merges in untracked files; an explicit `baseRef` (even `"HEAD"`) does not. Documented
and pinned by integration tests today, but an easy trap for a future call site that doesn't know
the asymmetry exists.

### 15. Degraded batch still advances `lastTierBBatchSha`

A fully-degraded Tier B batch (LSP absent) still seeds/advances the commit-cap baseline at the
next snapshot, even though its queued entries stay unprocessed. Harmless today (pre-push runs
regardless of the cap), but interacts with any future "rebuild the queue from `lastTierBBatchSha`"
recovery story.

### 16. Tier B "file exists" check is working-tree, not HEAD

Implemented as an exists-in-working-tree check rather than exists-at-HEAD, since the LSP session
reads live files off disk. Consistent with item 13 above; not a bug, just worth remembering if
Tier B ever operates against something other than the live working tree.

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
