# TypeScript CLI Benchmark & AST Analysis Report

> **Purpose:** This document defines the evaluation matrix, execution results, and metrics for TypeScript target repositories.
>
> **Status (2026-07-28/29):**
>
> - **Project 2 (`nestjs/nest`) is complete** for Docuvia2, Docuvia2 (+LSP), GitNexus, and Graphify. **Project 1 (`microsoft/vscode`) is deferred to a follow-up session** — see below.
> - **CRG is N/A for this pass.** `code-review-graph build` never finished post-processing (signatures/FTS/flows/communities) against `nest`, across 5 attempts (~20-30 min each) including `--skip-flows` and `--skip-postprocess` variants, after fixing two missing dependencies live (`tree-sitter-language-pack`, `python-igraph`). Raw AST parsing itself (1746/1746 files) reliably completed within each attempt's visible progress log, but every run then stalled indefinitely past that point with no diagnosable cause — CPU-time sampling on the process showed it mostly idle rather than computing, and no lock contention or orphaned process was found. Given the repeated failures, this was left as N/A per the session owner's direction rather than continued indefinitely. See §3 for detail.
> - **The LLM-dependent parts of this session were skipped by explicit choice** (`gitnexus wiki`, Graphify's semantic/LLM extraction layer, and Docuvia2's L3 decision extraction) — those rows are marked **⏭️ Skipped (LLM, out of scope this session)** rather than guessed at.
> - Graphify's CLI has grown a real `extract <path> --code-only` / `query` / `affected` / `explain` / `update` / `tree` command surface since the C# pass (2026-07-24), when it was found to be Claude-Code-skill-only for anything beyond bare structural extraction — see §3 for the updated capability note.
> - A **Docuvia2 (+LSP)** column reflects Tier B (`--escalate-to-lsp`) status. Three bugs were found and fixed across two 2026-07-29 follow-ups (§3.3, §3.7) before Tier B worked end-to-end; see §3.7 for the final, fixed-and-verified state.
> - **Environment variance was large and mattered more than expected** — a same-day Docuvia2-only re-test ran **~13x faster** with zero code changes (§3.7 point 1). Only Docuvia2 was re-timed; GitNexus/Graphify were not, so the cross-tool AST-speed comparison in §3 is flagged as unverified, not re-run.
> - **Environment-first lesson (confirmed by this session)**: every Tier B/LSP failure this session traced back to either an environment gap (stale native module, unresolvable LSP binary) or a code bug masked by one — never to LSP/AST logic being inherently unworkable. Verify the environment first; a "still broken" result after that is worth root-causing, not writing off. See §3.7's summary.
> - The "Remote Sync & Git Integration" category remains **not tested** for any of the four tools — no usable credentials configured in this environment — those rows stay N/A.

---

## 🔍 Target Projects

- **Project 1**: `microsoft/vscode`
- **Project 2**: `nestjs/nest`

---

## 1. Project 1: `microsoft/vscode` Benchmark

