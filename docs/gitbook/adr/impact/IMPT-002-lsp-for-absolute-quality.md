---
id: IMPT-003
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
> edge case — per
> [Phase 1 — Decision Integration §9n](../../analysis/phase1-decision-integration.md), a real
> Windows spawn bug meant this "100%" promise silently degraded to AST-only on _every_ batch, on
> _every_ Windows machine, for the whole of Slice 3's life, until a same-day fix. **Scope note**
> also missing from the original text: LSP-precision cross-file edges currently cover
> **TypeScript/JavaScript only** (per-language dispatch table, PLAT-007 §8e/D4); every other
> language stays at AST-level precision until its own plugin exists — this ADR's Decision section
> reads as language-agnostic and should not be taken as a claim that Rust/Go/etc. already get the
> same guarantee.
