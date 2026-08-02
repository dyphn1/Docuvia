# Session Findings: Harness/Skills Issues & Docuvia2 Issues (2026-07-31)

> **Scope note:** This document was compiled at the end of a long, mostly conversational Claude Code session in this repo. Section 1 items were **directly observed and verified live** during that session (exact numbers quoted below, reproducible by re-checking `git status`/`git diff` at the time each hook fired). Section 2 items are **not** things independently re-verified this session — they are open items already recorded in [`cross-product-cli-benchmark.md`](cross-product-cli-benchmark.md) (dated 2026-07-22, 9 days stale as of this writing) and are restated here only because they came up in conversation. Don't treat Section 2 as freshly confirmed; re-verify before acting.

---

## 1. Harness / Skills Issues (verified live this session)

### 1.1 Context-bloat hook fabricates its file-count number

A `PostToolUse` "Harness OS" hook fired mid-session with:

> "Modified Files: 25, Accumulated Diff: 333 lines"

Actual state at that moment, checked directly:

```
$ git status --porcelain=v1   # 6 lines
$ git diff --cached --stat    # 6 files changed, 329 insertions(+), 4 deletions(-)
```

The **line count (333) was correct**; the **file count (25) was fabricated — off by ~4x** from the real 6. This means the hook's self-reported diagnostics cannot be trusted at face value; whatever produces this "context" summary should be checked, since a partially-correct number is more dangerous than an obviously-wrong one (it reads as credible).

**Suggested direction:** audit whatever computes "Modified Files" in this hook — it's disagreeing with its own (correct) line-count source, so the two numbers likely come from different, inconsistent code paths.

### 1.2 Tier-routing keyword match fires irrelevant skill suggestions on almost every turn

Across this entire session — a casual conversation with **zero code changes requested until the very last message** — the `UserPromptSubmit` "Tier Routing Pre-check" hook attached a "RECOMMENDED KNOWLEDGE GUIDES" list on nearly every single turn, driven by shallow keyword matching rather than intent. Examples actually seen:

- A message about the user's design philosophy triggered `fable-mode`, `build-multi-agent-system`, `grill-with-docs`, `improve-codebase-architecture` — none relevant to a reflective conversation.
- A message asking "what do you think of AI's rapid development" triggered the same cluster again, plus `fable-discipline`.
- A message about git's core properties triggered the entire `git-commit`/`rewrite-commits`/`using-git-worktrees`/`verification-loop` skill cluster, on a pure discussion turn.

This is the single most repeated finding of the session (10+ occurrences). It's not that any individual suggestion is wrong in isolation — it's that the match has no discrimination for conversational vs. task-shaped intent, so the agent has to manually filter noise on almost every turn.

**Suggested direction:** the trigger needs an intent/shape classifier, not pure keyword presence — e.g. require a structural or file-path signal before firing, not just topic words like "AI", "設計", "git".

### 1.3 Atomic-commit-check hook fires on out-of-repo writes, contradicting its own stated evidence

After 6 `Edit`/`Write` calls that wrote to Claude's memory store (`~/.claude/projects/.../memory/*.md`) — entirely outside this repository — the `PostToolUse` atomic-commit-check hook fired:

> "[Atomic Commit Check] 6 Edit/Write calls since the last commit (0 files currently changed). If a logically complete chunk of work is done, commit it now..."

The hook's own message states "0 files currently changed" (correct — `git status` in this repo was clean) yet still recommends committing. It counts `Edit`/`Write` tool invocations globally, without checking whether they touched this repository at all.

**Suggested direction:** gate the recommendation on `git status` actually showing changes in this repo, not on a raw tool-call counter.

### 1.4 Tier misclassification escalated a pure-discussion turn to "Tier 2 (Standard Task)"

