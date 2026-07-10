# Docuvia CLI — Command-by-Command Audit vs. GitNexus (2026-07-10)

> **Status:** Findings-only audit. Not yet triaged into the roadmap/gap registry (see [`README.md`](README.md) / [`../gitbook/analysis/README.md`](../gitbook/analysis/README.md) for how competitor gaps get tracked long-term).

## Methodology

- **Target under test**: `@workspace/cli` (`docuvia`), invoked via `tsx artifacts/cli/src/cli.ts` (there is no build step — `bin.docuvia` points directly at the `.ts` entry).
- **Test project**: `hermes-agent` (`D:\GitHub\miya.daniel\hermes-agent`), a real, external, 5,900+ file mixed Python/JS/TS monorepo — chosen specifically because it is _not_ Docuvia itself, to catch assumptions baked in from developing against a single, familiar TS codebase.
- **Baseline**: `gitnexus@1.6.9` (globally installed), run against the same `hermes-agent` checkout, same commit.
- **Every finding below is sourced from either direct CLI output or reading the exact line of source it comes from — no finding is speculative.**
- Environment: Windows 11, Node v22.18.0, pnpm 9.15.9.
- Test artifacts created in `hermes-agent` (`.docuvia/`, `.cursor/`, hooks, orphan branch, global `claude_desktop_config.json` entry) have been reverted; `hermes-agent` and the global Claude config are back to their pre-test state.

Severity key: 🔴 High (breaks core usage or silently loses/fakes data) · 🟡 Medium (wrong output in common paths) · 🟢 Low (noise/UX/documentation).

---

## Update — 2026-07-10 (post-audit follow-up)

### ✅ Resolved: `docuvia init` dishonest success reporting (was 🔴, first bullet of the `docuvia init` section below)

Implemented per [`docs/ai_plans/fix_init_honest_reporting.md`](../ai_plans/fix_init_honest_reporting.md): `AstWorkerPool` now attributes a crash to the specific in-flight file (`AstWorkerCrashError` + `taskFilePaths` tracking, no leak on either the success or crash path); `AstProcessingService.processFiles()` returns `{ parsed, failures }` instead of silently dropping failed files; `InitService.init()` returns honest `filesRequested`/`filesParsed`/`filesFailed`/`partialFailure` counts instead of an unconditional `"Project initialized successfully"`; a persisted `.docuvia/logs/init.log` (JSONL: `init.start` / `init.parse_failure` / `init.summary`) now exists so a human or AI agent can verify what happened after the fact instead of trusting a vanished terminal message; `docuvia snapshot` (same underlying pipeline, same symptom in this audit) was fixed in the same pass. Also fixed as a prerequisite: the cross-cutting `pino-pretty`/`tsx` startup crash (`logger.ts`), which previously prevented any of this logging from being reachable outside the `NODE_ENV=production` workaround.

Re-tested against the same `hermes-agent` checkout used in this audit (see finding below) — the honest counts now correctly show `filesRequested: 4236, filesParsed: 4236, filesFailed: 0` even in a run that hit the exact same 13 worker-crash symptom documented below, because our tests independently confirm `filesParsed + filesFailed === filesRequested` always holds. Not part of this fix: the other stubbed commands (`review`, `sync`, `analyze <path>`), `export --topology`'s zero-link default, `query`'s thin result, and `init`'s undocumented global-config/hook side effects — all still open, see their sections below.

### ✅ Resolved: `AstWorkerPool` "13 crashes" were never crashes — `pool.terminate()` was being misreported

Initial re-testing of the fix above still showed the same **13 `AstWorkerPool` crash log lines** from the original audit, so this was tracked as a new, undiagnosed finding (spawn-time worker failures). Root-causing it further overturned that framing entirely:

- Adding `{taskId, filePath}` attribution to the crash log first showed all 13 events had no in-flight task (`hadInFlightTask: false`) — consistent with a spawn-time race, so a spawn-serialization queue (`AstWorkerPool.enqueueSpawn`/`spawnChain`) was added to stagger worker creation. **This made no measurable difference** — the same 13 events recurred, still tightly clustered in time, even with spawns fully serialized and staggered.
- Re-examining the log position revealed the actual mechanism: `AstProcessingService.processFiles()` calls `pool.terminate()` unconditionally at the end of every run (or immediately, if the git-hash delta check finds zero files needing parsing — reproduced with an empty file list too). `pool.terminate()` calls `worker.terminate()` on every still-alive worker.
- **Directly verified with an isolated repro** (`new Worker(...)`, no task ever sent, `await worker.terminate()`): Node reports this as `exit` code `1`, even though nothing went wrong. `AstWorkerPool`'s existing `worker.on("exit", (code) => { if (code !== 0) handleError(...) })` treated _any_ non-zero exit as a crash, with no check for whether the pool was already shutting down intentionally.
- `os.cpus().length - 1` on the test machine is exactly **13** — meaning every single run, all 13 pool workers (still alive/idle when `terminate()` fires) were self-reporting as "crashed," 100% of the time, unrelated to file content, spawn timing, or task volume. This is the entire explanation for the original audit's "13 reproducible `AstWorkerPool` crashes" finding.

