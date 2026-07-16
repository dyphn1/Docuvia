# `docuvia analyze`

`analyze` is Docuvia's ingestion command — it keeps the local knowledge graph (`local.db`) up to
date with your source code. It has two modes, dispatched on whether a path argument is given
(PLAT-007 — see [Tiered Background Knowledge Evolution](../../adr/platform/PLAT-007-tiered-background-knowledge-evolution.md)):

## Usage

```bash
docuvia analyze [path]
```

### Arguments

- `[path]` _(Optional)_: A specific file or directory to run focused LLM decision extraction
  against. **Omit it** to run auto mode (see below) — this is the mode the post-commit hook and
  most manual invocations use.

### Flags

- `--escalate-to-lsp`: _(Not yet implemented)_ Tier B's LSP quality pass — reserved, currently a
  no-op.

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
   a later, more expensive cross-file consistency pass (Tier B), not yet implemented in this
   milestone.

Every run — no-op, full, or delta — writes a structured JSONL log to `.docuvia/logs/analyze.log`.

## Mode B — Path given: focused LLM decision extraction

Passing a file or directory switches to a focused pass: Docuvia reads the target's source,
sends it to an LLM, and extracts concrete implementation decisions/rules/context as L3 nodes
attached to the graph (deduplicated by content hash). This requires
`AI_DOCUVIA_INTEGRATIONS_OPENAI_BASE_URL` and a model
(`AI_DOCUVIA_MODEL`/`AI_DOCUVIA_FAST_MODEL`) to be set — missing env vars are a hard failure.

## Examples

Update the graph from the current source state (auto mode):

```bash
docuvia analyze
```

Extract decisions from a specific module (focused LLM extraction):

```bash
docuvia analyze src/auth/
```
