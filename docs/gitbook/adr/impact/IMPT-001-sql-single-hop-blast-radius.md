---
id: IMPT-001
title: SQL Single-Hop Blast Radius (Heuristic Filter)
status: accepted
date: 2026-07-12
domains: [impact]
supersedes: []
superseded_by: []
---

# SQL Single-Hop Blast Radius (Heuristic Filter)

## Context

While the ultimate source of truth for dependencies must be driven by an LSP (see IMPT-002), spinning up an LSP for every minor keystroke or initial filtering step is unnecessarily heavy. We need a rapid "first pass" filter.

## Decision

The `impact` and `review` commands utilize a **single-hop SQL JOIN** query over the `node_links` table in SQLite (`getIncomingEdges` / `getOutgoingEdges`) as a **Fast Heuristic Filter**.

## Consequences

- **Positive**: Provides instantaneous feedback based on the last known Git snapshot. Excellent for immediate UI rendering or preliminary filtering before passing candidates to the LSP.
- **Negative**: It does not capture transitive dependencies (multi-hop) natively and relies on potentially stale AST data if an unsaved buffer exists. Must not be used as the final word for automated refactoring safely limits.

> **Empirical validation (2026-07-24, C# benchmark)**: [`docs/cli-test-analysis/csharp-cli-benchmark.md`](../../cli-test-analysis/csharp-cli-benchmark.md)
> ran `impact` (no `--escalate-to-lsp`) against `PSCmdlet` (PowerShell/PowerShell) and `IGrain`
> (dotnet/orleans) — two foundational base types with thousands of real-world implementors/callers.
> Both returned a blast radius of exactly **1 file**, confirming the single-hop design in practice,
> not just in theory. For comparison, Code-Review-Graph's transitive traversal on the same symbols
> surfaced hundreds-to-thousands of impacted files. This is expected given this ADR's documented
> negative consequence, not a regression — but the benchmark session deliberately stayed in the
> no-LLM-adjacent lane and did not exercise `--escalate-to-lsp` (IMPT-002's Tier B), so it does
> **not** yet confirm whether LSP escalation closes this gap for a foundational symbol like these.
> That is the natural next benchmark slice before treating this heuristic's real-world sufficiency
> as settled.

> **Fixed (2026-07-24, same day): the "1 file" result was not the single-hop design working as
> intended — it was three separate bugs compounding, all upstream of the SQL JOIN this ADR
> describes.** `getIncomingEdges` was already correctly single-hop-over-all-edge-types; the
> problem was that inheritance/interface-implementation edges essentially never existed in the
> graph to be one hop away from:
>
> 1. **No `extends`/`implements` AST query existed for 10 of 11 languages.** Only
>    `typescript.ts` defined them (`lib/plugins-ast/src/languages/*.ts`) — C#, Java, JavaScript,
>    Python, C++, PHP, and Ruby now have them too (`base_list`, `superclass`/`super_interfaces`,
>    `class_heritage`, the `class_definition` argument list, `base_class_clause`,
>    `base_clause`/`class_interface_clause`, and `superclass`, respectively). Go/Rust/C stay
>    unsupported — Go embedding and Rust trait `impl` blocks don't fit this pipeline's
>    "nested inside the class declaration" assumption, and C has no inheritance concept.
> 2. **The compiled Query API was silently disabled for every language, including TypeScript.**
>    `ast-worker.ts` had a comment reading "intentionally not calling `provider.initQueries()`"
>    because some pre-existing pattern failed to compile against the installed grammar —
>    `typescript.classes` (wrong field node type), `go.classes` (field belongs to the nested
>    `type_spec`, not `type_declaration`), and three `ruby.ts` patterns (`"scope"` isn't a real
>    node type — it's `scope_resolution`; `"command_call"` doesn't exist in this grammar version
>    at all; the `imports` predicate used invalid JS-style `@_method.match?(...)` syntax instead
>    of tree-sitter's `(#match? @_method "...")`). One field failing made `DefaultProvider`
>    throw and fall back to `descendantsOfType` for every field, for every language — silently, for
>    every file ever parsed. `DefaultProvider.initQueries()` now compiles each field independently
>    (`lib/ast-core/src/language-provider.ts`), the five broken patterns are fixed, and
>    `ast-worker.ts` calls `initQueries()` again. Without this, the new language configs from (1)
>    would have compiled cleanly but never actually run — `descendantsOfType` returns the whole
>    clause node (e.g. `": PSCmdlet, IDisposable"`), which cannot resolve to a real node name.
>    Re-enabling `initQueries()` also surfaced a real (if narrower-scoped) regression it had been
>    masking: `typescript.ts`/`javascript.ts`'s compiled `functions` query only covers
>    `function_declaration`/`method_definition`, while their `descendantsOfType` fallback array
>    covers 6 kinds including arrow functions and function expressions (which have no queryable
>    "name" field of their own — see `resolveCallableName()` in `ast-worker.ts`). Caught by
>    `artifacts/cli/test/integration/dist-build.test.ts` running the real compiled build, not a
>    hand-written case — both configs now omit a `functions` query entirely, staying on the
>    (already-correct, already-tested) fallback for that one field only.
> 3. **`ScopeResolver.resolveCall()` only resolves same-file locals and explicitly-imported
>    names** (`lib/core/src/graph/scope-resolver.ts`) — a JS/TS-shaped model. A base class is
>    routinely visible with no import at all in C# (same namespace), Java/Go (same package), etc.
>    `persist-ast-graph.ts`'s `linkSymbolReference` now falls back to `store.graph.findNodeByName`
>    (the same project-wide exact/LIKE lookup `impact`/`query` already use) when import-based
>    resolution fails, for `extends`/`implements` edges only — left off `calls`, where a common
>    short method name would false-match far more often than a class/interface name would.
>
> Re-run against a synthetic C# fixture (one `PSCmdlet` base + 6 direct subclasses, no `using`
> directive between them, mirroring real PowerShell/PowerShell style) through the real CLI:
> `docuvia impact "PSCmdlet"` went from **1 file / Risk: MEDIUM** to **7 files / Risk: HIGH**.
> The single-hop design itself is unchanged and still the documented heuristic — this fix is
> entirely about the graph actually containing the inheritance edges for that one hop to traverse.
> Re-running the original PowerShell/PowerShell and dotnet/orleans benchmark slice is the natural
> follow-up to confirm the same order-of-magnitude improvement on the real target repos, and
> `--escalate-to-lsp`'s effect on top of this fix remains, as before, unverified.
