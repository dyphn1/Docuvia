---
id: GRPH-006
title: Qualified (Symbol-Table-Style) node_key
status: accepted
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

- **Scope shipped (Option B, phased)**: qualified containment now resolves correctly for TS/JS,
  Python, Java, PHP, C#, and Ruby via one generic, language-agnostic mechanism in
  `lib/core/src/ast/ast-worker.ts` — `collectFunctionNodes` resolves each function's enclosing
  container through the pre-existing `findEnclosingContainerName` ancestor-walk helper (the same one
  `calls`/`implements`/`extends` attribution already used) against each language's already-declared
  `classes` node-type list, then `node-key.ts`'s new `buildQualifiedBaseKey` folds that into
  `${file}#${containerName}.${name}` (or `${file}#${name}` unchanged when there is none). No
  per-language plugin changes were needed (`lib/plugins-ast/src/languages/*.ts` is untouched) —
  extraction is centralized, and each of these six languages' grammars happen to lexically nest
  methods inside a tracked class-like node, so containment resolution fell out of the existing
  mechanism for free. C has no member functions and stays permanently N/A (no class-like node type
  is declared for it at all).

- **Follow-up shipped**: Rust, Go, and C++ containment now also resolve, via
  `implement_grph-006-rust-go-cpp-containment.md`'s three additive resolvers in `ast-worker.ts`
  (`resolveRustImplContainerName`, `resolveGoReceiverContainerName`,
  `resolveCppQualifiedContainerName`), tried in that order whenever the generic ancestor walk
  returns nothing — mutually exclusive by construction, since each checks a node shape only its own
  grammar produces:
  - **Rust**: methods live in `impl_item`, still deliberately excluded from `rustConfig.classes`
    (the target struct/enum is a _sibling_ of the method, not an ancestor) — resolved by reading the
    impl block's own `type` field instead (unwrapping `generic_type` for `impl<T> Wrapper<T>`;
    `impl Trait for Type` qualifies by the concrete `Type`, not `trait`).
  - **Go**: a `method_declaration`'s receiver type is referenced through its own `receiver:` field,
    never as an AST ancestor — resolved by reading the receiver parameter's `type` field directly
    (unwrapping `pointer_type` for a pointer receiver).
  - **C++**: inline methods already resolved via the generic ancestor walk once they were actually
    being extracted at all (see the query-bug fix below); out-of-line `Ret Class::method(){}`
    definitions are never lexically nested, so they're resolved from the qualified declarator's own
    `scope` field, recursing one level for a nested qualifier (`A::B::method` → immediate container
    `B`, matching the one-level-of-containment semantics every other language here already uses).

  **Two real, pre-existing bugs surfaced (and fixed) while implementing this**, both empirically
  verified against the real tree-sitter grammars before being fixed, not assumed:
  1. `cppConfig.queries.functions` (`lib/plugins-ast/src/languages/cpp.ts`) only matched a
     `function_declarator` whose own `declarator` field was a plain `identifier` — i.e. **free
     functions only**. Inline methods use `field_identifier` there and out-of-line ones use
     `qualified_identifier`; neither matched, so `provider.extractFunctions()` silently returned
     **zero** C++ methods, not just unqualified ones. Fixed by accepting all three declarator shapes
     via a bracketed query alternation.
  2. Once (1) was fixed, every C++ function's `name` came back as `"anonymous"`: C/C++'s
     `function_definition` has no direct `name` field at all (unlike every other language's function
     node) — the name sits two levels down, inside `function_declarator`'s own `declarator` field.
     `ast-worker.ts`'s `resolveCallableName` gained a matching fast path. This incidentally also
     fixes C's free-function names, which had the identical latent bug (never observed before,
     since it only ever affects a node shape `resolveCallableName` had no case for).

  **Tier B (`supportsQualifiedContainment`) deliberately stays `false`** for Rust, Go, and C++, same
  as before this follow-up — this is a separate decision from the Tier A work above, not a
  consequence of it. Flipping it requires verifying each LSP server's real `documentSymbol` nesting
  shape (does the parent symbol's kind/name for an impl-block/receiver/out-of-line method actually
  match what Tier A now resolves?) against a live rust-analyzer/gopls/clangd — unverifiable in the
  environment this follow-up was implemented in, so left as an explicit, separately-gated future
  step rather than guessed at. `rust-lsp-edge-provider.ts`/`go-lsp-edge-provider.ts`/
  `cpp-lsp-edge-provider.ts` each carry an updated comment recording this.

- **Tier B hardening that shipped**: `lib/core/src/lsp/lsp-edge-provider-base.ts`'s
  `BaseLspEdgeProvider` gates qualified-key construction behind an explicit
  `supportsQualifiedContainment` flag on `LspLanguageConfig`, set per-language to mirror Tier A's
  actual capability — `true` for TS/JS, Python, Java, PHP, C#, and Ruby; `false` for Go, Rust, and
  C++ (the last of these despite Tier A resolving inline C++ methods correctly, because
  `CPP_LANGUAGE_CONFIG` is shared across both `.c`/`.h` and `.cpp` files and clangd's
  `documentSymbol` tree may nest an out-of-line method under its class semantically even though it
  isn't textually nested there). The flag is deliberately never inferred from what a given LSP
  server's own `documentSymbol` hierarchy happens to nest, since that nesting is semantic and can
  disagree with Tier A's tree-sitter-ancestry rule — verified in review by a test asserting that
  Rust's flag being `false` still produces flat `file#name` keys even when the fake LSP response
  nests same-named methods under distinct class symbols.

- **Migration mechanism that shipped**: no schema migration was needed. A `docuvia_meta` key
  (`GitConstants.META_KEY_NODE_KEY_FORMAT_VERSION`, value `CURRENT_NODE_KEY_FORMAT_VERSION = "2"`,
  both in `lib/core/src/graph/node-key.ts`/`lib/core/src/git/git-constants.ts`) is stamped on every
  full ingestion (`stamp-full-ingestion-for-tier-b.ts`, the single choke point shared by `init` and
  `analyze`'s full-ingestion path) and checked by
  `lib/ui-core/src/workflows/analyze/node-key-format-guard.ts`'s `isNodeKeyFormatStale()` at the top
  of `runDeltaIngestion` — an incremental delta re-parse on top of a pre-qualified-key graph is
  refused and silently upgraded to a full re-ingestion instead, preventing exactly the mixed-format
  graph (old flat keys on untouched files, new qualified keys on reparsed files) that would
  otherwise make `findNodeIdByNodeKey` cross-file resolution silently miss matches. Git-committed
  knowledge-branch snapshots (`graph/nodes.jsonl`/`edges.jsonl`) stay frozen in whatever format they
  were last written in until a fresh `docuvia snapshot` runs post-upgrade — accepted behavior, not
  automatically rewritten.

- **Known gap, explicitly deferred, not fixed by this ADR**:
  `lib/ui-core/src/workflows/analyze/tier-c-candidates.ts` builds Tier C semantic-diff node keys
  directly from `SemanticDiffDetector` findings (`lib/ast-core`) — a separate, non-shared
  AST-diffing implementation with no containment plumbed into it at all. Those keys remain flat and
  undisambiguated. Closing this needs containment added to that separate detector too — a distinct
  unit of work, not part of this ADR's scope.
