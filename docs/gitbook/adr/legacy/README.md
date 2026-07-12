# Legacy ADRs

This directory contains the original, frozen Decision Records (ADR-001 through ADR-036) from Docuvia1.
They are kept for historical context and archaeological record. **Do not modify these files.**

New decisions in Docuvia2 follow a domain-driven structure (e.g., `STOR-001`, `PLAT-002`).

## Mapping Table (Legacy to New Home)

| Legacy ADR | Disposition | New Location / Supeding Record |
|---|---|---|
| ADR-001 | **Removed** | (Inapplicable to current CLI-first model) |
| ADR-002 | Carried Forward | `platform/PLAT-002` |
| ADR-003 | **Removed** | (Overly ambitious vision: Server-side zero-to-one handshake) |
| ADR-004 | **Superseded** | Merged into `storage/STOR-001` (Git Branch Truth) |
| ADR-005 | Carried Forward | `graph/GRPH-001` |
| ADR-006 | **Removed** | (Overly ambitious vision: Self-Evolution Swarm) |
| ADR-007 | **Removed** | (Overly ambitious vision: 4-way RAG Routing) |
| ADR-008 | **Removed** | (Overly ambitious vision: Database-Driven Async Queue) |
| ADR-009 | **Removed** | (Overly ambitious vision: Token Management & Extraction Efficiency) |
| ADR-010 | Reduced Scope | `retrieval/RETR-002` |
| ADR-011 | Carried Forward | `graph/GRPH-002` |
| ADR-012 | **Removed** | (Overly ambitious vision: Document Misc Pool) |
| ADR-013 | Moved Out | Moved to `docs/gitbook/guidelines/` |
| ADR-014 | Superseded | Merged into `storage/STOR-001` |
| ADR-015 | **Removed** | (Overly ambitious vision: Progressive Enrichment & AST/LSP) |
| ADR-016 | Carried Forward | `storage/STOR-004` (was 005) |
| ADR-017 | Revised | `storage/STOR-002` (Removed dual-coexistence) |
| ADR-018 | **Removed** | (Overly ambitious vision: Temporal & Conceptual Bidirectional Linking) |
| ADR-019 | **Deprecated**| Does not enter new structure |
| ADR-020 | Carried Forward | `graph/GRPH-003` (was 005) |
| ADR-021 | **Superseded**| Replaced by `platform/PLAT-001` (Virtual Contracts) |
| ADR-022 | **Removed** | (Overly ambitious vision: WASM AST Blast Radius) |
| ADR-023 | Carried Forward | `storage/STOR-003` |
| ADR-024 | Reduced Scope | `graph/GRPH-004` (was 006) |
| ADR-025 | **Removed** | (Overly ambitious vision: Hybrid Temp-File Overlay) |
| ADR-026 | Carried Forward | `llm/LLM-001` |
| ADR-027 | Carried Forward | `platform/PLAT-004` |
| ADR-028 | **Removed** | (Overly ambitious vision: Semantic Deduplication) |
| ADR-029 | Carried Forward | `retrieval/RETR-003` |
| ADR-030 | **Removed** | (Inapplicable to current CLI scope: Template Inheritance) |
| ADR-031 | **Deprecated**| `platform/PLAT-005` (Remains deprecated) |
| ADR-032 | **Removed** | (Overly ambitious vision: Parallel Swarm Review) |
| ADR-033 | Moved Out | Absorbed by `testing-and-quality-architecture.md` |
| ADR-034 | Carried Forward | `interface/IFCE-001` (was 003) |
| ADR-035 | Carried Forward | `interface/IFCE-002` (was 004) |
| ADR-036 | Carried Forward | `interface/IFCE-003` (was 005) |
