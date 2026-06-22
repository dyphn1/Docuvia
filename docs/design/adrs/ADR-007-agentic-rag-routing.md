# Agentic RAG 4-Way Routing & Temporal Decay

## Core Architecture

Docuvia's [`intent-router.ts`](../../../artifacts/api-server/src/lib/intent-router.ts) dynamically selects the optimal retrieval strategy. Routing arbitration prioritizes $O(1)$ local caches over expensive LLM inference.

## The Routing Funnel (O(1) Arbitration)

```mermaid
flowchart TD
    Query[User Query] --> C1{Contains #attach or specific file extensions (.ts, src/)?}
    C1 -- Yes --> Direct[Direct RAG: Lookup target_refs or keyword]
    C1 -- No --> C2{Hits L1/L2 Names in Database?}

    C2 -- Yes --> Graph[Graph RAG: Traverse node_links]
    C2 -- No --> Hybrid[Hybrid / Vector LLM Arbitration]
```

## 1. External Document Anchoring (The Floating Knowledge Catcher)

- **Implementation Schema**: [`documentsTable` in documents.ts](../../../lib/db/src/schema/documents.ts) with `status: "unaffiliated"`.
- When a 50-page PDF is uploaded, it is initially `unaffiliated`. The LLM scans it to find semantic anchors in existing L2 nodes or recent commits. Once approved via [`review_tasks.ts`](../../../artifacts/api-server/src/routes/review_tasks.ts) (Drizzle schema: [`review_tasks.ts`](../../../lib/db/src/schema/review_tasks.ts)), it is firmly anchored in the space-time of the Git graph, preventing anachronistic hallucinations.

## 2. The 4-Way Strategies

- **Direct RAG**: $O(1)$ lookup via commit hashes or full-text search against `l3_nodes.content` if no hash is provided.
- **Graph RAG**: Traverses `node_linksTable` to find structural dependencies (Neighbor Infection).
- **Vector RAG**: Standard embedding similarity via PGVector (`embedding.ts`).
- **Hybrid RAG**: Intersection of graph constraints and vector similarities with cross-validation boosting (nodes found in both sets receive a compounding score boost). Implemented as `hybridSearch()` in `intent-router.ts`.

## 3. Temporal Decay & Garbage Collection

- Knowledge nodes contain `created_at` and `lastVerifiedAt`.
- **Implementation**: The router applies an Exponential Temporal Decay function to search scores (`Math.exp(-LAMBDA * daysSinceVerified)` in `intent-router.ts`). Knowledge untouched naturally sinks to the bottom.
- When old knowledge correctly answers a query, its `lastVerifiedAt` is updated via the `POST /search/feedback` endpoint (passing the `nodeLayer`), "refreshing" its lifespan.

## System Flow & Boundaries

```mermaid
sequenceDiagram
    participant C as Client
    participant IR as Intent Router
    participant DB as PostgreSQL (pg_trgm)
    participant LLM as OpenAI Server

    C->>IR: Query("How does X work?")
    IR->>DB: FTS / pg_trgm Similarity Search
    alt High Confidence Hit (>0.8)
        DB-->>IR: Exact Node/Delta Match
        IR-->>C: Immediate Response (0 LLM Tokens)
    else Low Confidence / Complex Intent
        DB-->>IR: Insufficient Match
        IR->>LLM: Formulate Agentic RAG Prompt
        LLM-->>IR: Synthesized Answer
        IR-->>C: Streamed Response
    end
```

## Verifiability

To ensure the semantic routing fast-path functions under load and doesn't leak tokens, the CI pipeline MUST assert the following:

- **Fast-Path Assertion:** Integration tests in `artifacts/api-server/test/integration/` MUST seed the database using factories, trigger an exact-match query, and use `MSW` to strictly assert that `0` external HTTP requests are made to the AI server.
- **Fallback Assertion:** Queries below the similarity threshold MUST assert that exactly `1` request is intercepted by MSW, validating the payload shape and prompt template.
