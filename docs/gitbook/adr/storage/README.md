# Storage (STOR) — Knowledge Graph Persistence

**Current Model**: 
The knowledge graph's **sole source of truth is the Git repository**, specifically the `docuvia-knowledge` orphan branch, where data is stored in JSONL and Markdown formats. The local SQLite database (`local.db` inside `.docuvia/`) acts strictly as an **ephemeral query engine**.

## How it works

- **Hydration**: When the workspace is loaded, the JSONL from the Git branch hydrates the SQLite database.
- **Write Path**: `analyze` extracts nodes, updates SQLite for immediate queryability, and triggers a flush to the Git branch.
- **Isolation**: The `.docuvia/` directory is automatically injected into `.gitignore` during `init` to prevent committing the ephemeral SQLite binaries to the main source tree.

## Decisions

| ID | Decision | Status | Notes |
|----|----------|--------|-------|
| [STOR-001](STOR-001-git-branch-source-of-truth.md) | Git Branch as Sole Source of Truth | accepted | Supersedes legacy ADR-004, subsumes ADR-014 |
| [STOR-002](STOR-002-sqlite-ephemeral-query-engine.md) | SQLite as Ephemeral Query Engine | accepted | Replaces the "tiered storage" coexistence model of legacy ADR-017 |
| [STOR-003](STOR-003-jsonl-granular-markdown-format.md) | JSONL + Granular Markdown On-Disk Format | accepted | Carries forward legacy ADR-023 |
| [STOR-004](STOR-004-git-blob-native-identity.md) | Git Blob-Native Identity (Content Hash) | proposed | Carries forward legacy ADR-016 |
| [STOR-005](STOR-005-symbol-level-node-identity.md) | Symbol-Level Node Identity (Path-Keyed ID + Feature Hash) | proposed | New: extends STOR-004 to symbol granularity |

## History

Docuvia1 began git-first (ADR-004), pivoted to SQLite-primary (ADR-014), and patched the coexistence in ADR-017. Docuvia2 resolves the tension by returning Git to its rightful place as the sole source of truth, demoting SQLite to a transient query engine. See [legacy mapping](../legacy/README.md).
