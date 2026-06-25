# ADR-019: PostgreSQL pgvector Migration for Similarity Search

## Status

Accepted (2026-06-25)

## Context

During the Phase 1 Foundation of Docuvia, vector search and RAG orchestration were implemented using a fallback in-memory cosine similarity calculation (`artifacts/api-server/src/lib/intent-router.ts`). While functional for early prototyping, this approach requires loading the entire [L2 and L3 embedding](ADR-005-knowledge-abstraction-strategy.md) sets into Node.js heap memory on every query.

As the graph scales past 100,000 nodes, the Node.js process faces significant OOM (Out Of Memory) risks, extreme latency spikes, and CPU bottlenecks. Furthermore, sorting and re-ranking entirely in memory prevents us from leveraging advanced [database-level filtering](ADR-014-sql-indexed-graph-and-database-as-ipc.md), spatial clustering, and efficient hybrid (text + vector) queries.

To transition from prototype to production-grade architecture (Milestone 6), the [Agentic RAG router](ADR-007-agentic-rag-routing.md) requires a durable, scalable, database-native vector index.

## Decision

We will migrate the vector storage and search functionality to PostgreSQL using the `pgvector` extension.

1.  **Schema Update**: Add the `pgvector` extension to the database. Modify `l2_nodesTable` and `l3_nodesTable` in Drizzle ORM to use `vector(1536)` for the `embedding` column.
2.  **Indexing**: Implement `IVFFlat` or `HNSW` indexes on the `embedding` columns to ensure sub-millisecond retrieval performance at scale.
3.  **Query Migration**: Rewrite the `intent-router.ts` vector search logic to offload the cosine similarity calculations directly to the PostgreSQL engine (e.g., `SELECT * FROM l3_nodes ORDER BY embedding <=> $1 LIMIT 5`).
4.  **Temporal Decay Integration**: Perform the base vector search (e.g., top 100) via DB-level `pgvector` operations, then apply the [temporal decay](ADR-007-agentic-rag-routing.md) (`lastVerifiedAt`) math either natively in SQL (via a combined formula) or in memory after the initial DB threshold cut-off.

## Consequences

-   **Positive**: Eradicates OOM risks in the Node.js API server by offloading heavy vector matrix multiplication to the database.
-   **Positive**: Massive latency reduction for large datasets due to HNSW/IVFFlat indexing.
-   **Positive**: Consolidates relational data filtering and vector search into single, atomic DB transactions.
-   **Negative**: Increases infrastructure requirements; deployments must guarantee the underlying PostgreSQL instance has the `pgvector` extension installed.
-   **Negative**: Requires a potentially expensive and lock-heavy data migration to alter existing JSONB array columns into native `vector` types.
