# Impact (IMPT) — Blast Radius / Impact Analysis

**Current Model**:
Docuvia2's impact analysis philosophy is built on the principle of **"Quality First, Speed Last"**. While simple SQL joins can provide fast local heuristics, true architectural reliability requires the precision of a Language Server.

The architecture mandates a Tri-Layer approach: **AST + LSP + LLM**.

## Decisions

| ID | Decision | Status | Notes |
|----|----------|--------|-------|
| [IMPT-001](IMPT-001-sql-single-hop-blast-radius.md) | SQL Single-hop Blast Radius (Heuristic Filter) | accepted | Fast heuristic filter (Currently implemented) |
| [IMPT-002](IMPT-002-lsp-for-absolute-quality.md) | LSP Escalation for Absolute Quality | accepted | **Architecture accepted, Pending Implementation**. Re-establishes LSP dominance in accuracy, rejecting the sacrifice of data integrity purely for speed. |
