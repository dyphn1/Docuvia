# Graph (GRPH) — Graph Model, Ingestion, AST Engine

**Current Model**:
The Docuvia2 Graph architecture enforces a strict separation between L3 (domain concepts) and L2 (code implementation) using a unified AST Microkernel (`lib/ast-core`). The knowledge graph structure requires an explicit validity status (`l3_nodes.validity_status`) to manage trustworthiness, while a comprehensive Read-side Query Layer provides access to the persisted SQLite data for all read operations.

## Decisions

| ID                                                      | Decision                                | Status   | Notes                                                                                                                                                                      |
| ------------------------------------------------------- | --------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [GRPH-001](GRPH-001-l3-to-l2-knowledge-abstraction.md)  | L3 to L2 Knowledge Abstraction          | proposed | Carries forward legacy ADR-005                                                                                                                                             |
| [GRPH-002](GRPH-002-two-phase-knowledge-validity.md)    | Two-Phase Knowledge Validity            | proposed | Carries forward legacy ADR-011                                                                                                                                             |
| [GRPH-003](GRPH-003-unified-ast-microkernel.md)         | Unified AST Microkernel                 | accepted | Carries forward legacy ADR-020 (Implemented in `lib/ast-core`)                                                                                                             |
| [GRPH-004](GRPH-004-cross-project-l1-tag-linking.md)    | Cross-Project L1 Tag Linking            | proposed | Carries forward legacy ADR-024 (Reduced scope)                                                                                                                             |
| [GRPH-005](GRPH-005-read-side-query-layer.md)           | Read-side Query Layer                   | accepted | New: Completes the read layer for `query`/`review`/`impact`, includes known OOM limits on unpaginated full-table reads                                                     |
| [GRPH-006](GRPH-006-qualified-symbol-table-node-key.md) | Qualified (Symbol-Table-Style) node_key | proposed | New: replaces flat, collision-disambiguated `node_key` with structurally-qualified names; touches every AST plugin + a persisted-graph migration, not scoped/estimated yet |
