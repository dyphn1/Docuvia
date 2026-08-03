# CLI Command Test Gaps & Concurrency Validation Analysis (2026-07-16)

> **Multi-Lateral Validation & Stress Test Results:**
> The team has completed comprehensive code walkthroughs, real SQLite / Git integration testing, and concurrency stress testing for all CLI commands.
> High-severity concurrency race conditions and exit-blocking bugs discovered previously (such as `init` migration conflicts, `sync` state clobbering, and the failure of `finally` cleanup on exit) have been fully resolved.
>
> To maintain directory hygiene and focus on core concerns, we have consolidated all commands' genuinely open issues (Confirmed — Open test gaps) into this single document. All other fully-resolved, non-open temporary logs and status files have been completely cleaned up.
>
> **Update (2026-07-17, PLAT-007 Slice 2 dispatch 2b):** the two command-pair concurrency gaps that gated the post-commit hook flip are now closed by real-CLI-process integration tests — `analyze`+`snapshot` (`artifacts/cli/test/integration/commands/analyze-snapshot-concurrency.test.ts`: 3+3 concurrent processes over a genuine delta ingestion, asserting exit codes, `PRAGMA integrity_check`, a single project row, and `git fsck` on the knowledge branch) and `doctor`+`hydrate` (`doctor-hydrate-concurrency.test.ts`: 3+3 concurrent processes, same DB-integrity assertions; `--skip-git` sidesteps only the remote-reachability probe, which touches neither the DB nor the knowledge lock). The status table below reflects this.

---

## 1. Status Summary

| Command           | Status      | Validation Summary & Fix Records                                                                                       |
| :---------------- | :---------- | :--------------------------------------------------------------------------------------------------------------------- |
| `init`            | ✅ Resolved | The single-flight concurrency lock has fully resolved database migration conflicts.                                    |
| `analyze`         | ✅ Resolved | Implemented LLM decision-extraction & markdown cleanup; resolved the exit-blocking bug.                                |
| `impact`          | ✅ Resolved | Added `console.log` assertions; SQL/LIKE injection defense design has been verified.                                   |
| `status`          | ✅ Resolved | Added `ui.header` assertions; switched `process.exit` to `process.exitCode`.                                           |
| `sync-knowledge`  | ✅ Resolved | Added fast-forward/push status assertions; resolved the exit-blocking bug.                                             |
| `clean`           | ⚠️ 1 Open   | Only the Windows `EBUSY` exception path has not been mock-triggered in unit tests.                                     |
| `doctor`          | ⚠️ 1 Open   | The hooks `fs.stat` failure branch is untested. Concurrent `doctor` + `hydrate`: ✅ covered (2026-07-17, dispatch 2b). |
| `export-topology` | ⚠️ 2 Open   | Embedded JSON data in HTML is never parsed/validated; `--out` as an existing file is untested.                         |
| `hydrate`         | ⚠️ 1 Open   | Lacks an idempotency short-circuit cache. Concurrency under `bulkLoadGraph`: ✅ covered (2026-07-17, dispatch 2b).     |
| `query`           | ⚠️ 3 Open   | Interactive TTY input & Ctrl+C paths are untested; prompt payload size lacks guardrails.                               |
| `review`          | ⚠️ 1 Open   | Large/binary file PR payloads have not been stress-tested.                                                             |
| `snapshot`        | ⚠️ 1 Open   | Read-only directory write failures (EACCES/EROFS) are untested.                                                        |
| `sync`            | ⚠️ 2 Open   | `readStdin()` is completely untested; invalid `commitSha` formats are untested.                                        |
| `uninstall`       | ⚠️ 1 Open   | Concurrency with DB writes during uninstall is untested.                                                               |

---

## 2. Confirmed — Open Issues

The following items are confirmed test gaps or open issues verified by the team. Future iterations should prioritize adding coverage for these execution paths:

### 2.1 Exception & Edge-Case Gaps

1. **Windows `EBUSY` File Locking Untested (`clean` & `uninstall`)**
   - **Description**: `clean-workflow.ts`'s `fs.unlink` throws `EBUSY` on Windows if the DB file is held by another process. While wrapped in a `try/catch` and mapped to a `DocuviaError`, this exception path has never been mock-triggered in unit tests.