> ⏳ **Deferred to a follow-up session** (2026-07-28/29 pass). `nestjs/nest` (§2) proved far more time-costly than expected in this environment (see the status note above), and `vscode` is ~8x larger by file count (16,646 tracked files / 11,636 `.ts` vs. nest's 2,127 / 1,675) — attempting the same depth here risked an unbounded multi-hour run. Local clone verified present at `D:\GitHub\vscode`, HEAD `1b6a1881`. When resumed: full builds + query/impact/explain/visual-export only (no incremental-update stress test, no full CRG post-processing) is the scoped plan the session owner approved for this repo.

### Category: Indexing & Analysis (Graph Building)

| Feature / Metric           | Docuvia2  | Docuvia2 (+LSP)             | GitNexus    | Graphify                     | Code-Review-Graph (CRG) |
| :------------------------- | :-------- | :-------------------------- | :---------- | :--------------------------- | :---------------------- |
| **Full Graph Build**       | `analyze` | `analyze --escalate-to-lsp` | `analyze .` | `extract <path> --code-only` | `build --repo .`        |
| **Verified Build Result**  |           |                             |             |                              |                         |
| **Verified Build Latency** |           |                             |             |                              |                         |
| **Incremental Update**     |           |                             |             |                              |                         |
| **Clear Local Index**      |           |                             |             |                              |                         |

### Category: Query, Visualization & Impact

| Feature / Metric          | Docuvia2 | GitNexus | Graphify | Code-Review-Graph (CRG) |
| :------------------------ | :------- | :------- | :------- | :---------------------- |
| **Query Engine**          |          |          |          |                         |
| **Impact / Blast Radius** |          |          |          |                         |
| **Explain / Context**     |          |          |          |                         |
| **Visual Export**         |          |          |          |                         |
| **Docs / Wiki Gen**       |          |          |          |                         |

### Category: Remote Sync & Git Integration

| Feature / Metric         | Docuvia2 | GitNexus | Graphify | Code-Review-Graph (CRG) |
| :----------------------- | :------- | :------- | :------- | :---------------------- |
| **Push Analysis to API** |          |          |          |                         |
| **Commit Graph to Git**  |          |          |          |                         |
| **Hydrate from Git**     |          |          |          |                         |
| **Cross-Clone Sync**     |          |          |          |                         |

---

## 2. Project 2: `nestjs/nest` Benchmark

Local clone: `D:\GitHub\nest`, ~1,675/2,127 `.ts`/total tracked files, HEAD `dfaa3761` (detached).

### Category: Indexing & Analysis (Graph Building)

| Feature / Metric           | Docuvia2                                                                                                                                                                                                                                                      | Docuvia2 (+LSP)                                                                                    | GitNexus                                                                                                                  | Graphify                                                                                                                                     | Code-Review-Graph (CRG)                                                                                                                      |
| :------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------- |
| **Full Graph Build**       | `docuvia init --platform=claude` (did the actual parse+persist)                                                                                                                                                                                               | `docuvia analyze --escalate-to-lsp` (Tier B)                                                       | `gitnexus analyze . --index-only`                                                                                         | `graphify extract . --code-only`                                                                                                             | `code-review-graph build --repo .`                                                                                                           |
| **Verified Build Result**  | Exit 0. **16,159 nodes / 18,158 edges** (re-test; was 16,215 edges, §3.7). See §3.7.                                                                                                                                                                          | Exit 0. Fixed & verified 2026-07-29 (§3.7): real `initialize` + file processing + correct queuing. | Exit 0. **11,979 nodes / 35,501 edges**, 709 clusters, 300 flows                                                          | Exit 0. **14,394 nodes / 26,922 edges**, 1,046 communities (1,966 code files scanned; 67 skipped as non-code, 90 unclassified)               | **N/A — post-processing never completed.** Raw parse (1,746/1,746 files) reliably finished; every attempt then stalled indefinitely. See §3. |
| **Verified Build Latency** | **~307.3s → ~24s re-test** (~13x, env-only, §3.7)                                                                                                                                                                                                             | **~2s** to drain a populated queue                                                                 | **173.6s** real                                                                                                           | **104.5s** real                                                                                                                              | N/A — did not complete (5 attempts, ~20-30 min each including `--skip-flows`/`--skip-postprocess`)                                           |
| **Incremental Update**     | Contract-changing edit → detected & re-parsed via post-commit hook; uncommitted edits flagged, not silently skipped. Re-test: fire-and-forget hook left no `analyze.log` trace on Windows/git-bash — verified via direct foreground `analyze` instead (§3.7). | Fixed & verified (§3.7)                                                                            | Uncommitted 1-line edit **detected** but took **1785.8s (≈29.8 min)** — ~10x full-build. §3.4 (872-importer BFS fan-out). | `update .` re-ran **1,750/1,966** files as "uncached" after a 1-line edit; a no-op re-run showed the same count (cache didn't shrink). §3.5. | Not tested (build itself never completed)                                                                                                    |
| **Clear Local Index**      | `clean` deletes `local.db` but `status` re-hydrates from the knowledge-branch snapshot. `uninstall` removes `.docuvia/` + branch; on husky repos, hook files are emptied to 0 bytes rather than deleted (§3.7).                                               | Same as default                                                                                    | `clean --force` → "Repository not indexed."                                                                               | No dedicated verb tested (`uninstall --purge` exists, unexercised) — N/A                                                                     | N/A                                                                                                                                          |

### Category: Query, Visualization & Impact

| Feature / Metric          | Docuvia2                                                                                                                                                                    | GitNexus                                                                                | Graphify                                                                                                       | Code-Review-Graph (CRG) |
| :------------------------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------- | :---------------------- |
| **Query Engine**          | `query "Injectable" --format=prompt` (0.7s, was 2.2s) → same result: 1 `<l2_module>` + **9 real callers**                                                                   | `gitnexus query` (9.0s) → BM25/FTS loose matches, not a precise symbol hit              | `graphify query` (2.1s) → BFS token-budget dump, no ranked answer (expected, no LLM)                           | N/A                     |
| **Impact / Blast Radius** | `impact "Injectable"` (0.7s, was 2.0s) → same result: **9 files**, **Risk: HIGH**                                                                                           | `gitnexus impact` (5.5s) → **473 impacted**, **CRITICAL**, byDepth {1:204, 2:184, 3:85} | `graphify affected` (0.8s) → real reverse-traversal importer list                                              | N/A                     |
| **Explain / Context**     | Handled via `query` (no dedicated command)                                                                                                                                  | `gitnexus context` (6.4s) → real incoming-calls list                                    | `graphify explain` (1.9s) → **cleanest single-symbol output of the 3 tools**: degree 178, full connection list | N/A                     |
| **Visual Export**         | `export-topology` (0.7s, was 2.1s) → **1,727 nodes / 1,221 links / 72 groups**, 562 folded (link count tracks the higher edge count from §3.7; folded-link fix still holds) | No CLI export command                                                                   | `graphify tree` (0.8s) → `GRAPH_TREE.html`, 814.2 KB, D3 v7 collapsible tree                                   | N/A                     |
| **Docs / Wiki Gen**       | Not supported by the Docuvia2 CLI                                                                                                                                           | ⏭️ Skipped (LLM, out of scope this session)                                             | ⏭️ Skipped (LLM — `graphify label`'s community naming needs a backend)                                         | N/A                     |

### Category: Remote Sync & Git Integration

| Feature / Metric         | Docuvia2                                            | GitNexus | Graphify | Code-Review-Graph (CRG) |
| :----------------------- | :-------------------------------------------------- | :------- | :------- | :---------------------- |
| **Push Analysis to API** | N/A — no credentials configured in this environment | N/A      | N/A      | N/A                     |
| **Commit Graph to Git**  | N/A                                                 | N/A      | N/A      | N/A                     |
| **Hydrate from Git**     | N/A                                                 | N/A      | N/A      | N/A                     |
| **Cross-Clone Sync**     | N/A                                                 | N/A      | N/A      | N/A                     |

---

## 3. Observations & Findings (nest pass, 2026-07-28/29)

- **Docuvia2 Performance**: `init`'s AST parse (~283s for 1,675 `.ts` files) was markedly slower per-file than the 2026-07-24 C# session's PowerShell/Orleans passes (~22-59s for similar-or-larger file counts) — consistent with the session-wide slowdown noted at the top of this doc, not a TypeScript-specific regression. All read-path commands (`query`/`impact`/`export-topology`/`clean`/`uninstall`) stayed fast (1-5s) regardless, suggesting the slowdown is concentrated in the AST-parse/worker-pool step rather than general CLI overhead.
- **Docuvia2's AST stage measured 1.8-2.9x slower than GitNexus/Graphify** (307.3s vs. 173.6s vs. 104.5s). Attributed to WASM (`web-tree-sitter`, [ADR-022](../gitbook/adr/legacy/ADR-022-wasm-ast-blast-radius.md)) vs. native `tree-sitter` bindings — parallelization itself is correct ([`ast-processing.service.ts:29`](../../lib/core/src/ast/ast-processing.service.ts)). **⚠️ Superseded by §3.7**: a same-day Docuvia2-only re-test measured the identical stage at ~15.1s (~19x faster, no code change). The WASM-vs-native gap is still real architecturally, but this specific multiplier isn't trustworthy without re-timing GitNexus/Graphify the same day.
- **Comparison & Regressions**: two concrete UX fixes from the 2026-07-24 C# session were re-verified as holding on a fresh TypeScript repo: (1) the dirty-worktree fast-path now explicitly says uncommitted changes were skipped instead of staying silent, and (2) `export-topology`'s collapsed view reports its folded-link count instead of an unexplained "0 links."

### 3.1 Docuvia2's `hasUncommittedChanges` check is a blanket `git status --porcelain`, and `init` never gitignores its own artifacts

- `docuvia init` never writes `.docuvia/` (or `.claude/hooks/hooks.json`) into the target repo's `.gitignore` — confirmed by grepping `lib/ui-core/src/workflows/init/` for any `gitignore` handling (none found).
- `hasUncommittedChanges()` ([`git-local-provider.ts:663`](../../lib/git-local/src/git-local-provider.ts)) is a bare `git status --porcelain` with no path scoping and no `--untracked-files=no` — so `.docuvia/`'s own untracked presence alone makes it return `true`.
- **Reproduced directly**: with `.docuvia/`/`.claude/hooks/` left ungitignored, `docuvia analyze` after a real new commit printed the _dirty_ fast-path message ("uncommitted changes... won't be reflected"); after gitignoring those paths (fully clean `git status --porcelain`), the identical commit sequence instead printed the _clean_ message ("Already up to date with HEAD.") and the SHA watermark advanced correctly. Isolated by rebuilding `.gitignore` as (pristine original + 2 new lines) to rule out the pre-existing unrelated `.gitignore` diff as a confound.
- **Practically**: this doesn't block real commits from being ingested (see §3.2 — the post-commit hook picks them up regardless, since the fast-path's dirty/clean distinction only changes the _log message_, never the noop-vs-ingest decision — see `analyze-workflow.ts:216-233`). But a human running `docuvia analyze` interactively right after `init`, before manually gitignoring `.docuvia/`, will see a misleading "uncommitted changes" warning on every single run even with a perfectly clean source tree — worth a follow-up: either `init` should append `.docuvia/` to `.gitignore` itself, or `hasUncommittedChanges` should scope its check away from paths docuvia itself generates.

### 3.2 The post-commit hook works correctly (positive finding)

- `docuvia init` installs a fire-and-forget post-commit hook (`.git/hooks/post-commit`: `npx --no-install docuvia analyze > /dev/null 2>&1 &`) that silently re-runs Tier A's delta ingestion after every commit.
- Verified this actually fires and correctly advances `lastIngestedSourceSha` to the new HEAD without any manual `docuvia analyze` call — confirmed via `.docuvia/local.db`'s `docuvia_meta` table and the JSONL `analyze.log`.

### 3.3 Docuvia2 Tier B queue never populated — bugs #1 and #2, fixed 2026-07-29

- LSP binary resolution itself worked once `typescript-language-server` was made resolvable (unlike C#'s `csharp-ls`, which never resolved at all) — see [`lsp-binary-resolver-strategies.ts`](../../lib/core/src/lsp/lsp-binary-resolver-strategies.ts).
- **Bug #1**: `runFullIngestion` ([`run-full-ingestion.ts`](../../lib/ui-core/src/workflows/analyze/run-full-ingestion.ts)) never wrote to `tierBQueue` at all — no reference to it anywhere in the file.
- **Bug #2**: `classifyChangedFile` ([`run-delta-ingestion.ts:270`](../../lib/ui-core/src/workflows/analyze/run-delta-ingestion.ts)) permanently excluded `ADDED`-status files (`if (entry.status !== MODIFIED) return { contractChanged: false }`), so a new file's exports could never reach the semantic-diff comparison.
- **Fixed 2026-07-29**: `runFullIngestion` now queues every parsed file when a `headSha` exists (treats "no prior commit" as CONTRACT_CHANGED, same logic `resolvePruningLevel` already uses); `classifyChangedFile` now also classifies `ADDED` files by diffing against empty `oldContent`.
- **Correction (§3.7)**: bug #1's fix lives in `analyze`'s own empty-graph branch, not `docuvia init` — `init-workflow.ts` never calls `runFullIngestion` at all. Mostly harmless in practice since `init` stamps a source trailer that routes the next `analyze` through the (delta) path instead.

### 3.4 GitNexus: incremental update is ~10x slower than a full rebuild for a widely-imported file

- A 1-line uncommitted edit to `bind.decorator.ts` (imported, transitively, by 872 files per GitNexus's own BFS) triggered: `Incremental: changed=1, added=0, deleted=0 (skipping wipe + 2039 unchanged file rows preserved)` followed by `Incremental: +872 importer(s) added to writable set (BFS depth ≤ 4)` — i.e. the incremental path re-processes every transitive importer up to depth 4, not just the changed file.
- Measured: **1785.8s (≈29.8 min)** for this single-file incremental update, vs. **173.6s** for the full rebuild of the entire repo — an incremental update costing ~10x a full rebuild is a significant, reproducible finding (not an artifact of environment slowness alone, since it's 10x slower than GitNexus's _own_ full-build number measured minutes earlier on the same machine).
- Secondary finding: killing an in-flight `gitnexus analyze` mid-run (as happened accidentally while probing this) leaves an `incrementalInProgress` flag; the next run correctly detects this and self-heals via a forced full rebuild (229.5s) rather than continuing from a possibly-corrupt partial state — a real resilience feature, confirmed by direct (if accidental) reproduction.
- Practical implication: for a repo shaped like nest (a widely-fanned-in core file changing), GitNexus's post-commit-hook-style incremental re-indexing would be far more disruptive than Docuvia2's or even a full rebuild.

### 3.5 Graphify: CLI capability surface has grown significantly since the C# pass; `update`'s caching didn't shrink across a no-op re-run

- The 2026-07-24 C# report found Graphify had "no `build`/`extract`/`query`/`impact`/`explain` subcommand" and was Claude-Code-skill-only. That is **no longer accurate**: `graphify --help` now lists a real `extract <path> [--code-only]`, `query "<question>"`, `affected "X"`, `explain "X"`, `update <path>`, and `tree` (D3 collapsible-tree HTML export) — all standalone CLI commands, no Claude Code session required. This is a meaningful product change worth reflecting in any future comparison matrix defaults.
- `graphify update .`'s per-file cache didn't behave as a true incremental diff in this session: after a 1-line edit, 1,750/1,966 files were reported "uncached" (re-extracted); re-running `update` again immediately with **zero further changes** showed the identical 1,750-file "uncached" count rather than shrinking toward 0. Whether this is `update`'s intended semantics (e.g. a git-diff-based "changed since last commit" superset rather than a strict content-hash cache) or a cache-invalidation gap wasn't conclusively determined this session — flagged for follow-up rather than asserted as a bug.
- `graphify explain` produced the cleanest, most immediately useful single-symbol output of the three tools tested (a real degree count + full connection list, no truncation, sub-2s) — worth noting as a genuine strength for ad-hoc "what does this symbol touch" queries.

### 3.6 CRG (Code-Review-Graph): environment/dependency issues, ultimately N/A

- **Two missing dependencies found and fixed live**: `tree-sitter-language-pack` (a hard import-time dependency of `code_review_graph.parser` that isn't installed by a bare environment) and `python-igraph` (optional; its absence triggers what the 2026-07-24 C# report called "graceful degradation" to a slower pure-Python community-detection fallback). Both were `pip install`-able without incident.
- **Even after both fixes, `build --repo` never completed** against nest across 5 attempts (default, `--skip-flows`, `--skip-postprocess` — twice each for the latter two): raw AST parsing (1,746/1,746 files) consistently finished within each attempt's visible progress log (a few minutes in), but the run then stalled somewhere in `postprocessing.py`'s pipeline (`_compute_signatures` → `_rebuild_fts_index` → `_trace_flows` → `_detect_communities`) without further log output, for 20-30+ minutes before being killed.
- Ruled out as explanations: lock contention from an orphaned prior CRG process (none found — a `wmic`/CommandLine-substring search that appeared to find matches was actually matching the parent Claude Code process's own `--add-dir` argument list, a false positive); network hangs (no open sockets on the process); an interactive stdin prompt (no `input()`/confirm call exists on the `build` code path, confirmed by reading `cli.py`). CPU-time sampling on the stalled process showed only a few seconds of actual `UserModeTime` consumed across 5+ minutes of wall-clock — i.e. it was genuinely idle/blocked, not just slow, though the specific blocking call was not identified before the session owner directed marking this N/A rather than continuing to investigate.
- **Marked N/A for this pass** per explicit session-owner direction rather than continuing to retry indefinitely. A future session should either investigate `postprocessing.py`'s pipeline directly (e.g. instrument each of the 4 remaining steps with its own log line to isolate which one hangs) or test on a machine without whatever environmental factor is at play here.

### 3.7 Docuvia2 re-test (2026-07-29, follow-up): environment fix, ~13x speed swing, bug #3 found and fixed

Re-ran the Docuvia2 rows against the same `nest` clone (`dfaa3761`) to validate the §3.3 fixes. Found a real environment blocker, a large speed swing, and a third Tier B bug (now fixed).

- **Environment blocker (fixed, not a Docuvia2 bug)**: `better-sqlite3`'s native addon was built for an older Node ABI (`NODE_MODULE_VERSION 127`) than this machine's current Node v24 (`137`) — every DB command failed instantly. Fixed via `npm run build-release` inside the package (MSBuild/node-gyp). Anyone hitting an instant `local.db` open failure after a Node upgrade should rebuild `better-sqlite3` first.
- **Speed: ~307.3s → ~24s, same source, no code change (~13x)**. AST parse alone: 283.1s → 15.1s. Confirms the environment was the dominant factor, not architecture — **§3's WASM-vs-native cross-tool comparison is not trustworthy** without re-timing GitNexus/Graphify the same day (not done this pass).
  - Node count matched exactly (16,159 both times); edge count didn't (18,158 vs. 16,215, +12%). No intervening commit touches edge extraction — leading hypothesis is the original slow run silently dropped edges under resource pressure, not confirmed.
- **Tier B LSP mechanics now genuinely work — a first** (real `initialize` handshake + file processing, ~1.4s), unlike C#'s `csharp-ls` which never got past `initialize` in 30 minutes ([[csharp_lsp_tier_b_status]]). Caveat: `typescript-language-server` resolution is a **global** npm install from outside the target repo — the root devDependency added in the original session only helps when Docuvia2 analyzes _itself_, not an external repo like `nest`; it had to be reinstalled this session.
- **Bug #3, found and fixed**: `docuvia init` never wires Tier B at all (different function than the one §3.3 fixed — `init-workflow.ts` never calls `runFullIngestion`; usually harmless since `init` routes the next `analyze` through the fixed delta path). More importantly: a MODIFIED edit and an ADDED file, **both with a leading doc comment**, still produced `tierBQueued: 0` after the §3.3 fixes.
  - **Root cause**: `SemanticDiffDetector.getSmallestContainingNode()` ([`semantic-diff.ts:159`](../../lib/ast-core/src/detector/semantic-diff.ts)) required one AST child to fully contain the _entire_ changed-line range. A hunk that adds a blank line and/or doc comment before a new declaration (i.e. almost any hand-written, documented function) spans multiple top-level siblings — no single child qualifies, so matching bubbled up to the untyped `program` root and dead-ended, silently dropping the whole hunk. Confirmed by direct reproduction: a comment-free edit queued correctly; the identical edit with a leading doc comment did not.
  - **Fixed 2026-07-29**: added `resolveSpanningBoundaries()`, a fallback that only activates when the primary match dead-ends (finds no semantic ancestor) — it re-matches each overlapping top-level child against a range clamped to that child's own span, recovering the real semantic boundary. The existing full-containment path (used for e.g. multi-statement body edits bubbling up to their enclosing function) is untouched. 3 new regression tests added (`semantic-diff.test.ts`); full unit suite + `run-delta-ingestion`/`run-full-ingestion` tests pass.
  - **Deploy gotcha hit while verifying**: `@workspace/ast-core` ships as a pre-compiled `dist/` that the CLI's bundler resolves via `package.json`'s `main` field — rebuilding the CLI alone does _not_ pick up a `lib/ast-core/src` change. Must run `tsc -b` in `lib/ast-core` first, then rebuild the CLI.
  - **Re-verified against `nest`**: same MODIFIED + ADDED files that previously produced `tierBQueued: 0` now show `"queued 2 file(s) for Tier B"`, and `--escalate-to-lsp` drains both cleanly.
- **Read-path commands** (`query`/`impact`/`export-topology`/`clean`/`uninstall`) behaved identically, just faster (0.6-1.0s vs. 2.0-4.3s). New observation: on a husky-managed repo, `uninstall` empties hook files to 0 bytes rather than deleting them (not exercised against husky previously; not necessarily a bug).
- **Lesson for future sessions**: every failure this pass traced back to an environment gap (stale native module, unresolvable LSP binary) or a masked code bug — never to LSP/AST being inherently unworkable. Set up the environment correctly first; treat a "still broken" result after that as worth root-causing.
- **Housekeeping**: all test commits against `nest` were reset back to `dfaa3761` afterward; the pre-existing untracked `pnpm-workspace.yaml` was left untouched.
