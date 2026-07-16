# Platform (PLAT) — Layering, Local-first, Server Sync

**Current Model**:
Docuvia2 adopts the **Virtual Contracts Architecture**, replacing the legacy Hexagonal Architecture. All implementations must map to interfaces defined in `lib/contracts`, self-register via `docuviaFactory`, and be configured via `docuviaMemory` with UUID isolation. This completely prohibits cross-dependencies between implementation libraries (e.g., `lib/schema` and `lib/ast-core`).

## Decisions

| ID                                                             | Decision                                     | Status   | Notes                                                                                                                                                                          |
| -------------------------------------------------------------- | -------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [PLAT-001](PLAT-001-virtual-contracts-supersedes-hexagonal.md) | Virtual Contracts Supersedes Hexagonal       | accepted | New: Replaces ADR-021                                                                                                                                                          |
| [PLAT-002](PLAT-002-local-first-graceful-degradation.md)       | Local-First Graceful Degradation             | accepted | Carries forward legacy ADR-002                                                                                                                                                 |
| [PLAT-003](PLAT-003-remote-sync-technology-provider.md)        | Remote Sync Technology Provider              | accepted | New: `lib/remote-api` template                                                                                                                                                 |
| [PLAT-004](PLAT-004-zero-interruption-invisible-indexing.md)   | Zero-Interruption Invisible Indexing         | accepted | Carries forward legacy ADR-027 (Post-commit hook)                                                                                                                              |
| [PLAT-005](PLAT-005-svn-integration-deprecated.md)             | SVN Integration Deprecated                   | accepted | Carries forward legacy ADR-031 (Remains deprecated)                                                                                                                            |
| [PLAT-006](PLAT-006-init-single-flight-lock.md)                | Coarse-Grained Single-Flight Lock for `init` | accepted | Rejects leader/follower outcome-mirroring; wait-then-rerun instead                                                                                                             |
| [PLAT-007](PLAT-007-tiered-background-knowledge-evolution.md)  | Tiered Background Knowledge Evolution        | accepted | Implements PLAT-004's delta promise + IMPT-003's tri-layer: per-commit AST delta (`analyze` auto mode), debounced LSP batch + snapshot, budgeted LLM L3 queue; no new commands |
