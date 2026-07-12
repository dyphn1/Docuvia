---
---
Date: 2026-07-07
Status: Deprecated
Supersedes: None
Supplements: ADR-007
---

# ADR 028: Semantic Deduplication in Agentic RAG

## Context

The current Agentic RAG pipeline in Docuvia aggregates context from multiple discrete sources to answer complex queries. Specifically, `intent-router.ts` orchestrates retrieval across:

- The **L3 Knowledge Graph** (implementation details and code structure)
- **Vector Database** (pgvector for semantic search)
- **Local SQLite** (local workspace and session state)

Because these retrieval sources are independent, they frequently return overlapping or duplicate information. For instance, an exact code snippet might be retrieved both as an L3 node and as a high-scoring vector search result. Feeding this redundant data directly into the AI Agent/LLM bloats the context window.

This bloat leads to higher API token costs (violating cost efficiency goals), slows down inference times, and increases the signal-to-noise ratio, which can degrade the quality of the LLM's reasoning and final output.

## Decision

We will introduce a **Semantic Deduplication** step within the context aggregation pipeline in `lib/core/src/services/intent-router.ts`. This step will execute immediately before the final context is passed to the AI Agent/LLM.

Specifically, the pipeline will:

1. **Aggregate**: Collect all retrieved context chunks from L3, pgvector, and SQLite.
2. **Score Similarity**: Compute similarity scores between the retrieved chunks. Where possible, we will reuse existing vector embeddings or apply a fast, lightweight semantic similarity algorithm (e.g., MinHash for text overlap or cosine similarity via a small local encoder).
3. **Prune**: Group or discard context chunks that exceed a strict similarity threshold (e.g., > 0.90 cosine similarity). The system will retain only the highest-ranked or most metadata-rich chunk from any identified duplicate set.

## Consequences

### Positive

- **Cost Reduction**: Significantly reduces the number of input tokens sent to the LLM, leading to direct savings in API costs.
- **Improved Latency**: A smaller context window results in faster LLM processing and response generation.
- **Higher Output Quality**: An improved signal-to-noise ratio prevents the LLM from over-attending to redundant information, improving reasoning accuracy.

### Negative

- **Pipeline Latency**: The deduplication algorithm adds a minor computational overhead during the retrieval phase prior to LLM invocation.
- **Tuning Complexity**: The similarity threshold must be carefully calibrated. If set too low, it may discard nuanced but distinct information; if set too high, the deduplication will be ineffective.
superseded_by: []
