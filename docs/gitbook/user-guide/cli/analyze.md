# `docuvia analyze`

`analyze` is Docuvia's ingestion command — it keeps the local knowledge graph (`local.db`) up to date with your source code. It has four modes, dispatched in this order: `--flush-staged-l3` wins outright over everything else; otherwise a path argument given with `--agent-authored` switches to a pure data write (no LLM call); otherwise a plain path argument runs focused LLM decision extraction; otherwise `--escalate-to-lsp` runs the Tier B batch; with none of those, it runs auto mode — see [Tiered Background Knowledge Evolution](../../adr/platform/PLAT-007-tiered-background-knowledge-evolution.md) (PLAT-007) for the full Tier A/B/C contract:

## Usage

```bash
docuvia analyze [path] [flags]
```

## Options

### Arguments

- `[path]`: A specific file or directory to run focused LLM decision extraction against — or, combined with `--agent-authored`, the target to write agent-supplied decisions against. Omit it to run auto mode — this is the mode the post-commit hook and most manual invocations use. Takes priority over `--escalate-to-lsp` if both are somehow given; `--flush-staged-l3` takes priority over `[path]` in turn (any path given alongside it is ignored).

### Flags

- `--escalate-to-lsp`: Runs the Tier B batch — LSP-precision cross-file `calls` edges over the files Tier A queued since the last batch (see Mode C below). This is the flag IMPT-002 names as "the core quality engine"; it is now implemented for real (spawn-per-batch `typescript-language-server`), not a no-op.
- `--fallback-ast`: Only relevant with `--escalate-to-lsp`. Skips the environment-readiness gate entirely and proceeds straight to the batch (which degrades honestly if the LSP truly isn't available). On an interactive terminal this skips the "LSP prerequisites aren't ready — continue with AST-only precision?" prompt; non-interactively it skips the hard failure the gate would otherwise raise. The pre-push hook always passes this flag so a push is never blocked by an unready LSP environment.
- `--force`, `-f`: Force re-running full AST ingestion even if HEAD matches the last-ingested source commit (bypassing the fast-path no-op check).
- `--interactive`, `-i`: Opt-in to interactive prompts/confirmation dialogs. Without this flag, commands will fail-fast or degrade non-interactively.
- `--agent-authored`: Requires `[path]`. Skips the LLM-config requirement and the LLM call entirely — persists a decisions payload you already have verbatim, with `source='agent-authored'` in `l3_nodes` instead of the default `source='analyze'`. See Mode B below for the payload shape and input sources. **Flag ordering matters**: pass it _after_ the positional `[path]` (`docuvia analyze <path> --agent-authored`), not before — a value-less flag before a bare positional silently absorbs it as the flag's own value, so `[path]` never reaches the command as a positional argument at all.
- `--decisions-file=<path>`: Reads the `--agent-authored` payload from a file instead of stdin. Ignored when `--agent-authored` is not also given. Same trailing-position requirement as `--agent-authored` above.
- `--stage`: Only relevant with `--agent-authored`. Instead of writing straight to `l3_nodes`, appends the payload's decisions to a local staging file, `.docuvia/pending-l3-decisions.json`, for the post-commit hook to drain later (see Mode D below). Fast, local, no DB open, no LLM call. Ignored when `--agent-authored` is not also given.
- `--flush-staged-l3`: A fourth, mutually-exclusive mode with no `[path]` — see Mode D below. This is what the post-commit hook itself runs; you normally don't invoke it by hand.

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

### Mode B variant — `--agent-authored`: write decisions you already have, no LLM call

Add `--agent-authored` and Docuvia skips the LLM entirely: instead of reading and summarizing the
target's source itself, it persists a decisions payload _you_ supply, verbatim, with
`source='agent-authored'` in `l3_nodes` (the plain Mode B path above still stamps the default
`source='analyze'`). This is the write surface an AI coding agent uses to record its own
already-produced rationale — no LLM call, no missing-env-var failure, since none of that machinery
is touched.

The payload is read from **stdin by default**, or from a file via `--decisions-file=<path>` (for
shells where piping is awkward, e.g. Windows PowerShell):

```json
{
  "decisions": [
    {
      "title": "Use optimistic locking for the session table",
      "content": "Chosen over pessimistic locks to avoid holding a row lock across the LLM round-trip; a retry-on-conflict loop wraps the write instead.",
      "nodeType": "decision",
      "confidence": 0.9
    }
  ]
}
```

- `title` (string, non-empty), `content` (string), `nodeType` (one of `"change"`, `"rule"`,
  `"decision"`, `"context"`), `confidence` (number, `0`-`1`) — all four are required per entry.
- Unlike the LLM path (which coerces an invalid/missing `nodeType` to `"context"` rather than
  failing), `--agent-authored` **hard-fails** on a schema violation — missing/empty `title`, an
  out-of-range `confidence`, an unrecognized `nodeType`, or malformed JSON all exit non-zero with a
  message naming the problem. An agent's own structured payload is a caller that can simply fix its
  input; silently coercing it would hide a real bug in whatever produced the payload.
- `{"decisions":[]}` is valid and succeeds with 0 persisted, 0 deduplicated.

**Flag ordering matters**: `--agent-authored` (and `--stage`, `--decisions-file=`) must come
_after_ the positional `[path]` — `docuvia analyze <path> --agent-authored`, never
`docuvia analyze --agent-authored <path>`. A value-less flag immediately before a bare positional
absorbs it as the flag's own value instead of leaving it as a positional argument, so `[path]`
would silently never reach the command at all.

Add `--stage` to append the payload to a local staging file instead of writing straight to
`l3_nodes` — see Mode D below for why, and for how staged decisions eventually land in the graph.
Like the direct (non-stage) `--agent-authored` path, `--stage` hard-fails with an
`FS_READ_FAILED` error if `[path]` doesn't exist at input time — a typo'd or nonexistent target
is caught immediately rather than silently leaving an entry pending forever.

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

## Mode D — `--flush-staged-l3`: drain staged agent-authored decisions

No `[path]` is given or needed — this flag wins outright over every other mode (any path given
alongside it is ignored). It is the post-commit hook's own invocation, not something you typically
run by hand: `analyze <path> --agent-authored --stage` (Mode B variant above) only ever appends to
a local staging file, `.docuvia/pending-l3-decisions.json`; this is the step that actually drains
it into `l3_nodes`.

1. **Self-gated first**: if the `commit-l3-write` hook is disabled (`docuvia hooks disable
commit-l3-write`), this exits as a no-op immediately — nothing is read or written.
2. Reads the staging file. If it's empty, exits as a no-op.
3. Resolves the current commit (`HEAD` — this step runs _after_ the post-commit hook fires, so
   `HEAD` is the commit that was just made) and its changed-file list.
4. Persists only the staged entries whose file is in _that commit's_ changed-file list, tagged with
   the real commit sha. Everything else — staged mid-session but not yet committed, or staged for a
   file this commit didn't touch — is left in the staging file untouched, for a later commit to
   pick up. (Matching assumes the command runs from the repo root — the post-commit hook always
   does; a manual `--flush-staged-l3` from a subdirectory would match nothing, so run it from the
   repo root.)
5. A persist failure partway through leaves the _entire_ staging file unchanged (no partial drop)
   — the next flush retries from the same state rather than silently losing the remainder.

`.docuvia/logs/analyze.log` gets a summary line either way (flushed/deduplicated/still-pending
counts, or the disabled/empty no-op reason).

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

Stage an agent-authored decision for a file, piping the payload on stdin (flag _after_ the path):

```bash
echo '{"decisions":[{"title":"Use optimistic locking here","content":"Avoids holding a row lock across the LLM round-trip.","nodeType":"decision","confidence":0.9}]}' | docuvia analyze src/auth/session.ts --agent-authored --stage
```

It flushes into `l3_nodes` automatically the next time you commit a change touching
`src/auth/session.ts` — no need to run `--flush-staged-l3` yourself.

Write an agent-authored decision straight to `l3_nodes` immediately, no staging, from a file
instead of stdin (e.g. in a Windows PowerShell session where piping JSON is awkward):

```bash
docuvia analyze src/auth/session.ts --agent-authored --decisions-file=decisions.json
```
