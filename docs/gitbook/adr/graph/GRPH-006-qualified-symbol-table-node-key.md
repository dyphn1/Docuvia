---
id: GRPH-006
title: Qualified (Symbol-Table-Style) node_key
status: proposed
date: 2026-07-29
domains: [graph]
supersedes: []
superseded_by: []
---

# Qualified (Symbol-Table-Style) node_key

## Context

`node_key` (`UNIQUE(project_id, node_key)`, the identity every edge — Tier A `calls`/`implements`/
`extends` and Tier B's LSP-resolved `calls` — resolves through via `findNodeIdByNodeKey`) is built
as a flat `${file}#${name}`, disambiguated only on an actual collision (`persist-ast-graph.ts`'s
`buildUniqueNodeKey`: bare key normally, `@Lstartline` once a same-named symbol in the same file is
already used, a `#n` counter for the residual case where even that repeats).

This is order-dependent by construction: _which_ of two same-named symbols keeps the bare key and
which gets pushed to `@Lline` depends entirely on insertion order, not on either symbol's own
identity. That's a tolerable internal detail as long as exactly one code path ever assigns keys.
It stopped being tolerable once a second, independent path needed to _predict_ the same key Tier A
would assign, without access to Tier A's own insertion order: Tier B's LSP edge resolution
(`lsp-edge-provider-base.ts`) computes `node_key` for a symbol found via `textDocument/references`
purely from what the LSP server reports, then looks it up against Tier A's already-persisted graph.

Found and fixed across three same-day commits (2026-07-29, `2e4176d1`/`c04f0770`, prompted by a
live CLI benchmark session against real TypeScript/C# projects): Tier B originally built raw
`${file}#${name}` with **no** disambiguation at all — any collision silently misattached an edge to
the wrong symbol or dropped it as a false duplicate. Extracting Tier A's disambiguation algorithm
into shared code (`node-key.ts`) and having Tier B pre-sort a file's symbols by line before
assigning keys closes the gap for the common case (two same-named functions/methods in one file —
Tier A's own `functions[]` is itself a source-order tree-sitter walk, so line-sorting converges
onto the same order) and a narrower related case (grouping function/method-kind symbols before
class-kind symbols, matching Tier A's functions-array-then-classes-array phase separation).

What's left, and why line-sorting alone can't close it: if a function and a class happen to share
a name in one file, Tier A's own scheme still resolves this by _coincidence of processing order_
(all of `functions[]`, then all of `classes[]`, as two separate passes — not one merged,
structurally-aware pass), not by any principle that generalizes. Every fix so far has been "make
Tier B's heuristic converge harder on Tier A's insertion order" — chasing a moving, accidental
target instead of removing the target's accidental-ness.

## Decision

Replace the flat, collision-disambiguated `node_key` scheme with a **qualified name**, built
deterministically from a symbol's own structural containment — e.g. `file#ClassName.methodName`
for a method, `file#name` unchanged for anything with no enclosing symbol. Two symbols named
`handle` in different classes get _structurally different_ keys by construction; there is no
collision to disambiguate, no insertion-order dependency, and nothing for a second, independent
producer (Tier B's LSP path, or any future non-AST source of edges) to have to predict by
replaying Tier A's own processing order.

This is not a Tier B-only change. It requires:

1. **AST extraction gains containment.** `ParsedAstFileData.functions`
   (`lib/contracts/src/interfaces/ast.interfaces.ts`) currently has no "which class owns this"
   field at all — `{name, startLine, endLine, contentHash}`. Every language's AST plugin
   (`lib/plugins-ast/src/languages/*.ts`) needs to start capturing and threading through enclosing-
   symbol context, not just Tier A's TypeScript path.
2. **A `node_key` format migration.** Every already-persisted graph has flat-format keys; a schema
   change here needs a defined migration (re-derive on next full ingestion? one-time backfill
   pass?) rather than silently producing two incompatible formats side by side.
3. **Every other `node_key` consumer updates.** `query`, `impact`, `export-topology`, L3 anchoring
   (`lib/core/src/git/l3-import.service.ts`, `anchor-resolution.ts`) all build or parse `node_key`
   strings today assuming the flat shape.

## Consequences

- **Positive**: eliminates this entire class of bug by construction, not by convergent heuristics.
  Any future edge-resolution source (LSP for a new language, a different static analyzer, ...)
  gets deterministic, order-independent key agreement with Tier A for free — no equivalent of this
  session's line-sort/grouping work needed per new producer.
- **Negative**: meaningfully larger than the fix this ADR is prompted by. Touches every language's
  AST plugin, the persisted-graph schema (migration path required), and every downstream consumer
  of `node_key` — not scoped or estimated here; that's the next planning step before implementation
  starts.
- **Until this ships**: the residual gap from `2e4176d1` stands as documented there — a
  function/method colliding by name with a class-as-a-whole in the same file is not guaranteed to
  resolve to the same node Tier A assigned it. Narrow and rare relative to the common case (already
  fixed), not a regression against anything that worked before Tier B's LSP path existed.
