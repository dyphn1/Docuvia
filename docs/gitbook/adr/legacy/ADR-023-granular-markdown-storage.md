---
---
Date: 2026-07-02
Status: Superseded
Supersedes: ADR-017
Supplements: ADR-004, ADR-014
---

# ADR-023: JSONL + Granular Markdown for Git-Native Storage

## Status

Accepted

## Context

> **Implementation status:** Tracked in the roadmap, not here — see [Orphan Branch R/W Protocol](../roadmap/features/orphan-branch-r-w-protocol.md) and [`docuvia sync` Bidirectional CLI](../roadmap/features/docuvia-sync-bidirectional-cli.md) in [Phase 4](../roadmap/phase-4-git-isomorphic-sync-temporal-knowledge.md).

Following [ADR-022](./ADR-022-wasm-ast-blast-radius.md), Docuvia uses `web-tree-sitter` for local, fast AST diffing. We now need to define the exact storage format for the `docuvia-knowledge` orphan branch.

The storage format must satisfy conflicting requirements:

1. **Machine-Readable Efficiency**: Fast parsing for dependency resolution without memory bloat.
2. **Human-Readable & Ecosystem Compatibility**: Understandable by humans without IDEs, and directly consumable by personal knowledge management tools like Tolaria or Obsidian.
3. **Merge-Conflict Resistant**: Multiple agents/developers extracting knowledge concurrently shouldn't cause heavy Git merge conflicts.
4. **Transparent DB Materialization**: It must easily sync back into Local SQLite and Remote PostgreSQL databases.

## Decision

We will use a dual-format structure on the `docuvia-knowledge` branch: **JSONL for structural metadata** and **Granular Markdown for semantic knowledge**.

### 1. Storage Structure (The Markdown Vault)

The branch will mirror the source code directory structure, turning the knowledge base into a standard Markdown Vault:

```text
docuvia-knowledge/
├── graph/
│   ├── nodes.jsonl         # L1: File/Symbol coordinates and AST hashes
│   └── edges.jsonl         # L1: Call/Import relationships
└── knowledge/
    └── src/
        └── services/
            ├── auth.md                 # L2: Module-level summary
            └── auth/
                ├── login.md            # L3: Function-level intent
                └── AuthService.md      # L3: Class-level architecture
```

### 2. Transparent Execution via Git Hooks

Users and agents should never manually trigger delta updates. The entire pipeline runs transparently via Git hooks (`post-commit` / `post-merge`):

- When a user commits code, the local hook fires.
- The `ast-core` WASM engine compares AST signatures, determines the blast radius, and updates _only_ the affected JSONL lines and specific `.md` files.
- The updated knowledge files are quietly committed to the `docuvia-knowledge` branch.

### 3. Materialization to Local DB (SQLite) & Central DB (PostgreSQL)

The databases (both local SQLite for MCP caching and remote PostgreSQL for pgvector) are strictly **Materialized Views** of the Git branch.

- **The Sync Mechanism**: We rely on Git's native tree-hash diffing (`git diff --name-status <old_hash> <new_hash>`).
- **Local DB (SQLite)**: Immediately after the Git hook updates the branch, it reads the exact diffs and upserts/deletes the local SQLite cache to keep IDE MCP tools perfectly in sync.
- **Remote DB (PostgreSQL)**: When the branch is pushed to the server, a webhook triggers the Metabolism Worker. It runs the same `git diff` logic to update `l2_nodes` and `l3_nodes` tables via `INSERT ON CONFLICT DO UPDATE`.

## Rationale

- **Zero Conflict**: Adding/editing a function edits a dedicated `.md` file. Deleting a function runs `rm login.md`. JSONL lines isolate structural changes. Git merge conflicts are practically eliminated.
- **Tolaria Integration**: The `knowledge/` folder is a valid Markdown vault, fully compatible with tools like Tolaria/Obsidian out-of-the-box using wikilinks.
- **Invisible UX**: By wiring the delta calculation into Git hooks, the developer (and AI coding agents) experience zero friction. They write code, commit, and the knowledge graph updates silently in the background.

## Consequences

- **Positive**: Complete data ownership and offline resilience. The DB is fully restorable from Git.
- **Negative**: We must manage Git worktrees carefully inside the hook to edit the `docuvia-knowledge` branch without disrupting the user's active working tree.
superseded_by: []