**Fix** (`ast-worker-pool.ts`, `handleError`): check `this.shuttingDown` before classifying an exit as a crash; if the pool is already tearing down, log at `debug` ("AST worker exited during pool shutdown (expected)") instead of `error` ("AST worker crashed/exited"). Re-verified against the same `hermes-agent` checkout (fresh index, no cache): **zero crash log lines**, `filesRequested: 4236, filesParsed: 4236, filesFailed: 0`. The spawn-serialization queue was kept (cheap, harmless structural safeguard against a literal synchronous spawn burst) but its artificial stagger delay was removed after confirming it contributed nothing — a 0ms/150ms A-B comparison against the same 4,236-file scan showed identical results either way. New regression test: `ast-worker-pool.unit.test.ts` → `"does not log idle workers stopped by terminate() as crashes"`.

This also means the `docuvia snapshot`/`init` runtime was never actually losing data or crashing during real parsing work — the entire "13 crashes" signal was a false alarm from imprecise exit-code handling in normal shutdown, not a parsing pipeline defect. The `filesFailed` honesty fix above remains correct and necessary regardless (it now correctly reports 0 failures instead of an unconditional "success" string), but the worker-crash noise it was designed to make visible turned out not to represent real crashes at all.

### ⚠️ Still open: `init`'s full CLI flow (agent-integration side effects) not re-verified this session

All re-testing above was done by calling `InitService.init()` directly (the same code path as `runDatabaseInit()` in `artifacts/cli/src/commands/init.ts`), deliberately bypassing `configureAgentIntegrations()` — the second phase of `docuvia init` that writes `.cursor/`, `.claude/`, `.windsurfrules`, `.cursorrules`, `llms.txt`, and (for non-TTY invocations) the **machine-global** `claude_desktop_config.json`. That side-effect surface, and the "silently writes 8 tool integrations + one global file, undocumented, no opt-out flag" finding from the original audit (`docuvia init` section, third bullet), is **unchanged and still open** — not addressed by either fix in this update. A full end-to-end `docuvia init` run (not just `InitService.init()` in isolation) has not been re-verified since these fixes landed.

### 📊 Re-measured coverage vs. GitNexus, post-fix (same `hermes-agent` checkout)

With the fixes above applied, rebuilt the index from scratch (`rm -rf .docuvia`, fresh `InitService.init()` run) and queried `.docuvia/local.db` directly rather than trusting a printed summary:

|                      | Docuvia `init` (post-fix, this run) | GitNexus (original audit, `analyze --force`) | Ratio |
| -------------------- | ----------------------------------- | -------------------------------------------- | ----- |
| Files                | 4,236                               | 5,938 (explicitly skips 9 files >512KB)      | 71%   |
| Nodes (`l2_nodes`)   | 84,380                              | 152,049                                      | 56%   |
| Edges (`node_links`) | 123,916                             | 283,552                                      | 44%   |