2. **`doctor` Hooks File-Stat Rejection Untested**
   - **Description**: The `.catch(() => null)` block on `doctor.ts:92-93` is used to handle failure to stat hook files. However, `doctor.unit.test.ts` always mocks `fs.stat` to resolve successfully (`size: 100`), leaving the `DOCTOR_CLAUDE_NOT_FOUND` / `DOCTOR_CURSOR_NOT_FOUND` branches unexercised.
3. **`export-topology` `--out` as an Existing File**
   - **Description**: If the `--out` parameter points to an existing file instead of a directory, `fs.mkdirSync(outDir, { recursive: true })` throws an error. It is caught gracefully by the outer `try/catch` and fails the spinner, but no test covers this.
4. **`snapshot` Read-Only Directory Write Failure Untested**
   - **Description**: No test simulates a write failure (EACCES/EROFS) during the snapshot temp-dir render or the knowledge-branch pack step.
5. **`sync` Invalid Commit SHA Format Untested**
   - **Description**: The CLI forwards `commitSha` directly to the Git provider. If the format is invalid, it propagates to the generic catch block instead of crashing, but this is untested.

### 2.2 Integration & Data-Verification Gaps

1. **`export-topology` Embedded JSON Graph Data Never Verified**
   - **Description**: Existing tests only assert that the HTML output contains the `<!DOCTYPE html>` string. The embedded `var GRAPH = ...` JSON blob injected by `topology-html-template.ts` is never extracted or validated.
2. **`sync` `readStdin()` Untested**
   - **Description**: All tests in `sync.unit.test.ts` either pass a `commitSha` explicitly or hit the interactive TTY branch, leaving the piped Standard Input (`readStdin()`) logic completely untested.

### 2.3 Concurrency & Performance Defense Gaps

1. **Interactive TTY Input & Ctrl+C Untested (`query`)**
   - **Description**: The interactive input loop using `ui.askInput` (`query.ts:92-109`) and the Ctrl+C abort path are fully mocked out and never exercised.
2. **`query` Prompt Size Limit Defense Missing**
   - **Description**: `formatPromptOutput` has no truncation or size-capping guardrails for incoming/outgoing/l3 relationships. If a queried node has thousands of relationships, the prompt size could inflate uncontrollably.
3. **Repeated Queries Memory-Scope Cleanup Untested**
   - **Description**: Unlike `hydrate` or `impact` tests, `query.unit.test.ts` never spies on or validates `docuviaMemory.deleteScope` to ensure scope cleanup on success/failure.
4. **`hydrate` Idempotency Cache** _(concurrency half closed 2026-07-17, dispatch 2b)_
   - **Description**: `HydrationService.hydrate()` unconditionally reads git and runs `bulkLoadGraph` every call, lacking an already-up-to-date fast path. The concurrency half of this item — `bulkLoadGraph` under concurrent read-write opens — is now stress-tested by `doctor-hydrate-concurrency.test.ts` (3 concurrent `doctor --skip-git` + 3 concurrent `hydrate` real CLI processes, DB integrity asserted).

---

## 3. Supported Language CLI Benchmark Reports

To perform AST / Parser benchmarking and stress tests across all 11 supported languages in `Docuvia2`, the following benchmark execution reports have been created, each comparing Docuvia2 against GitNexus, Graphify, and Code-Review-Graph (CRG) on two real-world target repositories. Reports not yet marked ✅ are still empty shells (pending execution):

