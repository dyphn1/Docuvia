# 01. Core Architecture: Resolving the "Conflicts" via VCS-based Event Sourcing

**Status:** 🟢 RESOLVED (Paradigm Shift)
**Affected Docs:** ADR-002, ADR-004, ADR-014, ADR-019, `04-solution-strategy.md`

Earlier reviews identified apparent contradictions between Local-First (SQLite), Server-Side (PostgreSQL), and Git-Isomorphic storage. These were perceived as "sync conflicts" and "split-brain" issues. 

However, under the refined vision of Docuvia as a **VCS-based Knowledge Evolver**, these are not conflicts. They are distinct layers of a **CQRS (Command Query Responsibility Segregation) + Event Sourcing** architecture deeply integrated with Git.

## The Git Metaphor Mapping

1.  **Git Orphan Branch (`docuvia-knowledge`) = The Event Store / Packfile**
    *   This is the **absolute Single Source of Truth (SSOT)**.
    *   Knowledge is *never* overwritten; it evolves. Every extraction or human correction is an Append-Only commit.
    *   Git Commits inherently provide *Identity* and *Evolution History*. We don't resolve database sync conflicts; we resolve Git branch merges.
2.  **Local SQLite = The Local HEAD Index**
    *   It is **not** an SSOT. It is an ephemeral, highly optimized *projection* (Read Model) of the local Git branch.
    *   It operates frictionlessly via Git Hooks (e.g., `post-commit`). When a developer commits, a hook extracts knowledge and updates the local SQLite index to provide instant, token-saving context to local AI Agents.
    *   **Resolution to ADR-002 vs ADR-019:** Local SQLite doesn't need heavy `sqlite-vss` or `pgvector`. It provides topological, structural (AST), and keyword context to save AI tokens locally. Deep semantic search is gracefully deferred to the server.
3.  **Server PostgreSQL (`pgvector`) = The Global Aggregation Index**
    *   The server is effectively like GitHub/GitLab. It clones all branches across all projects.
    *   It projects these branches into a giant PostgreSQL database to provide cross-project, high-dimensional semantic search (`pgvector`) and heavy AI distillation.
    *   **Resolution to ADR-014 (DB-as-IPC):** Local Git Hooks write to the local Git Branch and SQLite. The Server consumes the Git Branch via standardized Git Pull operations or webhooks, effectively eliminating the "direct DB connection from client workers" security risk.

## Paradigm Shifts

*   **No more "Last-Write-Wins (LWW)" data loss:** Since everything is an Append-Only Git commit on the `docuvia-knowledge` branch, conflicting knowledge edits are resolved via standard Git merge mechanics, preserving all historical context.
*   **Invisible Integration:** Docuvia is an invisible preprocessor (like ESLint). It hooks into VCS to build high-density context, solving the **Cognitive Gap** and drastically reducing the token cost (and hallucination rate) of AI coding agents like Cursor or Claude Code.