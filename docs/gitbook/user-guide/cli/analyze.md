# `docuvia analyze`

`analyze` is Docuvia's ingestion command — it keeps the local knowledge graph (`local.db`) up to
date with your source code. It has three modes, dispatched on whether a path argument or
`--escalate-to-lsp` is given — see
[Tiered Background Knowledge Evolution](../../adr/platform/PLAT-007-tiered-background-knowledge-evolution.md)
(PLAT-007) for the full Tier A/B/C contract:

## Usage

```bash
docuvia analyze [path] [--escalate-to-lsp] [--fallback-ast]
```

### Arguments

- `[path]` _(Optional)_: A specific file or directory to run focused LLM decision extraction
  against. **Omit it** to run auto mode (see below) — this is the mode the post-commit hook and
  most manual invocations use. Takes priority over `--escalate-to-lsp` if both are somehow given.

### Flags

- `--escalate-to-lsp`: Runs the Tier B batch — LSP-precision cross-file `calls` edges over the
  files Tier A queued since the last batch (see Mode C below). This is the flag IMPT-002 names as
  "the core quality engine"; it is now implemented for real (spawn-per-batch
  `typescript-language-server`), not a no-op.
- `--fallback-ast`: Only relevant with `--escalate-to-lsp`, and only on an interactive terminal.
  Skips the "LSP prerequisites aren't ready — continue with AST-only precision?" confirmation
  prompt and proceeds straight to the batch (which degrades honestly if the LSP truly isn't
  available). Background invocations (the pre-push hook, CI) never prompt in the first place.

> **Language scope:** LSP-precision cross-file edges currently cover **TypeScript/JavaScript
> only** (`.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs`). Every other language stays
> at AST-level precision until its own Tier B plugin exists — this is a deliberate per-language
> dispatch table (§8e), not an oversight; queued files in an unsupported language are skipped with
> a log line each batch.

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
(`analyze --escalate-to-lsp && snapshot`) — exactly one snapshot lands on the knowledge branch per
batch, not per commit.

**Honest degradation:** if `typescript-language-server` isn't resolvable (not installed as a
project devDependency, and `npx --no-install` can't find it either), the batch leaves AST-level
edges untouched, logs why, and exits `0` — it never fails the push and never invents edges
statically. `--escalate-to-lsp` on a manual/interactive run additionally gates on this up front
(prompting before doing any work); the pre-push hook and other background invocations skip the
prompt and just degrade.

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
