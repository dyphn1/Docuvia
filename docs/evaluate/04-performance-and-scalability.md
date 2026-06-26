# 04. Performance & Scalability

**Severity:** 🟠 HIGH
**Affected Docs:** Arc42 Chapter 10, ADR-014, ADR-016, `ui-ux/editor-integration.md`

Performance metrics are disconnected from the actual architecture design, and the catastrophic impact of processing large repositories is ignored.

## 1. VS Code Main Thread Blocking Risk (CodeLens Latency)
*   **Bottleneck:** `ui-ux/editor-integration.md` describes CodeLens querying the knowledge base in real-time to annotate functions. Opening a large file with hundreds of functions will trigger massive local SQLite queries, directly freezing the VS Code Extension Host (which is single-threaded).
*   **Proposed Fix:**
    *   Implement strict debouncing.
    *   Lazy-load CodeLens annotations only for the code currently visible within the viewport (Viewport-scoped).

## 2. Ingestion Catastrophe for Large Repositories
*   **Bottleneck:** If a user triggers Full Ingestion on a legacy project with 100,000 commits, the current architecture will overload the system and generate exorbitant Token costs.
*   **Proposed Fix:** Limit the default ingestion depth (e.g., only scan the last 3 months) or provide a progress bar with token cost estimations and a cancellation mechanism.

## 3. Unrealistic Performance Targets
*   **Bottleneck:** Arc42 Chapter 10 targets `< 200ms for RAG query response`. Under a complex architecture involving LLM inference, vector search, and graph traversal, this is virtually impossible.
*   **Proposed Fix:**
    *   Revise to reasonable P95 metrics (e.g., Local retrieval < 300ms, LLM RAG Streaming Time-to-First-Token < 2s).

## 4. PostgreSQL Recursive Query Performance
*   **Bottleneck:** ADR-014 relies on PostgreSQL Recursive CTEs for Graph Traversal. For multi-hop queries, relational database performance will severely lag behind native graph databases (like Neo4j).
*   **Proposed Fix:** Define a threshold for when to migrate to a true Graph Database (e.g., graph size limits) or introduce deep caching mechanisms into the current architecture.