**Unchanged from the original audit** — this fix touched crash-reporting/shutdown-logging only, not file discovery or graph extraction, so these counts match the pre-fix numbers almost exactly (84,380 nodes then and now; 123,916 links matches the original audit's `export --topology --collapse=symbol` figure).

**What the fix actually changes about these numbers**: before, every run also logged 13 "AstWorkerPool crashed" events, so there was no way to know whether the 71%/56%/44% gap partly reflected data silently dropped by those crashes on top of a real coverage gap. Now confirmed via `filesRequested === filesParsed` (4,236 = 4,236, 0 failures) and zero crash log lines that nothing was being silently lost — the entire gap vs. GitNexus is a genuine coverage/extraction-depth difference, not crash-related data loss.

**Not yet investigated** — root cause of the gap itself:

- Why file discovery finds ~1,700 fewer files than GitNexus (extension coverage? `.gitignore` handling? no oversized-file skip-list like GitNexus's explicit 9-file report?) — `file-discovery.service.ts` not audited this session.
- Why node/edge extraction density is lower per file than GitNexus's (symbol-extraction granularity, language/grammar coverage gaps in `lib/ast-core`'s tree-sitter providers) — not investigated this session.

---

## Update — 2026-07-10 (root-cause investigation + fix plan)

### ✅ Root causes found for both open items above

Investigated by diffing Docuvia's language registry (`lib/plugins-ast/src/languages/*.ts`) directly against the installed `gitnexus@1.6.9` package's own extension map (`.../npm/node_modules/gitnexus/dist/_shared/language-detection.js`), and by tracing the actual `init`/`snapshot` code path (`lib/core/src/workers/ast-worker.ts`, confirmed as the real consumer per `fix_init_honest_reporting.md`'s call-graph tracing — **not** `lib/ast-core`'s `AstTraverser`/`generateAst`, which turned out to be used only by `lib/headless-lsp`'s hover provider, a red herring for this specific gap).

**File-discovery gap (71% ratio)**: Docuvia is missing `.mjs`/`.cjs` (JavaScript), `.mts`/`.cts` (TypeScript), and `.cu`/`.cuh` (C++) — extensions using grammars Docuvia already has, just not mapped to them — plus extensionless Ruby files (`Rakefile`, `Gemfile`, etc., which `isSupportedSourceFile()` structurally can't match since it's purely `path.extname()`-based). Also confirmed Docuvia has no oversized-file skip-list at all (GitNexus explicitly skips + reports 9 files >512KB; Docuvia has no size check anywhere in `file-discovery.service.ts`), so the two counts aren't even measuring the same thing today.

**Node/edge density gap (56%/44% ratios)**: contrary to an initial hypothesis (that `extractImplements`/`extractExtends` were unwired — true, but in the `headless-lsp` path only, which doesn't affect these numbers), the real, sourced gap is that TypeScript's and JavaScript's `LanguageConfig.classes`/`.functions` node-type lists (`lib/plugins-ast/src/languages/typescript.ts`, `javascript.ts`) are narrower than every other language in the same registry — Java/C#/PHP/Rust/C/C++ all already treat their `interface`/`enum`/`struct`/`trait` constructs as class-like nodes, but TypeScript's `classes` list has only `class_declaration`. More significantly, **TS/JS `functions` only matches `function_declaration`/`method_definition`** — arrow functions and function expressions (`const foo = () => {}`, ubiquitous in modern JS/TS) are entirely invisible to the extractor. Since `hermes-agent` is a Python/JS/TS repo, this is a plausible dominant contributor to the density gap.

Full root-cause writeup, decision points, and a bounded implementation plan (file-discovery extensions + oversized-file reporting + TS/JS symbol-kind broadening + an anonymous-callable naming fix needed to make the broadening safe): [`docs/ai_plans/improve_index_coverage_vs_gitnexus.md`](../ai_plans/improve_index_coverage_vs_gitnexus.md).

**Explicitly deferred** (see that plan's non-goals section): new language grammars (Kotlin/Swift/Dart/Vue/Cobol), matching GitNexus's full relationship-type breadth (`HAS_METHOD`/`HAS_PROPERTY`/`METHOD_OVERRIDES`/`ACCESSES`/`INJECTS`), fixing the separately pre-existing broken compiled-query strings (`provider.initQueries()` is deliberately bypassed today per a standing comment in `ast-worker.ts`), and wiring `extractImplements`/`extractExtends` into the `headless-lsp` hover path (real gap, but doesn't move the audited `init`/`snapshot` numbers).

---

## Cross-cutting issue (affects every command)

### 🔴 CLI cannot start outside `NODE_ENV=production`

Every `docuvia` invocation — including running it with no arguments to print usage — throws before doing anything:

```
Error: unable to determine transport target for "pino-pretty"
    at fixTarget (...\pino\lib\transport.js:160:13)
    at ...\lib\core\src\utils\logger.ts:6:23
```

- **Source**: `lib/core/src/utils/logger.ts:31-39` — the `pino` logger unconditionally requests the `pino-pretty` transport whenever `NODE_ENV !== "production"`.
- **Root cause**: `pino-pretty` is loaded via a worker thread inside `pino`; that worker's module resolution fails under `tsx`'s ESM loader.
- **Reproduced from Docuvia's own repo root, not just from `hermes-agent`** — this is not a "running against a foreign project" issue, it's the CLI's default developer experience being broken.
- **Workaround used for the rest of this audit**: `NODE_ENV=production docuvia ...`. This suppresses the crash but also disables pretty/colorized logging entirely — every command below therefore prints raw `pino` JSON lines interleaved with the CLI's own ANSI-colored status messages (see individual command sections).
- **Recommendation**: Either fix the transport resolution under `tsx` (e.g. resolve `pino-pretty`'s absolute path explicitly instead of relying on worker-thread module resolution), or gate pretty-printing behind an explicit flag/env var that defaults to _off_ so a broken optional dependency can't take down the whole CLI.

---

## `docuvia init`

**Purpose** (per `docs/gitbook/packages/cli.md`): initialize `.docuvia/local.db`, install MCP server config + hooks for AI coding assistants.

**What actually happened** running `docuvia init` in `hermes-agent`:

- 🔴 **13 reproducible `AstWorkerPool` crashes** during the initial AST scan of 4,236 discovered files:
  ```
  [AstWorkerPool] Worker crashed/exited: Error: Worker exited with code 1
      at ...\lib\core\src\services\ast-worker-pool.ts:100:35
  ```
  `handleError` (`ast-worker-pool.ts:65-101`) logs the generic exit code and respawns the worker, but never records _which file_ was being parsed when the worker died, and never surfaces a final "N files failed to parse" count. The command still ends with `✔ Project initialized successfully` — a user has no way to know indexing was incomplete. Reproduced identically on a second, independent run (during `clean` testing).
- 🟢 **Un-gated log noise**: `[LanguageRegistry] Could not read D:\...\hermes-agent\languages.toml, falling back to defaults` is printed **once per worker** (13×) via a bare `console.debug` call (`lib/ast-core/src/language-registry.ts:69`) that ignores `LOG_LEVEL`. Since `languages.toml` is an optional per-project override file that essentially no project ships, this fires on nearly every `init`/`analyze`/`snapshot` run against any real project.
- 🔴 **Side effects extend beyond the target repository, undocumented**: in addition to the documented `.docuvia/local.db`, `init` also wrote, without any flag or prompt:
  - `hermes-agent/.cursor/hooks/*`, `hermes-agent/.cursor/mcp.json`
  - `hermes-agent/.claude/hooks/hooks.json` (+ `docuvia-hook.js`)
  - `hermes-agent/.github/copilot-instructions.md`
  - `hermes-agent/.windsurfrules`, `hermes-agent/.cursorrules`, `hermes-agent/llms.txt`
  - `hermes-agent/.git/hooks/post-commit` (fires `docuvia snapshot` in the background on every commit)
  - **A global, cross-project file**: `C:\Users\<user>\AppData\Roaming\Claude\claude_desktop_config.json` — this file is not scoped to `hermes-agent` at all; it affects every Claude Desktop session on the machine.
  - An **append to a pre-existing, untracked `hermes-agent/CLAUDE.md`** (delimited by `<!-- docuvia:start/end -->`, which at least makes it mechanically reversible — the one thing done right here) without checking whether that file was hand-authored.
  - `docs/gitbook/packages/cli.md` describes this only as "installs MCP server config + hooks for AI coding assistants" — the actual blast radius (8 tool integrations + one machine-global config file) is far larger than the one-line description suggests.
- **Recommendation**: Document every file `init` touches (including the global Claude Desktop config path) up front, and require an explicit flag (e.g. `--integrations` or `--global`) to opt into the global config write — a per-repo `init` silently mutating shared, cross-project machine state is a surprising default.

---

## `docuvia analyze [path]`

**Purpose**: scan the workspace; with a `[path]` argument, scope L3 "decision" extraction to that file/directory.

- **No-path form** (`docuvia analyze`, full workspace scan): works, subject to the same 🔴 worker-crash issue documented under `init` above (same code path, `AstWorkerPool`).
- 🔴 **Path form is a hardcoded stub, not real extraction.** `docuvia analyze agent` against `hermes-agent/agent/` printed:
  ```
  ✔ Extraction complete
  ℹ - Extracted sample decision 1
  ℹ - Extracted sample decision 2
  ```
  This is **not derived from the target content in any way**. Source:
  ```ts
  // lib/core/src/services/extract-service.ts:20-21
  // STUB implementation matching the fake logic
  return { decisions: ["Extracted sample decision 1", "Extracted sample decision 2"] };
  ```
  It returns the identical two strings for _any_ path, including paths with zero decision-worthy content. Nothing in the CLI output indicates this is a stub — `✔ Extraction complete` reads as a genuine success.
- **Recommendation**: Either implement `ExtractService.extractDecisions`, or make the CLI print an explicit `(not yet implemented)` notice instead of a green checkmark and fabricated results. Shipping a stub indistinguishable from a real result is worse than not shipping the flag at all.

---

## `docuvia status`

**Purpose**: report local index health (project count, L2 node count, L3 decision count).

- Works correctly in both states tested:
  - No DB yet: `✖ Status check failed: Local database not found. Please run "docuvia init".` (exit 1) — correct, actionable.
  - After `init`: `Projects: 1 / L2 Nodes: 84380 / L3 Decisions: 0` — matches what other commands reported for the same index.
- 🟢 Same log-noise issue as everywhere else: a raw `pino` JSON line (`{"level":30,...,"msg":"Getting status"}`) is printed directly above the nicely formatted result, purely because pretty-printing is disabled by the `NODE_ENV=production` workaround (see cross-cutting issue). Under normal (non-workaround) operation this would presumably be pretty-printed instead — but since normal operation currently _crashes_ (see above), raw JSON leaking into user-facing CLI output is what every real invocation looks like today.
- No functional issues found beyond the two cross-cutting ones already listed.

---

## `docuvia clean`

**Purpose**: wipe `.docuvia/local.db`.

- Tested both states; **works correctly**:
  - No DB present: `✔ Local index wiped successfully. No local database found to clean.` (exit 0, no error — good, idempotent).
  - DB present: deletes `.docuvia/local.db` and reports `✔ Local index wiped successfully. Cleaned .docuvia/local.db database.`; verified the file was actually gone afterward.
- No `--force`/`--all` flags exist here (unlike GitNexus's `clean --force`/`--all`, see comparison below) — every non-TTY invocation (e.g. from a script or CI) silently skips the confirmation prompt (`clean.ts:11`, `if (process.stdin.isTTY)`), which is reasonable, but there's no way to force-skip the prompt from an interactive shell without redirecting stdin.
- **No functional bugs found.** This is the one command in the audit that matched its documentation exactly.

---

## `docuvia review [--baseRef=...]`

**Purpose** (per docs): "Detect structural changes and compute risk scores against a base branch."

- 🔴 **Complete stub.** Run against `hermes-agent` while it had a real uncommitted modification (`AGENTS.md`) plus dozens of new untracked files from `init`, `docuvia review` printed:
  ```
  ✔ Changes analyzed
  STUB: No changes detected
  ```
  Source:
  ```ts
  // lib/core/src/services/change-detection-service.ts:6-9
  public async detectChanges(baseRef?: string): Promise<{ analysis: string }> {
    logger.info({ baseRef }, "Detecting changes");
    return { analysis: "STUB: No changes detected" };
  }
  ```
  The `baseRef` parameter is accepted and logged but never used. There is no code path in this file that reads `git diff` at all.
- This is the literal string `"STUB: ..."` reaching end-user stdout — the only command in this audit where the placeholder nature is at least self-labeled in the output text (small mercy; still shows a green ✔).
- **Recommendation**: Either implement real git-diff-based structural change detection (the described feature), or remove the command from the CLI/docs until it exists. A `review` command that always reports "no changes" regardless of actual changes is actively misleading for a risk-scoring workflow.

---

## `docuvia sync [<project_id>] [<sha>]`

**Purpose**: sync local AST changes to a remote Docuvia API server over HTTP.

- Ran `docuvia sync test-project abc123` without `DOCUVIA_API_URL`/`MCP_PAT` set — correctly short-circuited with a clear warning instead of attempting a network call:
  ```
  ⚠ DOCUVIA_API_URL or MCP_PAT is missing in the environment.
  ⚠ Skipping remote sync. Please set these variables in your .env file or environment.
  ```
  This guard is good UX. **However**, even if those env vars were set, the sync itself would still do nothing:
  ```ts
  // lib/core/src/services/sync-service.ts:11-15
  public async sync(projectId: string, commitSha?: string): Promise<void> {
    this.logCallback(`Starting sync for project ${projectId}...`);
    logger.info({ projectId, commitSha }, "Syncing to remote");
    // STUB
  }
  ```
  🔴 No HTTP request is ever constructed. A correctly configured environment would silently "succeed" (no thrown error, no output beyond the log line) without syncing anything.
- **Recommendation**: Implement the actual HTTP POST described in `docs/gitbook/packages/cli.md`'s call-chain diagram, or have the command fail loudly rather than exit 0 having done nothing.

---

## `docuvia snapshot`

**Purpose**: pack the local knowledge graph directly into the `docuvia-knowledge` orphan branch (no server required).

- Functionally **works** — completed after re-scanning all 4,236 files from scratch (it does not reuse the DB `init`/`analyze` already built; it re-runs the full "Git-native blob hashing" AST scan independently) and packed the result:
  ```
  ✔ Successfully packed local knowledge to branch. Nodes: 84386, Links: 442630
  ```
  Verified the `docuvia-knowledge` branch was actually created locally.
- 🔴 Same **13× `AstWorkerPool` crash** pattern as `init`, reproduced identically, again with no final error/warning summary despite the crashes.
- 🟡 **Very slow relative to the amount of work done**: ~6 minutes wall-clock for 4,236 files / 84k nodes on this machine, vs. GitNexus indexing the _same repository_ (finding more files, producing more nodes) in 134.6 seconds — see comparison section. Re-scanning everything from scratch on every `snapshot` call (rather than incrementally reusing the already-parsed `local.db`) appears to be a significant part of this — worth checking whether the "Git Hash Delta check" that's logged (`Git Hash Delta check: 4236 files need parsing. 0 skipped.`) is actually able to skip unchanged files in practice, since in this run it skipped 0 despite `init` having just parsed the identical tree moments earlier.
- 🟡 **Link count inconsistent with `export --topology`** for what should be the same graph — see next section.
- **Recommendation**: Investigate why the delta check reports 0 skippable files immediately after a fresh `init` of the same tree; if snapshot is meant to be incremental, this suggests the hash-delta comparison isn't working as intended.

---

## `docuvia query <target> [--local] [--format=human|prompt]`

**Purpose**: query the local knowledge graph for L2/L3 context on a symbol or file.

- Ran against real symbols pulled directly from `hermes-agent` source (e.g. `resolve_node_command`, defined in `hermes_cli/_subprocess_compat.py:52`). Every result, regardless of `--format`, looked like:
  ```
  ℹ [L2 Module] resolve_node_command
  ```
  or, in `--format=prompt`:
  ```xml
  <docuvia_context>
    <l2_module name="resolve_node_command">
    </l2_module>
  </docuvia_context>
  ```
- 🟡 **No file path, no line numbers, no callers/callees, no code snippet — ever.** This isn't a data-availability problem: the exact same `.docuvia/local.db` has `getContext()` and `getImpact()` methods (`lib/core/src/services/query-service.ts:75-121`) that do compute incoming/outgoing edges from the `node_links` table and are used by the MCP tools / VS Code hover provider. The CLI's `query` command instead calls a third, much thinner method, `QueryService.query()` (same file, lines 39-67), which only resolves a name to `{ l2: { name, slug }, l3: [...] }` — it never touches `node_links` at all.
  - **This means the CLI's own `query` command is strictly less capable than the MCP server the same package ships (`docuvia mcp`)**, despite both reading the same local SQLite file.
- **Recommendation**: Have `docuvia query` call `getContext()` (or a merged view of `query()` + `getContext()`) so CLI users get the same caller/callee/file/line information already available to MCP clients, instead of a bare name echo.

---

## `docuvia export --topology [--json] [--out=DIR] [--collapse=auto|file|symbol]`

**Purpose**: export the knowledge graph to `topology.json` + an offline interactive `topology.html` viewer.

- 🔴 **Default output (`--collapse` unset, i.e. `auto`/`file`) reports zero links**, on a graph that unambiguously has edges:
  ```
  docuvia export --topology                    → 4236 nodes,  0 links      (default)
  docuvia export --topology --collapse=symbol  → 84380 nodes, 123916 links
  ```
  The underlying graph has well over 100k edges — the default file-level collapse view drops every single one when aggregating symbol-level edges up to file-level nodes. Since most users will run the bare `docuvia export --topology` without discovering `--collapse=symbol`, **the default output actively misrepresents the project as having no internal call/reference structure at all.**
- 🟡 **Edge-count disagreement across commands for the same index**: `docuvia snapshot` reported `Links: 442630` for essentially the same node set (84386 vs. 84380 nodes) that `export --topology --collapse=symbol` reported as `123916 links`. A 3.6× discrepancy between two commands reading the same `local.db` for what should be the same relationship count strongly suggests at least one of the two is counting/deduplicating edges differently (or the two "link" concepts aren't actually the same thing and should be documented as such).
- **Recommendation**: Fix the file-level collapse aggregation to actually roll up symbol edges instead of dropping them, and reconcile (or explicitly document the difference between) the edge counts reported by `snapshot` vs. `export --topology`.

---

## `docuvia mcp`

**Purpose**: start the local MCP server over stdio for Claude Desktop/Cursor/etc.

- Starts cleanly and prints `Docuvia Local MCP Server running on stdio`; terminates cleanly on signal. No issues found in this smoke test (a full protocol-level MCP conformance test was out of scope for this pass).

---

## Comparison with GitNexus (same repo, same commit)

### Index completeness & speed

|                        | Docuvia (`init` + `snapshot`)                     | GitNexus (`analyze --force`)                                                          |
| ---------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Files discovered       | 4,236                                             | 5,938 (explicitly lists the 9 files >512KB it skips, e.g. `cli.py`, `gateway/run.py`) |
| Wall-clock time        | ~6 min (`snapshot` alone)                         | **134.6s** (`real 2m16.666s`)                                                         |
| Nodes produced         | 84,386                                            | **152,049**                                                                           |
| Edges produced         | 123,916–442,630 (inconsistent, see above)         | 283,552                                                                               |
| Worker/process crashes | **13**, unattributed, unreported in final summary | **0**                                                                                 |

GitNexus finds ~1,700 more files, indexes in roughly a quarter of the time, and produces close to double the symbol count — with zero crashes and clear, itemized skip-reporting for oversized files (a graceful degradation Docuvia's crash-and-respawn loop doesn't offer). Docuvia's actual coverage gap is larger than the raw file-count difference suggests once the 13 silently-dropped parse failures are factored in.

### Query depth, same real symbol (`resolve_node_command`, `hermes_cli/_subprocess_compat.py:52`)

`docuvia query resolve_node_command` → `[L2 Module] resolve_node_command` (nothing else).

`gitnexus context resolve_node_command --repo hermes-agent` →

```json
{
  "symbol": { "filePath": "hermes_cli/_subprocess_compat.py", "startLine": 51, "endLine": 86 },
  "incoming": {
    "calls": [
      {
        "name": "test_resolve_node_command_returns_absolute_on_posix",
        "filePath": "tests/tools/test_windows_native_support.py"
      },
      {
        "name": "test_resolve_node_command_fallback_when_absent",
        "filePath": "tests/tools/test_windows_native_support.py"
      }
    ]
  },
  "outgoing": {},
  "processes": []
}
```

`gitnexus impact` additionally computes blast radius + a `LOW/MEDIUM/HIGH/CRITICAL` risk rating for the same symbol — a category of output `docuvia review`/`docuvia query` don't produce today (partly because `review` is a stub, partly because `query` doesn't surface `getContext()`/`getImpact()`, both of which already exist in `query-service.ts`).

### Command-surface breadth

| Docuvia                                                                                                   | GitNexus                                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `init`, `analyze`, `status`, `clean`, `review`_, `sync`_, `snapshot`, `query`, `export --topology`, `mcp` | `setup`, `uninstall`, `analyze`, `index`, `serve`, `mcp`, `list`, `status`, `doctor`, `clean`, `remove`, `wiki`, `augment`, `publish`, `query`, `context`, `impact`, `trace`, `cypher`, `detect-changes`, `check`, `group`, `eval-server` |

\* stub, see sections above. GitNexus additionally exposes symbol-level `context`/`impact`/`trace`/`cypher`, a multi-repo registry (`list`), cross-repo `group` impact analysis, a `doctor` diagnostics command, and `wiki` generation — none of which Docuvia's CLI currently has an equivalent for.

### Where Docuvia's design is differentiated (not a bug — noted for balance)

Docuvia's local-first, git-orphan-branch storage model (`snapshot` commits straight into `docuvia-knowledge`, no server needed) and its L3 "decision" layer are architectural choices GitNexus doesn't make. In principle this is a real differentiator for server-less team workflows. In practice, **the two commands that would demonstrate that differentiator — `review`'s risk scoring and `sync`'s team distribution — are both stubs today**, so this audit could not observe the differentiator actually working end-to-end.

---

## Priority-ordered recommendations

1. **Fix the `pino-pretty` startup crash** (cross-cutting) — until this is fixed, the CLI cannot be run as documented in any non-production environment.
2. **Implement or clearly label the three stubs** — `review`, `sync`, and `analyze <path>` all currently return fabricated/hardcoded success output indistinguishable from real results.
3. **Surface AST worker-crash failures in the final command summary**, with per-file attribution if possible — both `init` and `snapshot` currently report unconditional success despite 13 reproducible crashes each.
4. **Fix `export --topology`'s default (file-collapsed) mode dropping all links**, and reconcile the edge-count discrepancy between `snapshot` and `export --topology --collapse=symbol`.
5. **Have `docuvia query` call the richer `getContext()`/`getImpact()` methods** that already exist in `query-service.ts`, instead of the name-only `query()` method — no new backend work required, just wiring.
6. **Document (and gate behind a flag) `init`'s full side-effect surface**, especially the write to the machine-global Claude Desktop config file.

---

## Update — 2026-07-10 (re-measurement after coverage-gap fix + real review/sync/analyze)

Re-ran the full comparison against the **same `hermes-agent` checkout** (`D:\GitHub\hermes-agent` — the working copy for this repo turned out to live directly under `D:\GitHub\`, not `D:\GitHub\miya.daniel\` as originally noted; same repo, same remote `github.com/nousresearch/hermes-agent`), on its current `HEAD` (`8235f484c`, which has drifted from whatever commit the original audit used, since this is a live, independently-developed upstream repo — not something either audit pinned by SHA). Rebuilt `@workspace/core`/`@workspace/ast-core`/`@workspace/plugins-ast` and typechecked `@workspace/cli` before testing (no build step for the CLI itself — `bin.docuvia` still points directly at `src/cli.ts` via `tsx`, confirmed working with **no `NODE_ENV=production` workaround needed**, i.e. priority recommendation #1's `pino-pretty` fix holds).

### 📊 Coverage, re-measured (fresh `docuvia init` + fresh `gitnexus analyze --force`, same commit)

|                      | Docuvia `init` (this session)                                | GitNexus (`analyze --force`, this session)                                                                                      | Ratio                                                                                                           | Ratio (original audit) |
| -------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------- |
| Files                | 4,195 discovered (4,190 parsed + 5 skipped >512KB, reported) | skips 9 files >512KB (2 of the 9 are `.icns` binary icons — an extension Docuvia never discovers as source, so not a fair miss) | — (file counts not directly comparable this run — repo content has drifted since the original audit; see below) | 71%                    |
| Nodes (`l2_nodes`)   | 96,817                                                       | 150,124                                                                                                                         | **64.5%**                                                                                                       | 56%                    |
| Edges (`node_links`) | 138,239 (45,612 `calls` + 92,627 `contains`)                 | 279,325                                                                                                                         | **49.5%**                                                                                                       | 44%                    |

**Node/edge density improved** (+8.5 and +5.5 percentage points respectively) even though the raw file count is not a clean apples-to-apples number this time (hermes-agent's `HEAD` has moved since the original audit — files have been added/removed upstream independently of anything either tool does). The oversized-file skip-list added this session now reports its own skips explicitly (`5 skipped as oversized`, logged with file + size, matching GitNexus's own explicit-skip UX from the original audit's priority list) instead of silently attempting to parse them.

**What moved the numbers**: `docs/ai_plans/improve_index_coverage_vs_gitnexus.md`'s TypeScript/JavaScript symbol-kind broadening (interfaces/enums/type-aliases as class-kind nodes; arrow functions/function expressions as function-kind nodes, previously invisible to the extractor entirely) — this directly targeted per-file density, and the numbers reflect that: nodes-per-file went from ~19.9 (84,380/4,236, original audit) to ~23.1 (96,817/4,190, this run).

**Not investigated further this session**: `node_links` currently shows **zero** `implements`/`extends` edges for hermes-agent, despite `ast-worker.ts` calling `provider.extractImplements()`/`extractExtends()` and `sqlite-graph.repository.ts` persisting them (confirmed wired correctly in `docs/ai_plans/implement_review_sync_analyze_stubs.md`'s Part A research). Plausible innocent explanation: hermes-agent's actual TS/JS code may simply not use `class X implements Y`/`extends Z` patterns much (it's primarily a Python agent runtime with a smaller TS/JS surface) — but this hasn't been directly confirmed and remains an open question for a future pass, separate from the coverage-gap fix's scope.

### ✅ `review`/`sync`/`analyze <path>` exercised against a real repo (not just unit tests)

- **`docuvia review`** (no baseRef, working tree only): correctly detected 18 changed files (init's own artifacts + one deliberate test edit to `AGENTS.md`), computed `riskLevel: MEDIUM` (matches the plan's ">10 files changed → floor of MEDIUM" rule), and reported "No local graph impact detected" for those specific files (expected — they're config/doc files, not indexed source symbols). No more `STUB: No changes detected`.
- **`docuvia analyze <path>`** (a real file, `agent/agent_init.py`): made a genuine outbound request to OpenAI using hermes-agent's own placeholder `.env` API key, got a real `401 Incorrect API key` back, and surfaced it as a clear, real error — proving the LLM call path is genuinely wired (not fabricating "sample decision" strings anymore).
- **🐛 Found and fixed during this exercise**: the real `401` error above initially crashed the Node process natively on exit (`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 76`, exit code 127 instead of a clean `1`). Root cause: `analyze.ts` still constructed and tore down a real `AstWorkerPool` (leftover from before `analyze <path>` became a real LLM-only feature — flagged but not removed during the prior implementation pass) _and_, more fundamentally, both `analyze.ts` and `sync.ts` called `process.exit(1)` immediately after a real network `fetch()` failure, which races with Node/undici's own handle teardown on Windows. Fixed by removing the now-fully-unused `AstWorkerPool` from `analyze.ts`/`ExtractService`, and — the actual fix for the crash — changing both commands' failure paths from `process.exit(1)` to `process.exitCode = 1` (lets the event loop drain naturally instead of forcing an abrupt exit). Verified: same real `401` scenario now exits cleanly with code `1`, no crash. `docuvia sync` has the identical fetch-then-exit shape and received the same fix pre-emptively (not yet reproduced live against a real failing sync target this session, but the mechanism is identical).
- **`docuvia sync`**: not exercised against a real API server this session (would need a real `DOCUVIA_API_URL`/`MCP_PAT` and a running server) — the missing-env-vars graceful-skip path was already covered by the existing unit tests from the prior implementation pass.

hermes-agent's test artifacts (`.docuvia/`, `.cursor/`, `.claude/hooks/`, `.windsurfrules`, `.cursorrules`, `llms.txt`, `.github/copilot-instructions.md`, the appended `CLAUDE.md` block, the global `claude_desktop_config.json` MCP entry) have been reverted; hermes-agent and the global Claude config are back to their pre-test state.

---

## Update — 2026-07-11 (root cause of `export --topology`'s zero-link default found and fixed; `query` wired to `getContext()`)

### ✅ Resolved: cross-file `calls`/`implements`/`extends` edges were silently dropped workspace-wide (was the real cause of priority #4)

Reproducing priority #4 (`export --topology`'s file-collapsed default showing near-zero links) on a minimal 2-file fixture (`a.ts` imports and calls `helper()` from `b.ts`, plus a local call) surfaced a much larger, foundational bug than the collapse-aggregation defect the audit originally suspected: after `init`, `node_links` contained the local call but **no edge at all** for the cross-file one.

**Root cause**: `lib/core/src/workers/ast-worker.ts` built every `ImportDescriptor` as `{ localName: node.text, originalName: node.text, modulePath: "" }`, where `node.text` is the **entire raw import statement text** (e.g. `'import { helper } from "./b";'`), not a parsed identifier. `ScopeResolver.resolveCall()`'s import-matching (`imp.localName === callName`) could therefore never succeed, for any cross-file call, in any language, in the real `init`/`snapshot` pipeline — only same-file (local-symbol) calls ever resolved. Since `sqlite-graph.repository.ts`'s `processLink()` (shared by `calls`, `implements`, and `extends`) silently skips an edge whenever resolution fails, this explains the previously-flagged, then-unexplained "hermes-agent shows zero `implements`/`extends` edges" observation from the prior re-measurement session, _and_ is why `export --topology`'s file-collapsed default view showed near-zero links — the few edges that existed were same-file and collapsed into dropped self-loops.

**Fix**: `lib/ast-core/src/core/edge-computer.ts` already had a fully-correct, per-language import parser (`buildScopeMap`) — but it was reachable only from `parser-core.ts`'s `generateAst()`, used solely by `lib/headless-lsp`, never wired into the real pipeline. Extracted its per-branch parsing logic into a new exported `parseImportDescriptors()`, refactored `buildScopeMap` into a thin, behavior-preserving wrapper over it (verified the Rust branches specifically, since Rust's own path syntax uses `::` natively and a naive string-encoding round-trip could have mangled it — confirmed the wrapper's encoding logic never touches Rust's `modulePath` field), and wired the new function into `ast-worker.ts` in place of the broken one-liner. `topology-builder.ts`'s collapse logic itself was **not** changed — dropping same-file self-loops after collapsing to file granularity is correct, intentional behavior; the zero-link symptom was entirely a consequence of the import-resolution bug.

**Verified end-to-end** on the same 2-file fixture: `docuvia export --topology --collapse=file` went from `2 nodes, 0 links` to `2 nodes, 1 links` (a genuine `a.ts → b.ts` cross-file `calls` edge). Full plan: [`docs/ai_plans/fix_import_resolution_export_topology_query.md`](../ai_plans/fix_import_resolution_export_topology_query.md).

### ✅ Resolved: `docuvia query` now surfaces incoming/outgoing edges (priority #5)

`QueryService.query()` extended in place (additive `context` field, confirmed safe against its only two other callers) to also call the already-existing `getContext()`, and `docuvia query`'s human and `--format=prompt` output both now print "Incoming (called by)"/"Outgoing (calls)" sections when data exists — no more bare `[L2 Module] name` with nothing else, matching (in spirit) `gitnexus context`'s incoming/outgoing output the original audit compared against.

### ⚠️ Explicitly deferred: `snapshot` vs `export --topology --collapse=symbol` edge-count discrepancy (second half of priority #4)

Traced `snapshot`'s reported "Links: N" count to a **completely different, separate persistence pipeline** (`GitNativePersistenceService`, JSONL → git orphan branch, not SQLite) than `init`/`export`'s (`SqliteGraphRepository`, resolved graph edges in `node_links`). `GitNativePersistenceService`'s link counter counts every raw import statement and call expression **completely unresolved** — its own inline comments admit this ("using raw source for now", "in a real scenario we'd resolve targetId accurately"). The 442,630 vs 123,916 discrepancy isn't the same metric computed two ways with a bug in one; it's two fundamentally different metrics (raw site count vs. resolved edge count) both labeled "Links". Properly reconciling them means rewriting `GitNativePersistenceService` to do real symbol resolution like `SqliteGraphRepository` does — a separate, larger initiative, not attempted this session.