| Language       | Test Report File                                               | Target Project 1 (P1)              | Target Project 2 (P2)   | Status                                                            |
| :------------- | :------------------------------------------------------------- | :--------------------------------- | :---------------------- | :---------------------------------------------------------------- |
| **C**          | [`c-cli-benchmark.md`](./c-cli-benchmark.md)                   | `redis/redis`                      | `git/git`               | ⏳ Pending                                                        |
| **C++**        | [`cpp-cli-benchmark.md`](./cpp-cli-benchmark.md)               | `llvm/llvm-project`                | `tensorflow/tensorflow` | ⏳ Pending                                                        |
| **C#**         | [`csharp-cli-benchmark.md`](./csharp-cli-benchmark.md)         | `PowerShell/PowerShell`            | `dotnet/orleans`        | ✅ Completed (2026-07-24, no-LLM structural pass)                 |
| **Go**         | [`go-cli-benchmark.md`](./go-cli-benchmark.md)                 | `moby/moby`                        | `gin-gonic/gin`         | ✅ Completed (2026-08-03, no-LLM structural pass + Go LSP tested) |
| **Java**       | [`java-cli-benchmark.md`](./java-cli-benchmark.md)             | `spring-projects/spring-framework` | `google/guava`          | ⏳ Pending                                                        |
| **JavaScript** | [`javascript-cli-benchmark.md`](./javascript-cli-benchmark.md) | `facebook/react`                   | `expressjs/express`     | ⏳ Pending                                                        |
| **PHP**        | [`php-cli-benchmark.md`](./php-cli-benchmark.md)               | `laravel/framework`                | `WordPress/WordPress`   | ⏳ Pending                                                        |
| **Python**     | [`python-cli-benchmark.md`](./python-cli-benchmark.md)         | `django/django`                    | `fastapi/fastapi`       | ⏳ Pending                                                        |
| **Ruby**       | [`ruby-cli-benchmark.md`](./ruby-cli-benchmark.md)             | `rails/rails`                      | `discourse/discourse`   | ⏳ Pending                                                        |
| **Rust**       | [`rust-cli-benchmark.md`](./rust-cli-benchmark.md)             | `BurntSushi/ripgrep`               | `tauri-apps/tauri`      | ⏳ Pending                                                        |
| **TypeScript** | [`typescript-cli-benchmark.md`](./typescript-cli-benchmark.md) | `microsoft/vscode`                 | `nestjs/nest`           | 🟡 Partial (2026-07-29, nest done — vscode deferred)              |

### 3.1 C# Benchmark — Key Findings (2026-07-24)

Full detail: [`csharp-cli-benchmark.md`](./csharp-cli-benchmark.md). The LLM-gated surface (Docuvia2 L3 extraction, GitNexus `wiki`, Graphify's semantic layer) was explicitly skipped this pass — see that report's §4 for what a follow-up session still owes. Two findings stand out as worth prioritizing:

1. **`analyze`'s sha fast-path does not detect uncommitted working-tree edits.** A 1-line uncommitted change to a tracked file was invisible to `docuvia analyze` on both target repos ("already up to date with HEAD"), while GitNexus's mtime/hash-based check correctly detected the same edit. This matches the **documented** design in [PLAT-007](../gitbook/adr/platform/PLAT-007-tiered-background-knowledge-evolution.md) (Tier A's sha fast-path is intentional — it's what keeps the post-commit hook cheap), but the benchmark exposed a UX gap: when a human runs `docuvia analyze` manually (not via the git hook), there is no signal that uncommitted changes were skipped. Worth a follow-up: either a log/console note when the fast-path short-circuits with a dirty working tree, or explicit documentation in `analyze --help`.
2. **`impact`/blast-radius returns only 1 file for foundational symbols** (`PSCmdlet`, `IGrain`) where CRG's traversal surfaces hundreds-to-thousands. This matches the **documented** single-hop design in [IMPT-001](../gitbook/adr/impact/IMPT-001-sql-single-hop-blast-radius.md) (a deliberate fast heuristic filter, not the final word — see [IMPT-002](../gitbook/adr/impact/IMPT-002-lsp-for-absolute-quality.md)'s LSP escalation tier for the multi-hop-quality path). Since `--escalate-to-lsp` / Tier B wasn't exercised in this no-LLM-adjacent session, the benchmark cannot yet confirm whether LSP escalation closes this gap in practice — flagged as the natural next benchmark slice. `csharp-cli-benchmark.md` §3 now tracks the specific C# LSP blockers found (and one already fixed) toward that follow-up.
3. Minor: `docuvia uninstall` still leaves `.docuvia/` and the hidden `docuvia-knowledge` branch behind (manual `git branch -D` required); `export-topology`'s default `--collapse` setting undersells graph density (0 links shown until `--collapse=symbol` is passed).
   > **Fixed (2026-07-24, same-day follow-up):** `uninstall` now deletes the `docuvia-knowledge` branch (`IGitProvider.deleteBranch` → `IKnowledgeGitService.deleteKnowledgeBranch`) and wholesale-removes `.docuvia/` (`removeDocuviaDataDir`), both gated by `--keep-db` alongside `local.db`'s own removal — see [`uninstall`'s execution-flow doc](../gitbook/workflows/uninstall-execution-flow.md). `export-topology`'s collapsed view now reports the folded-away relationship count (`stats.foldedLinkCount`) in the CLI success message instead of silently showing a low link count with no explanation — see `TopologyBuilderService`.