One turn (a conceptual question about git's core properties, no code touched) was classified:

> "RECOMMENDED TIER: Tier 2 (Standard Task) — RATIONALE: Prompt implies development work needing TDD validation or multi-file coordination."

and recommended loading `todo-driven-workflow` + a TDD skill chain before "editing any file." No file was going to be edited; the message was a discussion question. This is the same root cause as 1.2 (keyword-driven, not intent-driven), but worth listing separately since it escalates a _workflow mode_, not just a suggestion list — a more consequential misfire.

### 1.5 (Unverified — flag for follow-up, not a confirmed bug) Self-heal auto-writes cross-tool integration files on every session start

The `SessionStart` hook log included:

> "[Self-Heal] Missing integration touchpoints: .claude/settings.json, .cursorrules, .github/copilot-instructions.md, AGENTS.md — Repair (idempotent)"

This session never actually confirmed whether new files were written (no untracked `.cursorrules`/`copilot-instructions.md` showed up in `git status` this session — either it was a true no-op, or it wrote somewhere not caught here). Worth checking deliberately: does this write into the tracked repo unprompted on every session boot, and if so, should that require opt-in rather than running silently every time?

---

## 2. Docuvia2 Issues (sourced from the existing 2026-07-22 benchmark doc — re-verify before acting)

These were **not** re-tested this session; they're restated from [`cross-product-cli-benchmark.md`](cross-product-cli-benchmark.md) §2a/§2b/§3 because they came up in conversation. Treat as "last known state," not current fact — and per the correction below, in this case "last known state" was already wrong even before this document was written.

> **Correction (2026-08-02, checked against current source and [`roadmap-and-open-items.md`](roadmap-and-open-items.md) while investigating where this session's findings actually originate):** items 1 and 2 below were both already resolved _before_ this document was written on 2026-07-31 — this section restated a stale doc without re-verifying it, which is exactly the failure mode `cross-product-cli-benchmark.md`'s own §3 "Lesson for future re-runs" warns about. Item 3 is still open and accurate.

1. ~~**`docuvia init` has no non-interactive/CI mode.**~~ **Fixed by [IFCE-004](../adr/interface/IFCE-004-explicit-interactive-opt-in.md), accepted 2026-07-27 — 4 days before this document was written.** Interactive prompts (including `init`'s platform checkbox) are now opt-in via `--interactive`/`-i` only; `docuvia init` with no flags never prompts and proceeds straight to its non-interactive default (every platform), regardless of `stdin.isTTY`. The originally-proposed `--yes` flag wasn't needed — the default itself changed. (Was doc's action item 3.)
2. ~~**No rich HTML visualization.**~~ **This premise was never actually true, and nothing needed to ship to fix it.** `export-topology` has written a self-contained interactive HTML file (canvas force-layout, pan/zoom, search, group hulls, click-to-inspect blast-radius highlighting — see `topology-html-template.ts`) since commit `624fad5a` on 2026-07-12, _ten days before_ the 2026-07-22 benchmark run claimed "no equivalently rich rendering." That run evidently checked only the console stats/JSON, not the `.html` file it also wrote. [`roadmap-and-open-items.md`](roadmap-and-open-items.md) item 5 ("richer `export-topology`", shipped 2026-07-28) enriched the _data_ fed into that pre-existing template (L2 type, decision confidence/validity, edge provenance) — a separate, smaller improvement from "no visualization existed." (Was doc's action item 5.)
3. **Git-worktree ref-collision risk in `snapshot`/`hydrate`/`sync-knowledge`.** A git worktree shares the same `.git` ref store as the primary tree, so running `docuvia snapshot` inside a Docuvia2 self-worktree can silently move the _primary tree's real_ `docuvia-knowledge` branch to a disposable test snapshot. Happened once during the 2026-07-22 benchmark run; caught via `git reflog` and reverted, not data loss, but a real structural sharp edge. (Doc §0 and §2b's "worktree incident" note.)
   - Discussed this session: your own proposed fix — make the target branch name configurable so a test/worktree context can point at a disposable branch instead of the real `docuvia-knowledge` — would close this. Still not implemented as of 2026-08-02 (`GitConstants.KNOWLEDGE_ROOT` in `lib/core/src/git/git-constants.ts` remains a hardcoded `"docuvia-knowledge"` constant, not configurable); you flagged it as intentionally deprioritized, not forgotten.

---

## Out of scope (not included above)

GitNexus's `analyze` overwriting a target repo's `CLAUDE.md` (documented in the same benchmark doc, §3 "Note on GitNexus") is a **GitNexus bug**, not a harness-everything or Docuvia2 issue — left out of both sections above since it belongs to a different project.
