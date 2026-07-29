# `docuvia analyze`

`analyze` is Docuvia's ingestion command — it keeps the local knowledge graph (`local.db`) up to date with your source code. It has three modes, dispatched on whether a path argument or `--escalate-to-lsp` is given — see [Tiered Background Knowledge Evolution](../../adr/platform/PLAT-007-tiered-background-knowledge-evolution.md) (PLAT-007) for the full Tier A/B/C contract:

## Usage

```bash
docuvia analyze [path] [flags]
```

## Options

### Arguments

- `[path]`: A specific file or directory to run focused LLM decision extraction against. Omit it to run auto mode — this is the mode the post-commit hook and most manual invocations use. Takes priority over `--escalate-to-lsp` if both are somehow given.

### Flags

- `--escalate-to-lsp`: Runs the Tier B batch — LSP-precision cross-file `calls` edges over the files Tier A queued since the last batch (see Mode C below). This is the flag IMPT-002 names as "the core quality engine"; it is now implemented for real (spawn-per-batch `typescript-language-server`), not a no-op.
- `--fallback-ast`: Only relevant with `--escalate-to-lsp`. Skips the environment-readiness gate entirely and proceeds straight to the batch (which degrades honestly if the LSP truly isn't available). On an interactive terminal this skips the "LSP prerequisites aren't ready — continue with AST-only precision?" prompt; non-interactively it skips the hard failure the gate would otherwise raise. The pre-push hook always passes this flag so a push is never blocked by an unready LSP environment.
- `--force`, `-f`: Force re-running full AST ingestion even if HEAD matches the last-ingested source commit (bypassing the fast-path no-op check).
- `--interactive`, `-i`: Opt-in to interactive prompts/confirmation dialogs. Without this flag, commands will fail-fast or degrade non-interactively.

> **Language scope:** LSP-precision cross-file edges currently cover **TypeScript/JavaScript only** (`.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs`). Every other language stays at AST-level precision until its own Tier B plugin exists — this is a deliberate per-language dispatch table (§8e), not an oversight; queued files in an unsupported language are skipped with a log line each batch.

## Mode A — No path: auto mode (ingestion)

> **Breaking change from earlier Docuvia2 builds:** no-arg `analyze` used to be a read-only
> project-type/tag scan that never touched the graph. It now performs real ingestion — the scan
> becomes a step of that, not the whole command.

Auto mode picks one of three outcomes, in this order:

1. **Fast-path no-op**: if `HEAD` already equals the source commit the graph was last ingested
   from, `analyze` exits immediately (sub-second) without touching the filesystem further. This is
   what makes it safe to run on every commit.
2. **Full ingestion**: if the graph has no project row or no L2 nodes yet (a fresh workspace, or
   one whose `local.db` was deleted), `analyze` runs the same discovery -> config-scan ->
   AST-parse -> persist pipeline `docuvia init` uses. The project-type/tag scan's output is
   reported as part of this.
3. **Delta ingestion**: otherwise, `analyze` diffs the last-ingested source commit against `HEAD`,
   re-parses only the added/modified/renamed source files (filtered by the same ignore/oversize
   rules as full ingestion), and drops deleted files' nodes. A lightweight structural classifier
   flags files whose public surface (not just internal logic) changed — the accumulated list feeds
   the Tier B batch (Mode C below), which is the "quality backstop" for cross-file drift this
   file-local delta can't see.

Every run — no-op, full, or delta — writes a structured JSONL log to `.docuvia/logs/analyze.log`.

## Mode B — Path given: focused LLM decision extraction

Passing a file or directory switches to a focused pass: Docuvia reads the target's source,
sends it to an LLM, and extracts concrete implementation decisions/rules/context as L3 nodes
attached to the graph (deduplicated by content hash). This requires
`AI_DOCUVIA_INTEGRATIONS_OPENAI_BASE_URL` and a model
(`AI_DOCUVIA_MODEL`/`AI_DOCUVIA_FAST_MODEL`) to be set — missing env vars are a hard failure.

## Mode C — `--escalate-to-lsp`: the Tier B batch

Drains the whole Tier B queue Mode A's delta ingestion accumulated (files whose public surface
changed): spawns a headless `typescript-language-server` for the batch (never a resident daemon),
resolves cross-file `calls` edges via `textDocument/documentSymbol` +
`textDocument/references`, writes them to the graph, and repairs incoming edges that Tier A's
per-file replace can drop (re-attached by the deterministic `node_key` identity, not by re-parsing
the caller). This is normally composed with `snapshot` by the pre-push hook
(`analyze --escalate-to-lsp --fallback-ast && snapshot`) — exactly one snapshot lands on the
knowledge branch per batch, not per commit.

**Environment-readiness gate:** before running the batch, `--escalate-to-lsp` checks whether the
LSP environment is actually ready (binary resolvable, project dependencies installed/built) for
every language queued. On an interactive terminal this prompts ("LSP prerequisites aren't ready —
continue with AST-only precision?"). Otherwise it **fails outright** (exit `1`, no batch run) —
running an unready environment silently wastes a full batch's wall-clock time and produces results
indistinguishable from a healthy run unless you read the JSONL log line-by-line. Pass
`--fallback-ast` to skip the gate and get the old **honest degradation** behavior instead: the
batch leaves AST-level edges untouched, logs why, and exits `0`. The pre-push hook always passes
`--fallback-ast` — a push must never be blocked by an unready LSP environment. Run `docuvia doctor`
to check readiness ahead of time.

**Binary resolution** (never bundled with docuvia): `<project>/node_modules/.bin` first, then
`npx --no-install typescript-language-server`. Config-overridable via environment variables read
by the CLI: `DOCUVIA_LSP_BINARY` (absolute path or bare command), `DOCUVIA_LSP_ARGS`
(space-separated), `DOCUVIA_LSP_TIMEOUT_MS` (whole-batch timeout, generous by default), and
`DOCUVIA_TIER_B_COMMIT_CAP` (default 20).

## Examples

Update the graph from the current source state (auto mode):

```bash
docuvia analyze
```

Extract decisions from a specific module (focused LLM extraction):

```bash
docuvia analyze src/auth/
```

Run the Tier B LSP-escalation batch manually (what the pre-push hook does automatically):

```bash
docuvia analyze --escalate-to-lsp && docuvia snapshot
```

If your environment isn't ready yet, this fails with a message telling you to build the project
and run `docuvia doctor`. To get the old degrade-instead-of-fail behavior (e.g. for a CI script
that shouldn't hard-fail on a missing language server), pass `--fallback-ast`:

```bash
docuvia analyze --escalate-to-lsp --fallback-ast && docuvia snapshot
```