### 3.2 TypeScript Benchmark — Key Findings (2026-07-28/29, `nest` only)

Full detail: [`typescript-cli-benchmark.md`](./typescript-cli-benchmark.md). `nestjs/nest` is complete for Docuvia2, Docuvia2 (+LSP), GitNexus, and Graphify; `microsoft/vscode` was deferred to a follow-up session given how much slower this environment ran than the 2026-07-24 C# session (see that report's status note); CRG is N/A this pass (build never finished post-processing even after fixing two missing dependencies). Standout findings:

1. **Root-caused the C# session's "dirty worktree" UX-gap fix, and found the actual mechanism underneath it.** `hasUncommittedChanges()` is a blanket `git status --porcelain` with no path scoping, and `docuvia init` never gitignores its own `.docuvia/`/`.claude/hooks/` — so a freshly-`init`'d repo reads as permanently dirty to that check until the user manually gitignores those paths. Reproduced directly (dirty-message vs. clean-message, isolating `.gitignore` coverage as the only variable). Doesn't block real ingestion — the post-commit hook fires and correctly ingests commits regardless (confirmed via `docuvia_meta`'s `lastIngestedSourceSha` advancing correctly) — but does mean an interactive `docuvia analyze` run right after `init` will show a misleading "uncommitted changes" warning on an otherwise-clean tree. Worth a follow-up: `init` should gitignore its own artifacts, or the check should exclude paths docuvia itself generates.
2. **Docuvia2 Tier B (`--escalate-to-lsp`) had two structural bugs, both fixed same-day.** Fixed `typescript-language-server` resolvability this session (was blocked, same class of issue as C#'s `csharp-ls`), but Tier B's queue stayed empty regardless. Root-caused via code read (2026-07-29 follow-up): (a) `runFullIngestion` — the path `docuvia init` and the first-ever `analyze` use — never wired up the Tier B queue at all, so a fresh repo's baseline ingestion could never seed it; (b) the delta-path classifier permanently excluded newly-**added** files (only in-place modifications to already-tracked files were ever considered), so a brand-new file's exports could never trigger escalation on any later run either. Both fixed: full ingestion now queues every parsed file when a commit sha is available; the delta classifier now diffs added files against an empty baseline, reusing the existing per-node "no matching old node → contract changed" logic unchanged.
3. **GitNexus's incremental update can cost ~10x a full rebuild.** A 1-line edit to a file imported by 872 other files (transitively, BFS depth ≤ 4) took **29.8 minutes** incrementally vs. **173.6s** for a full rebuild of the whole repo — GitNexus's incremental path re-processes every transitive importer, not just the changed file. This is a reproducible, same-session, same-machine 10x delta, not an artifact of general environment slowness. Positive side-finding: an interrupted `analyze` run is detected and self-healed via a forced full rebuild on the next run, rather than leaving a corrupt index.
4. **Graphify's CLI has grown a real standalone command surface** (`extract`/`query`/`affected`/`explain`/`update`/`tree`) since the C# pass, when it was skill-only beyond bare AST extraction — worth updating any future default benchmark plan to reflect this. Its `update` command's per-file cache also didn't shrink across a repeated no-op re-run in this session's testing (flagged, not confirmed as a bug).
5. **CRG's `build` never completed post-processing against `nest`** across 5 attempts (~20-30 min each) even after fixing two missing dependencies (`tree-sitter-language-pack`, `python-igraph`) live — raw parsing finished every time, but the signatures/FTS/flows/communities pipeline stalled with the process going genuinely idle (near-zero CPU time consumed) rather than just slow. Root cause not identified; flagged for a follow-up session, possibly on a different machine.

### 3.3 Go Benchmark — Key Findings (2026-08-03, both `moby` and `gin` complete)

Full detail: [`go-cli-benchmark.md`](./go-cli-benchmark.md). Both target projects complete for all four tools; Docuvia2's Tier B (`--escalate-to-lsp`) was exercised against `gin` with a real `gopls`, then deliberately not re-run against `moby` once it proved broken (see that report's §1 scope note). All four tools were built from an isolated `git worktree` per tool rather than the primary dev checkouts. Standout findings:

1. **Docuvia2's Tier B (LSP escalation) is effectively non-functional for Go.** Against `gin`, `gopls` resolved fine per `doctor`, but the actual escalation batch failed on 95/98 files with gopls's own `"no identifier found"` error (2 more timed out during gopls's initial workspace load) — only 3/98 processed, 0 corrected edges applied. Root-caused to [`lsp-edge-provider-base.ts:663-669`](../../lib/core/src/lsp/lsp-edge-provider-base.ts) issuing `textDocument/references` at `symbol.selectionRange.start` from `documentSymbol`'s response — a systemic position/response-shape mismatch with gopls specifically, not occasional bad luck. Distinct from the pre-existing GRPH-006 `supportsQualifiedContainment` gap (that one never even became observable, since this bug sits upstream of it). Not yet fixed — flagged as a concrete follow-up.
2. **A same-day, two-repo reproduction of the git-knowledge-branch pack-step crash first seen on `vscode` (§3.2 above's Docuvia2 rows link this, but the crash itself is TypeScript-pass-adjacent, not Go-specific).** `docuvia init` against `moby` crashed (`Error: write EOF`) at the identical pack step, after Tier A ingestion (136,329 nodes / 157,139 edges) had already completed and persisted successfully. Now 2-for-2 on every repo tested above ~130K nodes across both the TypeScript and Go passes — worth prioritizing as a root-cause target given the repeat.
3. **Symbol-name ambiguity, stress-tested harder than any prior pass, broke 3 of the 4 tools at least once.** `moby`'s `Container` (6 separate `type Container struct` declarations, 5 in `vendor/`) is a deliberately harder collision test than `vscode`'s `Disposable` or `nest`'s `Injectable`. Graphify's `query`/`explain` each silently resolved the bare label to a _different wrong_ node (neither the real struct) with no ambiguity signal at all — a correctness gap, not just a UX one. CRG surfaced the ambiguity explicitly (good), but its capped, apparently-alphabetical 20-candidate disambiguation list didn't even include the real, most-connected match — only `search`'s FTS ranking found it. Only Docuvia2's single-hop resolution and GitNexus's BM25 query avoided returning a wrong answer outright (at the cost of thin/loose results respectively).
4. **CRG appears to exclude Go's `vendor/` by default; the other three tools don't.** CRG parsed 2,340 files against `moby` (matching the first-party-only count almost exactly); Docuvia2, GitNexus, and Graphify all clearly processed vendored code too (Graphify's own log explicitly lists `vendor/…` paths). Not confirmed against CRG's source this pass, but a real, previously-undocumented cross-tool scope difference — CRG's smaller graph and faster build partly reflect indexing ~4.5x less code, not a pure speed advantage.
5. **GitNexus's self-reported build latency understated real wall-clock by ~1.9-2.1x on both repos** (`gin`: 132.9s reported vs. 278.3s measured; `moby`: 209.6s reported vs. 395.5s measured) — a consistent, reproducible gap this pass, unlike the TypeScript pass where self-reported and measured numbers were close. The extra time happens after the tool's own "indexed successfully" log line and before process exit; not yet isolated to a specific step.
6. **A new Docuvia2 scale bug**: `git ls-files -s` hit Node's `maxBuffer` cap (hardcoded 10MB at [`git-local-provider.ts:490`](../../lib/git-local/src/git-local-provider.ts), vs. 64MB at two other call sites in the same file) against `moby`'s 13,121 tracked files — caught gracefully with a fallback to manual globbing, not a crash, but looks like an oversight rather than a deliberate smaller cap.
7. **Docuvia2's `export-topology --collapse=auto` degenerates to `Links: 1`** on `moby`'s 157,139-edge graph (vs. correctly showing all links with `--collapse=symbol`) — a new, much-larger-repo-specific edge case in the folding heuristic, distinct from the already-fixed "0 links, no explanation" bug from the C# pass (which still holds fixed).

---

## 4. Cross-Tool Findings (from language benchmark passes)

General product/tool behaviors discovered while running per-language benchmarks — not specific to any one language, so they live here instead of in each language's report. Expected to hold for future passes (Go, Java, Python, etc.) unless a language-specific override shows up in that language's own report.

### 4.1 Docuvia2

- L3 decision extraction is gated by `AI_DOCUVIA_INTEGRATIONS_OPENAI_BASE_URL` + `AI_DOCUVIA_MODEL`/`AI_DOCUVIA_FAST_MODEL` (**not** `ANTHROPIC_API_KEY` — corrects an earlier note) — see `resolveAnalyzeLlmConfig` in [`analyze.ts`](../../artifacts/cli/src/commands/analyze.ts). Degrades gracefully to 0 L3 decisions with no errors when unset.
- `query`'s structural context used to conflate a symbol's own containing file with a real "incoming caller": `getIncomingEdges`/`getOutgoingEdges` never surfaced the actual relationship type (`calls`/`implements`/`extends`) and never excluded `contains` edges. **Fixed 2026-07-24**: edges are now labeled by their real relationship type, `contains` is excluded, and `<l2_module>` gained `type`/`file` attributes instead of being an empty shell.
- `uninstall` didn't fully clean up on its own — git hooks were emptied but `.docuvia/` and the hidden `docuvia-knowledge` branch survived, needing a manual `git branch -D`. **Fixed 2026-07-24**: see the "Fixed" note under §3.1 item 3 above.
- `export-topology`'s default `--collapse` setting undersold graph density (could silently show 0 links). **Fixed 2026-07-24**: see the same "Fixed" note above (`stats.foldedLinkCount`).
- **Retested 2026-07-24** against `PowerShell/PowerShell` and confirmed all three fixes above hold under real CLI runs:
  - `query "PSCmdlet" --format=prompt` → `<l2_module>` now carries `type`/`file`, and `<incoming>` returned **128 real `extends` relationships** instead of the old single fake "containing file" edge.
  - `export-topology` (default `--collapse=auto`) → reports `1275 nodes, 797 links, 22 groups, collapsed — 847 more relationship(s) folded...` instead of a silent "0 links" undercount.
  - `uninstall` → default run deleted the hidden branch and removed `.docuvia/`; `--keep-db` correctly skipped both, removing only git hooks.
- SQLite edge counts: `sqlite3` CLI isn't installed in this benchmarking environment — query the `node_links` table via `python -c "import sqlite3; ..."` instead when `docuvia status` doesn't report edges.

### 4.2 GitNexus

- Plain `gitnexus analyze` (no `--skills`) already installs skill files under `.claude/skills/gitnexus/*` and appends a generated section to `AGENTS.md`/`CLAUDE.md` **by default** — avoiding this needs `--index-only` (or `--skip-skills` + `--skip-agents-md` together).
- If the target repo already ships a real `AGENTS.md` (e.g. `dotnet/orleans`), GitNexus appends into it rather than creating a new file — restoring the original requires `git checkout -- AGENTS.md`, not a delete.
- GitNexus keeps a **global** cross-repo registry (`~/.gitnexus/registry.json`), unlike Docuvia2/CRG's per-repo model — bare `query`/`impact`/`context` fail with "Multiple repositories indexed" once several repos have been registered, unless `-r <name>` is passed.
- Its mtime/hash-based incremental check correctly detects uncommitted edits that Docuvia2's git-HEAD-based check misses — a genuine capability edge — but this didn't translate into a latency win in this pass (incremental re-run ≈ full-build cost, ~72s vs ~65s).
- Ambiguous bare names (e.g. two candidates resolving to the same query) return an explicit `"ambiguous"` status with disambiguation candidates, similar to how CRG's `query` falls back on bare names.
- No CLI-level visual-export command exists — visual output is only reachable via `gitnexus serve`'s web UI.
- `wiki` generation needs an LLM (`GITNEXUS_API_KEY`/`OPENAI_API_KEY`, or `--provider claude` to shell out to an already-installed `claude` CLI with no separate key).
- **Self-reported build latency can understate real wall-clock by ~2x** — first observed in the Go pass (§3.3 item 5: `gin` and `moby` both showed a ~1.9-2.1x gap between the tool's own printed `"indexed successfully (Ns)"` line and directly-measured process wall-clock), unlike the TypeScript pass where the two numbers were close. **Always measure independently** (wrap the command, don't trust the printed number) — this doc's own verify-before-claim norm, now with a concrete counter-example to point at.

### 4.3 Graphify

- The installed `graphify` CLI has **no** `build`/`extract`/`query`/`impact`/`explain` subcommand — only `install`, `vscode install`, `benchmark`, `hook install|uninstall|status`, and `claude install|uninstall` (confirmed via `graphify --help`).
- Everything resembling a CLI in earlier benchmark plans (`extract <path>`, `query`, `path`, `explain`) is actually defined in [`graphify/skill.md`](../../../graphify/graphify/skill.md), meant to be executed by Claude Code itself (dispatching semantic-extraction subagents) via `/graphify` — it's a Claude Code skill, not an independent CLI tool.
- The one genuinely deterministic, LLM-free, standalone entry point is the structural layer: `python -m graphify.extract <path>` (tree-sitter AST + same-file call graph). This excludes cross-file semantic merging, community detection, wiki, and visual export.
- Side effect: even the bare structural pass writes a per-file SHA256 cache under `<repo>/graphify-out/cache/*.json` directly into the target repo.

### 4.4 Code-Review-Graph (CRG)

- No new findings in the C# pass (unchanged from the 2026-07-23 baseline): zero crashes, well-formed JSON envelopes, sub-linear build scaling, graceful `igraph`-missing degradation, `update`'s base-diff incremental semantics, `query`'s ambiguous-name fallback vs. `search`'s reliable FTS ranking.

### 4.5 Cross-Language Symbol Resolution: Is a Full LSP (or Any Off-the-Shelf System) the Right Approach? (2026-07-29)

Not language-specific — surfaced while root-causing C#'s Tier B (full detail: [`csharp-cli-benchmark.md`](./csharp-cli-benchmark.md) §3), but the conclusion applies to any heavyweight-workspace language (Java/Rust/C++ predicted to hit the same wall).

- **Full LSP is the wrong architecture for heavyweight-workspace languages.** `textDocument/references` forces a whole-solution semantic load regardless of whether the server process is spawned fresh or kept warm — a persistent/session-long server fixes the fixed cold-start cost, not the per-query cost.
- **No off-the-shelf system solves this better — checked, not assumed.** GitNexus (`gitnexus/src/core/ingestion/{call,import,class}-extractors/configs/csharp.ts`) and CRG (`code_review_graph/parser.py`: generic `tree-sitter`/`tree-sitter-language-pack` + hand-written C# node-type rules) both independently hand-roll their own per-language resolver — neither uses an off-the-shelf semantic-resolution library either.
- **Closest real candidate: [Joern](https://github.com/joernio/joern)** (3k stars, actively maintained, "fuzzy" parsing that doesn't need a working build). But its C# frontend (`csharpsrc2cpg`) isn't in the "Very High" maturity tier C/C++/Java get, has an open issue on exactly the calls/fields-chain problem ([#4375](https://github.com/joernio/joern/issues/4375)), and adopting it means a JVM/Scala runtime dependency Docuvia doesn't currently carry.
- **Best verified prior art for in-process, no-build resolution**: [codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp) — verified by reading `internal/cbm/lsp/cs_lsp.c` (3,045 lines), not its README: zero references to csproj/sln/msbuild/dotnet, zero subprocess spawns. Two-phase design (build a read-only project-wide symbol registry once, then per-file forward resolution), graded confidence per resolution strategy.
- **Conclusion**: build a native, in-process, per-language resolver (same shape GitNexus/CRG already converged on independently) rather than a full LSP or an external system.
