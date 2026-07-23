---
id: IMPT-002
title: LSP Escalation for Absolute Quality
status: accepted
date: 2026-07-12
domains: [impact]
supersedes: [legacy/ADR-015, legacy/ADR-025]
superseded_by: []
---

# LSP Escalation for Absolute Quality

## Context

In previous iterations, AI agents and developers attempted to bypass the Language Server Protocol (LSP) in favor of pure AST scanning (similar to GitNexus) to shave a minute or two off the indexing time. The assumption was that "speed" is the paramount metric.

This assumption is fundamentally flawed. **Engineering requires quality over quantity. Quality comes first, then quantity, and finally time.**
Compiling a massive project like Hermes Agent takes roughly 3 minutes, while a pure AST indexer takes ~2 minutes. Saving 1 minute at the cost of incomplete, unreliable data (missing complex type inferences, dynamic resolution, and cross-file dependencies) makes the entire knowledge graph untrustworthy. Fast but fragmented data is useless.

## Decision

We mandate the **AST + LSP + LLM Tri-Layer Architecture** for structural analysis and impact generation.

1. **AST (Speed)**: Used for rapid skeleton construction and immediate local file heuristics.
2. **LSP Escalation (Quality)**: We MUST escalate to a Headless LSP instance for cross-file dependency resolution, precise type inference, and accurate reference finding. The `--escalate-to-lsp` flag is not a discarded idea; it is the core quality engine.
3. **LLM (Synthesis)**: Only after LSP has provided the most physically accurate blast radius the environment allows do we pass the data to the LLM to synthesize L3 domain knowledge.

## Consequences

- **Positive**: When LSP is available, AI agents using Docuvia can trust cross-file edges as LSP-precision, not string-matched. When it is not (see the honest-degradation note below), the impact radius still reflects reality — it never invents an edge to paper over the gap.
- **Negative**: Increases the baseline indexing time and requires robust orchestration of Headless LSPs across different languages. However, this time cost is explicitly accepted in the name of quality.

> **Amendment (2026-07-18 — implementation reconciliation)**: this ADR's original "100%
> accurate"/"guarantees absolute data integrity" language overstated what the shipped design
> actually promises, and was never corrected here even after [PLAT-007](../platform/PLAT-007-tiered-background-knowledge-evolution.md)
> (the implementation-level ADR under this mandate) settled the real contract: LSP-unavailable
> **degrades honestly** — AST-level edges are retained, the degradation is JSONL-logged and
> `doctor`-explainable, and statically invented edges are prohibited. This is not a hypothetical
> edge case — a real Windows spawn bug (see PLAT-007's Consequences section) meant this "100%"
> promise silently degraded to AST-only on _every_ batch, on _every_ Windows machine, for the
> whole of Slice 3's life, until a same-day fix. **Scope note** also missing from the original
> text: LSP-precision cross-file edges currently cover **TypeScript/JavaScript only**
> (per-language dispatch table, PLAT-007's Tier B section); every other language stays at
> AST-level precision until its own plugin exists — this ADR's Decision section reads as
> language-agnostic and should not be taken as a claim that Rust/Go/etc. already get the same
> guarantee. See the Language Support Matrix below for the concrete per-language table.

## Language Support Matrix (added 2026-07-19)

Per-language status of the tri-layer architecture. AST parsing (`lib/plugins-ast`) covers all
eleven languages below; LSP escalation (Tier B, `--escalate-to-lsp`) is implemented for all nine
registry keys (`typescript`, `python`, `go`, `rust`, `cpp`, `java`, `csharp`, `php`, `ruby`),
covering all eleven language/extension rows below (TypeScript and JavaScript share the
`typescript` key; C and C++ share the `cpp` key). A language with AST-only support still gets full
L2 nodes/edges from static parsing — it is missing only the LSP-precision cross-file `calls`
repair described in this ADR's Decision section.

| Language   | File Extensions                                             | AST Parsing (Tier A) | LSP Escalation (Tier B)             |
| ---------- | ----------------------------------------------------------- | :------------------: | ----------------------------------- |
| TypeScript | `.ts`, `.tsx`, `.mts`, `.cts`                               |          ✅          | ✅ `typescript-language-server`     |
| JavaScript | `.js`, `.jsx`, `.mjs`, `.cjs`                               |          ✅          | ✅ `typescript-language-server`     |
| Python     | `.py`                                                       |          ✅          | ✅ `pyright` (`pyright-langserver`) |
| Go         | `.go`                                                       |          ✅          | ✅ `gopls`                          |
| Rust       | `.rs`                                                       |          ✅          | ✅ `rust-analyzer`                  |
| Java       | `.java`                                                     |          ✅          | ✅ `eclipse.jdt.ls` (`jdtls`)       |
| C          | `.c`, `.h`                                                  |          ✅          | ✅ `clangd`                         |
| C++        | `.cpp`, `.cxx`, `.cc`, `.hpp`, `.hxx`, `.hh`, `.cu`, `.cuh` |          ✅          | ✅ `clangd`                         |
| C#         | `.cs`                                                       |          ✅          | ✅ `csharp-ls`                      |
| PHP        | `.php`, `.phtml`, `.php3`, `.php4`, `.php5`, `.phps`        |          ✅          | ✅ `intelephense`                   |
| Ruby       | `.rb`, `.rake`, `.gemspec`                                  |          ✅          | ✅ `ruby-lsp`                       |

New languages gain LSP escalation by adding a provider behind the `IEdgeResolutionProvider` seam
(PLAT-007 §8b) and a per-language dispatch entry (PLAT-007 §8e/D4) — never a hardcoded TS/JS
check. No such provider is scheduled; add one here when a language plugin ships.

**Update (2026-07-22, multi-language-lsp-support plan, Slice 0):** this matrix is now backed by a
per-language provider _registry_ (`TOKENS.EdgeResolutionProviders`, keyed by `TierBLanguageId`),
not a single provider bound to one token — Slice 0 was a pure foundation/refactor (extracted the
generic LSP batch logic into a shared `BaseLspEdgeProvider`, generalized the registry/dispatch
plumbing) with no new language shipped and no matrix row flipped. The registry resolves to just
`{ typescript }` today, identical in substance to the single-provider shape this matrix already
documented; each language slice below adds one more registry key and flips its own row.

**Update (2026-07-22, multi-language-lsp-support plan, Slice 1):** Python is the first language to
ship LSP escalation beyond TS/JS -- `pyright` (`pyright-langserver --stdio`), resolved via the same
npm/npx binary-resolution strategy TS/JS already uses (`resolveNpmNpxBinary`), registered under
`TOKENS.EdgeResolutionProviders`'s `python` key. The registry now resolves to
`{ typescript, python }`.

**Update (2026-07-22, multi-language-lsp-support plan, Slices 2-8):** Go, Rust, PHP, C/C++, Ruby,
C#, and Java shipped in the same session, each adding one more registry key behind
`IEdgeResolutionProvider`. `TOKENS.EdgeResolutionProviders` now resolves all nine keys —
`{ typescript, python, go, rust, cpp, java, csharp, php, ruby }` — and `register.ts` registers
every one of them. The matrix above now reflects full LSP escalation coverage for all eleven
language/extension rows.
