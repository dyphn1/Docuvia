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
3. **LLM (Synthesis)**: Only after LSP has provided a 100% physically accurate blast radius do we pass the data to the LLM to synthesize L3 domain knowledge.

## Consequences
- **Positive**: Guarantees absolute data integrity and reliability. AI agents using Docuvia can trust that the impact radius is 100% accurate, allowing them to refactor safely without breaking invisible dependencies.
- **Negative**: Increases the baseline indexing time and requires robust orchestration of Headless LSPs across different languages. However, this time cost is explicitly accepted in the name of quality.
