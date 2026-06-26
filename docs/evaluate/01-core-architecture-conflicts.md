# 01. Core Architecture Conflicts

**Severity:** 🔴 CRITICAL
**Affected Docs:** ADR-002, ADR-004, ADR-014, ADR-019, `knowledge-graph/store.md`, `04-solution-strategy.md`

This section covers the most fundamental design contradictions in the system. If left unresolved, the system will fail to implement correctly or crash under boundary conditions.

## 1. Local-First (SQLite) vs `pgvector` Search Conflict
*   **Conflict:** ADR-002 promises local-first offline availability using SQLite, but ADR-019 delegates vector search to PostgreSQL's `pgvector`.
*   **Issue:** The VS Code extension completely loses its vector retrieval capability when offline.
*   **Proposed Fix:**
    *   Introduce local vector plugins like `sqlite-vec` or `sqlite-vss` to SQLite to ensure offline vector search.
    *   Alternatively, explicitly define a "Graceful Degradation" strategy, declaring that offline mode only supports L2/L3 exact keyword matching and disables semantic search.

## 2. Git Orphan Branch vs PostgreSQL (SSOT) Sync Conflict
*   **Conflict:** ADR-004 stores the knowledge graph on a Git orphan branch (`docuvia-knowledge`), while ADR-014 relies on PostgreSQL for recursive graph traversal.
*   **Issue:** During multi-developer collaboration, how are SQL deltas synced back to the Git orphan branch? There is no mechanism to handle Git push conflicts (non-fast-forward).
*   **Proposed Fix:** Introduce an Append-Only JSON Delta mechanism on the Git branch, or treat SQL as the Single Source of Truth (SSOT) and use the Git branch purely as an asynchronous backup.

## 3. Database-as-IPC Anti-pattern
*   **Conflict:** ADR-014 allows AST Parsing Workers to write directly to the database (INSERT/UPDATE).
*   **Issue:** This causes severe coupling, easily exhausts database connection pools, and bypasses the API layer's input validation and security controls.
*   **Proposed Fix:** AST Workers must communicate via HTTP APIs (e.g., `POST /ingest-results`). The API server should unify writing and handle database transactions.

## 4. Aggressive Last-Write-Wins (LWW) Sync Strategy
*   **Conflict:** `knowledge-graph/store.md` defines that conflicts during local and remote sync are resolved by overwriting (Last-Write-Wins).
*   **Issue:** For a knowledge system, LWW will silently overwrite and lose important manual corrections made by developers.
*   **Proposed Fix:** Introduce CRDTs, Operational Transforms (OT), or provide a manual Git-style conflict resolution UI.

## 5. Local-First Vision vs Server-Dependent Features
*   **Conflict:** `04-solution-strategy.md` claims a Local-First architecture, but advanced features (Agentic RAG, Swarm Evolution) fully depend on the server.
*   **Issue:** The terminology is misleading, and the User Journeys lack definitions for offline experiences.
*   **Proposed Fix:** Clearly clarify that "Local-First" only applies to "reading cached graphs and basic navigation", while all AI-generated and extraction operations require an online state.