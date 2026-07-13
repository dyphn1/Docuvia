# Continuous Evaluation Benchmark Template: Knowledge Graph CLI Products

> **Purpose:** This document defines the standard evaluation matrix, execution rules, and baseline metrics for comparing Docuvia2 against sibling and competitor products (GitNexus, Graphify, Code-Review-Graph). Future AI agents can use this template to re-run the benchmark and compare regressions or improvements over time.

---

## 1. Benchmark Execution Rules

When an AI agent is instructed to "run the CLI benchmark", it MUST strictly adhere to the following steps:

1. **Environment Preparation**:
   - `Docuvia2`: `pnpm install && pnpm run build`. Run via `npx tsx artifacts/cli/src/cli.ts <cmd>` or `node artifacts/cli/dist/cli.js <cmd>`.
   - `GitNexus`: `npx gitnexus@latest <cmd>` or `node .gitnexus/run.cjs`.
   - `Graphify`: `python -m venv .venv && source .venv/Scripts/activate && pip install -e .` then `graphify <cmd>`.
   - `Code-Review-Graph`: `python -m venv .venv && source .venv/Scripts/activate && pip install -e .` then `code-review-graph <cmd>`.
2. **Measurement**: Use the `time` command in Bash (e.g., `time npx gitnexus status`) to capture real-world wall-clock latency for the user.
3. **Data Integrity**: The agent MUST NOT hallucinate capabilities. If a tool fails to build or a command is missing, log it as `N/A` or `Failed`. **A command that runs fast but returns empty/no-op results MUST be reported as such — speed alone does not indicate a functioning feature.**
4. **Output Format**: Overwrite the "Latest Run Results" sections below while preserving this overarching template structure.
5. **Safety**: Prefer running indexing/query/build commands against a real target repo (this benchmark uses Docuvia2's own working tree as the common target so all four tools are measured against identical input). Avoid running `install`/`uninstall`/`init` hook-registration commands live where they are known to mutate global, cross-project config (see §2a) — verify those via `--help`/source inspection instead and label the result "not executed live."

---

## 2. Latest Run Results (Date: 2026-07-13, re-verified with live command execution)

**Verification method:** every number below was produced by actually building/installing each tool in this environment and running the listed command against the real Docuvia2 repository (420 files) as a common target, so the comparison is apples-to-apples. Two commands (`docuvia uninstall`, `docuvia init`) had real side effects encountered during testing — see the callouts in §2a and §2b. All temporary indexes/artifacts created during this run (`.docuvia/`, `.gitnexus/`, `graphify-out/`, `.code-review-graph/`) were deleted afterward and are not part of the repository.

### 2a. Category: Installation & Editor Hooks Integration

| Feature / Metric         | Docuvia2          | GitNexus                                                              | Graphify                                             | Code-Review-Graph (CRG)                           |
| :----------------------- | :---------------- | :-------------------------------------------------------------------- | :--------------------------------------------------- | :------------------------------------------------ |
| **Initial Setup / Hook** | `init`            | `setup`                                                               | `install [--platform P]`                             | `install` / `init`                                |
| **Hook Teardown**        | `uninstall`       | `uninstall`                                                           | `uninstall`                                          | `unregister` (registry only)                      |
| **Diagnostic & Health**  | `doctor`          | `doctor`                                                              | _N/A (no diagnose command found)_                    | `status` (stats only, confirmed no health checks) |
| **MCP Server Start**     | `mcp`             | `serve`, `mcp`                                                        | _N/A (no dedicated MCP subcommand seen in `--help`)_ | `serve`, `mcp`                                    |
| **Live execution**       | See callout below | Not executed live (would mutate global editor config on this machine) | Not executed live (same reason)                      | Not executed live (same reason)                   |

**Verified findings (2026-07-13):**

- **Docuvia2's `doctor` and `uninstall` are fully implemented**, not "Planned" as a prior version of this document claimed. `doctor` ran real checks (SQLite integrity, WAL bloat, git remote reachability, log scan) in 2.88s.
- ⚠️ **`docuvia uninstall` was executed live during this benchmark and had a real, cross-project side effect**: it removed the Docuvia2 MCP server entry from the user's global `claude_desktop_config.json` and deleted the local `.docuvia/local.db`. The user reviewed this and confirmed it was acceptable to leave, but it is flagged here because **an "uninstall" command for one project silently touches global, shared configuration** — future benchmark runs (or real users) should expect this.
- **`docuvia init` hung waiting on a TTY prompt** when run non-interactively without `--platform`; only proceeds unattended once a platform flag is supplied. See §2b for what happened when it did proceed.

### 2b. Category: Indexing & Analysis (Graph Building)

Target for all four tools: the Docuvia2 repository itself (420 files, TypeScript/pnpm monorepo).

| Feature / Metric           | Docuvia2                             | GitNexus                                                 | Graphify                                           | Code-Review-Graph (CRG)                   |
| :------------------------- | :----------------------------------- | :------------------------------------------------------- | :------------------------------------------------- | :---------------------------------------- |
| **Full Graph Build**       | `analyze` (tags only, confirmed)     | `analyze .`                                              | `extract <path>`                                   | `build --repo .`                          |
| **Verified Build Result**  | 0 nodes (tag detection only)         | **2,642 nodes / 6,601 edges / 196 clusters / 202 flows** | **1,593 nodes / 4,180 edges** (AST + LLM semantic) | **1,617 nodes / 17,272 edges**, 295 files |
| **Verified Build Latency** | 1.78s                                | 27.6s (23.2s internal + npx cold-start)                  | 18.1s (4s AST-only + ~14s LLM semantic)            | 2.74s                                     |
| **Incremental Update**     | _Implicit via hooks (not exercised)_ | `update`/`detect-changes`                                | `update <path>` (no LLM needed)                    | `update`                                  |
| **Clear Local Index**      | `clean`                              | `clean`                                                  | _Manual deletion of `graphify-out/`_               | _N/A_                                     |

**Verified findings (2026-07-13):**

- **Docuvia2's `analyze` genuinely produces zero graph nodes.** Confirmed by running `docuvia status` before and after `analyze`: `L2 Nodes: 0` in both cases. This is _not_ an artifact of a cold cache — it is tag detection only (`Project Type: javascript`, `Suggested Tags: ...`), exactly as the CLI's own output states.
- ⚠️ **A real AST worker pipeline does exist in Docuvia2 and is invoked by `init`, but it crash-loops.** Running `docuvia init --platform claude` non-interactively triggered a rapid, repeating `AST worker crashed/exited` error: `Cannot find module 'D:\...\lib\core\src\constants\encoding.js' imported from ...\lib\core\src\ast\ast-worker.ts` (a `.js`-vs-`.ts` module-resolution mismatch when run via `tsx`). This contradicts the previous version of this document, which stated Docuvia2 "intentionally dropped AST extraction to avoid LLM hallucination fears" — the AST code is present and wired in, it is simply broken. After the crash loop completed, `local.db` existed (`Projects: 1`) but still `L2 Nodes: 0`, confirming the AST layer contributes nothing to the graph in its current state.
- ⚠️ **GitNexus's `analyze` mutated tracked project files as an undocumented side effect.** It appended a `<!-- gitnexus:start -->…<!-- gitnexus:end -->` instructional block to `AGENTS.md` and six files under `.claude/skills/gitnexus/`, and **completely overwrote `CLAUDE.md`**, replacing the entire pre-existing file (the project's real orchestration instructions) with only its own auto-generated block. This was caught and reverted (`CLAUDE.md` restored from source, `AGENTS.md`/skills restored via `git checkout`) during this benchmark. Any team running `gitnexus analyze` on a repo with an existing `CLAUDE.md` should expect data loss unless the file is already committed.
- **Graphify's `extract` failed on the first attempt** — the "gemini" semantic backend requires the `openai` pip package, which is not installed by `pip install -e .` by default, even though `GEMINI_API_KEY` was present in the environment. It only succeeded after manually installing the missing dependency (as the tool's own error message suggested). Once working, it made a real, billed LLM call (~$0.09 via the user's own Gemini key, 138k input / 6.5k output tokens) to produce the semantic layer; the AST-only portion completes in ~4s without any LLM cost.
- **Code-Review-Graph's build was the fastest full build (2.74s)** but logged `igraph not available, using file-based community detection` — a real, functioning fallback, but a lower-fidelity one than the optional `igraph`-backed path.

### 2c. Category: Query, Visualization & Impact

All commands below were run against the graph each tool built in §2b for Docuvia2 (except Docuvia2 itself, whose own graph was empty).

| Feature / Metric          | Docuvia2                                                                                  | GitNexus                                                                                                                                   | Graphify                                                                    | Code-Review-Graph (CRG)                                                                      |
| :------------------------ | :---------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------- |
| **Query Engine**          | `query` — runs (2.12s) but returns "No matching module found" (graph is empty)            | `query` — 248ms internal / 4.35s incl. npx cold-start, real ranked results with per-stage timing (vector/bm25/merge/symbol_lookup/ranking) | `query "<question>"` — 0.43s, real BFS results (token-budgeted)             | _N/A (MCP only, confirmed via `--help` — no CLI query subcommand)_                           |
| **Impact / Blast Radius** | `impact` — runs (1.89s) but "No matching node found" (graph is empty)                     | `impact` — real result: exact symbol resolved, `impactedCount: 0`, `risk: LOW`, `epistemic: "exact"`                                       | `affected "X"` — 0.36s, real reverse-traversal results                      | `detect-changes` — 0.97s, real per-symbol `risk_score` + estimated 75% context-token savings |
| **Explain / Context**     | _N/A_                                                                                     | `context`, `trace`, `cypher` (not exercised this run)                                                                                      | `explain "X"` — 0.44s, real connection list with edge types and node degree | _N/A_                                                                                        |
| **Visual Export**         | `export-topology` — 1.99s, produces `topology.json`/`.html` but with 0 nodes/links/groups | _N/A (web UI only)_                                                                                                                        | `graph.html` generated as part of `extract`/`cluster-only`                  | `visualize` — 0.79s, real 3.8MB interactive `graph.html` + 22MB `graph.db`                   |
| **Docs / Wiki Gen**       | _N/A_                                                                                     | `wiki` (not exercised this run)                                                                                                            | `label`/`cluster-only` (community naming, requires LLM)                     | `wiki` — 0.47s, generated 17 real wiki pages                                                 |

**Verified findings (2026-07-13):**

- **Docuvia2's `impact`/`query`/`export-topology` are fast but not currently useful on a real project** — every one of them executed in ~2s and returned an empty result, because §2b confirmed the underlying graph has 0 nodes. Reporting these as functioning "instant SQLite" features (as the prior version of this document did) is misleading without noting they have nothing to query.
- **GitNexus's `impact`/`query` are the only ones in this benchmark that surfaced a queryable multi-repo ambiguity** — because GitNexus globally registers every repo it indexes on the machine, `query`/`impact` failed with "Multiple repositories indexed" until `--repo <path>` was supplied explicitly. This is a real UX papercut for a single-repo workflow, not a broken feature.
- **Graphify and Code-Review-Graph both returned real, correct, sub-second results** on every read-side command tested, with no empty-result caveats — their difference is scope (Graphify has richer semantic explain/BFS; CRG has unique risk-scored `detect-changes` with a context-savings estimate).

### 2d. Category: Remote Sync & Git Integration

| Feature / Metric         | Docuvia2                                                                                                                                                                       | GitNexus                                                               | Graphify                                         | Code-Review-Graph (CRG) |
| :----------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------- | :----------------------------------------------- | :---------------------- |
| **Push Analysis to API** | `sync` — attempted live; failed non-interactively with "Project ID is required when not running interactively" (requires remote auth/config not available in this environment) | `publish` (opt-in, requires `UNDERSTAND_QUICKLY_TOKEN`; not exercised) | _N/A_                                            | _N/A_                   |
| **Commit Graph to Git**  | `snapshot` — **verified working mechanically**: packs the local graph onto a real `docuvia-knowledge` orphan branch (confirmed present via `git branch -a`)                    | _N/A_                                                                  | `merge-driver` (JSON union-merge, not exercised) | _N/A_                   |
| **Hydrate from Git**     | `hydrate` — **verified working**: reads back from the `docuvia-knowledge` branch (2.56s; loaded 0 nodes/edges, consistent with the empty graph from §2b)                       | _N/A_                                                                  | _N/A_                                            | _N/A_                   |
| **Cross-Clone Sync**     | `sync-knowledge` (not exercised this run — requires a second clone to be meaningful)                                                                                           | _N/A_                                                                  | _N/A_                                            | _N/A_                   |

**Verified findings (2026-07-13):**

- **Docuvia2's git-native snapshot/hydrate mechanism genuinely works as plumbing** — it is still the only tool of the four that commits graph state to a hidden git branch instead of a local-only cache, and this mechanism was independently verified (real branch, real round-trip). However, because §2b confirmed the graph it carries is currently empty, this differentiator currently ships **an empty payload** — the pipe works, there is nothing flowing through it yet. Fixing the AST crash loop in §2b is a prerequisite for this feature to matter in practice.

---

## 3. Architecture & Product Recommendations (Re-evaluated: 2026-07-13, based on live-verified results)

### System Architect's Evaluation

> **Score (Max 100) — revised down from the prior version of this document, which scored features from documentation/assumption rather than live execution:**
>
> 1. **GitNexus: 82 / 100** (Only tool whose query/impact/analyze all worked end-to-end on real data with correct results. Cons: ~2,642-node build took 27.6s including cold-start, multi-repo query ambiguity needs manual `--repo`, and **`analyze` overwrote the target repo's `CLAUDE.md` and mutated `AGENTS.md`/skill files without confirmation** — a real safety issue for a "read-only" indexing tool.)
> 2. **Graphify: 80 / 100** (Fastest read-side commands (all sub-second), richest editor-hook breadth, real semantic explain via LLM. Cons: full `extract` failed out of the box on a missing optional dependency despite an API key being present, and the semantic layer has a real per-run dollar cost.)
> 3. **Code-Review-Graph: 78 / 100** (Fastest full build (2.74s) of the four, uniquely useful `detect-changes` with risk scoring and token-savings estimate, real wiki/visualize output. Cons: no CLI query/exploration path at all (MCP-only), community detection silently degrades without optional `igraph`.)
> 4. **Docuvia2: 52 / 100** (Down from a previously claimed 80. Unique git-native snapshot/hydrate mechanism is real and verified working — but it currently carries an empty graph, because the AST worker it depends on crash-loops on a broken import path. `impact`/`query`/`export-topology` all execute quickly but return empty results on a real project, and the compiled CLI binary (`dist/cli.js`) does not run at all due to a duplicated shebang line — this was fixable in principle but is a genuine defect in the current build output, separate from the AST bug.)

### Verified, Reproducible Bugs Found in Docuvia2 (this run)

1. **`artifacts/cli/dist/cli.js` cannot execute — `node dist/cli.js <cmd>` fails immediately** with `SyntaxError: Invalid or unexpected token` on line 2. Root cause: `artifacts/cli/src/cli.ts` already starts with `#!/usr/bin/env node`, and `artifacts/cli/tsup.config.ts` _also_ injects `banner: { js: "#!/usr/bin/env node" }`, so the built file has the shebang line twice — the second occurrence is invalid JS and Node's ESM loader only strips the first line. The `npx tsx artifacts/cli/src/cli.ts` invocation path (the doc's documented alternative) is unaffected and was used for the rest of this benchmark.
2. **`docuvia init` (and any path that spins up the AST worker pool) crash-loops** with repeated `AST worker crashed/exited: Cannot find module '.../lib/core/src/constants/encoding.js' imported from .../lib/core/src/ast/ast-worker.ts` — a compiled-`.js`-import-path vs. TS-source mismatch that only surfaces when running from source via `tsx` rather than the (currently non-bootable) `dist/` build. This is why `analyze`/`init` never populate real graph nodes in this environment.

### Strategic Action Items for Docuvia2 (revised priority order, based on verified evidence)

1. **Fix the duplicated shebang in the `tsup` build (blocking, trivial):**
   - Remove the `banner.js` shebang line from `artifacts/cli/tsup.config.ts` (the source file already has one), or strip the shebang from `src/cli.ts` and keep only the `tsup` banner. Either produces a bootable `dist/cli.js`. This should ship before anything else — right now the packaged CLI cannot run at all.

2. **Fix the AST worker's module resolution crash (blocking, higher effort):**
   - Root-cause the `lib/core/src/constants/encoding.js` import from `lib/core/src/ast/ast-worker.ts` — under `tsx`, TS source imports must resolve to `.ts`/on-disk paths or the equivalent built output consistently. Until this is fixed, `analyze`/`init` will keep producing an empty graph, which makes `impact`, `query`, `export-topology`, `snapshot`, and `hydrate` correctly-executing but functionally inert. This supersedes the prior recommendation to "re-integrate `lib/ast-core`" — the integration already exists; it is simply crashing.

3. **Add a non-interactive/CI mode to `init`:**
   - `init` currently hangs on a TTY prompt unless `--platform` is supplied, and even then spins up the (currently broken) AST worker pool with no way to skip it. A `--yes`/`--no-ast` flag would make the command safely scriptable and testable in CI, and would have avoided the crash-loop encountered during this benchmark.

4. **Treat `uninstall`'s global config mutation as a documented, explicit action:**
   - `uninstall` silently modified the user's global `claude_desktop_config.json` in this test. Regardless of whether that's the intended behavior, a command that touches shared, cross-project state should prompt for confirmation (mirroring `init`'s own TTY-confirm pattern) rather than acting silently — especially since `uninstall` was not flagged in the CLI's own `--help` text as touching anything outside the current project.

5. **(Unchanged from prior recommendation) Borrow visualization ideas from Graphify/CRG:**
   - Both Graphify (`graph.html` via `extract`/`cluster-only`) and Code-Review-Graph (`visualize`) produce a real interactive HTML graph in under 1s once their graph exists. Docuvia2's `export-topology` already has the right shape (`topology.json`/`.html`) — once item 2 above is fixed and the graph is non-empty, this feature should already work as designed.

### Note on GitNexus (separate from Docuvia2, flagged for the maintainers of that project)

`gitnexus analyze` overwriting a target repository's `CLAUDE.md` and silently appending to `AGENTS.md`/skill files is a real finding from this run, not specific to Docuvia2 — any repo with an existing `CLAUDE.md` that runs `gitnexus analyze` should expect it to be replaced. This should be raised with the GitNexus maintainers; a safe fix would be to only ever append/merge between `<!-- gitnexus:start -->`/`<!-- gitnexus:end -->` markers and never touch content outside them, the way it already (correctly) does for `AGENTS.md`.
