# Architecture Blueprint 2026

## Core Architectural Pillars

Through adversarial debates and rigorous grill sessions, we have converged on 5 non-negotiable architectural pillars for Docuvia to prevent scope creep while maintaining an advanced Agentic OS capability.

### I. Microkernel & Plugin Ecosystem

- **Decision**: The core (`@workspace/api-server`) remains completely agnostic to programming languages.
- **Implementation**: AST parsing engines (e.g., Tree-sitter) are split into dynamic language plugins (e.g., `@workspace/plugin-ast-typescript`) loaded at runtime based on the project's file extension composition.

### II. Database as IPC & Local SQL Index

- **Decision**: Abandon heavy gRPC/JSON transmission for graph nodes between processes.
- **Implementation**: AST scanners perform direct `INSERT`s into a local SQLite (or PostgreSQL) database. The Microkernel and VS Code Client query the graph purely via zero-overhead SQL `SELECT` or recursive CTEs (`WITH RECURSIVE`) to determine Blast Radius.

### III. Progressive Enrichment (Fallback & Dual Engine)

- **Decision**: Avoid cold-starting memory-heavy LSPs by default.
- **Implementation**:
  1. **AST Fast-Scan (Fallback)**: Establishes a baseline 3D spatial map of the codebase.
  2. **Domain Resolvers**: Lightweight scripts (e.g., `tsconfig_resolver`) that link implicit connections.
  3. **LSP On-Demand Tool**: Wake up a full Language Server Protocol (LSP) daemon predictively in the background only when the AI agent needs precise cross-file type resolution or dirty state (unsaved buffer) synchronization.

### IV. Git-Native & Environment-Aware Ingestion

- **Decision**: The pipeline must gracefully degrade for non-versioned folders while maximizing performance in Git repositories.
- **Implementation**:
  - Uses `git_blob_hash` and `content_hash` as stable Node identities.
  - Prevents Git checkout thrashing by monitoring `.git/HEAD`, pausing the file watcher, and performing zero-parse SQL state flips (`is_active` toggling) based on blob hashes.

### V. Self-Healing 4D Graph & Tiered Storage

- **Decision**: The graph must learn historical rules without endlessly bloating the local database.
- **Implementation**:
  - **Tombstones & GC**: Deleted code becomes tombstones. A background worker periodically compresses and pushes expired historical records into an invisible `docuvia-knowledge` orphan branch.
  - **Rebase Immunity**: L3 historical rules are bidirectionally linked to Git Commits via Git Notes and `content_hash`. If a commit is rewritten (rebase/amend), the knowledge graph automatically re-anchors the rules to the new commit or safely purges invalid data.

## Deployment & Database Strategy

- **Dual-Track DB Strategy**:
  - **Local SQLite**: Serves as an ultra-fast, local-first cache managing the "HEAD" state for instantaneous AST queries within the editor.
  - **Remote PostgreSQL**: Serves as the ultimate source of truth, storing the full 4D temporal timeline, conceptual L1/L2 maps, and collaborative team history.

## Roadmap Phases

- **Phase 1 (Skeleton)**: Establish Microkernel interfaces, define SQLite table schemas, and implement the first language plugin (`@workspace/plugin-ast-typescript`).
- **Phase 2 (Nervous System)**: Implement the Git Blob Hash Ingestion Pipeline, ensuring seamless inheritance of Node UUIDs during file renames or moves.
- **Phase 3 (Memory)**: Develop the Orphan Branch GC Worker and the bidirectional validation mechanism, ensuring L3 rules can safely persist and self-heal.
- **Phase 4 (Muscle)**: Integrate graph querying into the Frontend (`kg-engine`) and VS Code Client, and deploy the On-Demand LSP tool.
