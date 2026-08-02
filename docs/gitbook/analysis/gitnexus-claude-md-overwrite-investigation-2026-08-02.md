# Investigation: GitNexus's Reported `CLAUDE.md` Overwrite Bug (2026-08-02)

> **Purpose:** follow-up on the "Note on GitNexus" item in
> [`cross-product-cli-benchmark.md`](cross-product-cli-benchmark.md) §2b/§3 — a real finding from
> that 2026-07-22 benchmark run, explicitly out of scope for Docuvia2 itself (a different project),
> and never independently re-verified until this pass. Written up as a standalone report, not filed
> upstream — that decision is left to whoever maintains this local GitNexus checkout.

## The original claim (2026-07-22)

From `cross-product-cli-benchmark.md` §2b, during the cross-product CLI benchmark: running
`gitnexus analyze` against the Docuvia2 repository (copied into an isolated worktree per that
document's §0 safety rule) **completely overwrote `CLAUDE.md`**, replacing the entire pre-existing
file (Docuvia2's real orchestration instructions) with only GitNexus's own auto-generated block —
while `AGENTS.md` was correctly appended to (a `<!-- gitnexus:start -->`/`<!-- gitnexus:end -->`
block added alongside the existing content, not a replacement). This was caught and reverted during
that benchmark session. §3's recommended fix: make `CLAUDE.md` go through the same
marker-bounded append/merge path already used for `AGENTS.md`.

## What the current GitNexus source actually does (checked 2026-08-02)

Checked against this machine's local clone (`d:\GitHub\GitNexus`, a clone of
`abhigyanpatwari/GitNexus` — not a repo this user owns; a real multi-contributor open-source
project), HEAD at commit `3729b13e` ("release: v1.6.10-rc.119", 2026-07-28 — six days _after_ the
benchmark run above).

**`AGENTS.md` and `CLAUDE.md` are written by the exact same function call, with no special-casing
between them:**

```ts
// gitnexus/src/cli/ai-context.ts, generateAIContextFiles() — lines ~501-522
const agentsResult = await upsertGitNexusSection(agentsPath, content, projectName, stats, options?.noStats);
...
const claudeResult = await upsertGitNexusSection(claudePath, content, projectName, stats, options?.noStats);
```

`upsertGitNexusSection` (same file, lines ~268-362) is already marker-bounded for both files:

- File doesn't exist → create it with just the GitNexus block.
- File exists, **no** `<!-- gitnexus:start -->`/`<!-- gitnexus:end -->` markers found → **append**
  the block after existing content (`existingContent.trim() + '\n\n' + content + '\n'`) — the
  pre-existing content is preserved, not replaced.
- File exists **with** markers → replace only the text between the markers (or, if
  `<!-- gitnexus:keep -->` is present, patch just the stats line in place), leaving everything
  outside the marker pair untouched.

This symmetric, marker-bounded design isn't new: it traces back to commit `747cf003` ("feat: improved
AI context - full inline content in AGENTS.md and CLAUDE.md with markers for updates"), dated
**2026-02-04 — over five months before** the benchmark run that reported the overwrite. The
section-marker matching was further hardened by `e262dda3` (2026-04-23, #1041/#1042) to reject
markers appearing mid-prose rather than at section position.

## Conclusion: unable to reproduce the reported behavior from source inspection alone

Based on reading the current source, a repo with an existing `CLAUDE.md` and no GitNexus markers
should hit the **append** branch, not a full overwrite — for both files identically. I have not
re-run `gitnexus analyze` live to confirm this (the user asked for a written report only, no code
changes and no live execution this pass), so this is a source-reading conclusion, not a fresh
repro. Plausible explanations for the discrepancy, in rough order of likelihood:

1. **The 2026-07-22 benchmark ran `npx gitnexus@latest`**, which resolves whatever was published to
   npm at that moment — if the published package lagged the marker-bounded fix (already on `main`
   since February) for some reason, or if a since-fixed regression existed only in a specific
   published version, the benchmark could have hit genuinely different code than what's on `main`
   today. Worth checking the exact npm version resolved during that run, if still recorded anywhere.
2. **A regression existed and was silently fixed** between 2026-07-22 and 2026-07-28 (or later)
   without an obviously-labeled "fix CLAUDE.md overwrite" commit message — `git log --since=2026-07-15
--until=2026-08-03 -- gitnexus/src/cli/ai-context.ts` shows only 5 commits in that window
   (`02ebf8f1`, `6182231c`, `8b5057f3`, `2c5b390d`, `a05b5011`), none with a commit message that
   names this specific bug, but a fix bundled into a larger commit wouldn't necessarily say so.
3. **The original observation had a different root cause** than "CLAUDE.md is unconditionally
   overwritten" — e.g. something about how the benchmark's worktree copy was set up meant Docuvia2's
   `CLAUDE.md` wasn't actually present/committed at the point `analyze` ran (so the _create_ branch
   fired, which is indistinguishable from an "overwrite" if the file was expected to already contain
   content), or a since-fixed bug elsewhere in the pipeline that isn't in `ai-context.ts` at all.

## Recommendation

Before filing anything upstream (issue or PR) against `abhigyanpatwari/GitNexus`: re-run the original
repro live — a disposable worktree with a repo that has a real, substantive `CLAUDE.md` and no
GitNexus markers, then `npx gitnexus@latest analyze` (to match how the original benchmark invoked
it) — and check whether `CLAUDE.md` is appended-to (expected, matches `AGENTS.md`) or replaced
(would mean the bug is real and current). If it no longer reproduces, this whole finding can be
retired as already-fixed, matching the pattern found earlier in this same investigation for
Docuvia2's own `init`/`export-topology` items (see `harness-and-docuvia-session-findings-2026-07-31.md`
§2, corrected 2026-08-02).
