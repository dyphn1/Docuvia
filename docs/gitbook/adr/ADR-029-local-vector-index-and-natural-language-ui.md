# ADR 029: Deprecation of Local Vector Search and NL UI Graceful Degradation

## Status

Accepted

## Context

Docuvia's original roadmap included a local vector index using `sqlite-vec` to power the Natural Language UI in offline mode. However, this approach contradicts several established architectural decisions and creates a misleading state in the codebase:

- **ADR-019** explicitly moved Vector Search to `pgvector` on the API Server to prevent local OOM/Compute issues and reduce bundle size on portable edge devices.
- **ADR-002** defined Graceful Degradation for Local-First architectures, specifying that local clients should fall back to FTS and Graph RAG instead of requiring heavy local cosine similarity operations.
- The current implementation left a `NotImplementedError: Local vector search is deferred` stub, while the roadmap prematurely claimed the feature was "Done". This discrepancy ("說大話" / overpromising) creates confusion around the true offline capabilities.

The _true_ solution for the Natural Language UI in offline mode is not to force a local vector database, but rather to use an LLM-driven Intent Router. This router will parse natural language into structural/hard keywords and node references, which can then be fulfilled via SQLite FTS5 and AST Graph traversal.

## Decision

1. **Deprecate Local Vectors**: Formally abandon `sqlite-vec` and any local vector index implementations. We will strictly use SQLite FTS5 and Graph traversal for the VS Code extension and CLI.
2. **Server-Only Vector Search**: Treat vector search exclusively as a server-side feature (via `pgvector`). Remove all `NotImplementedError` stubs related to local vector search.
3. **Graceful Degradation for NL UI**: The Natural Language UI will rely on an Intent Extraction pattern in local mode. The LLM will parse user intents into structured queries (keywords, node refs) that are executed against the local SQLite FTS/Graph database.

## Consequences

### Positive

- **Reduced Bloat**: Eliminates the need to bundle `sqlite-vec` and local embedding models, keeping the edge/local client lightweight.
- **Architectural Honesty**: Removes misleading "deferred" code stubs and aligns the implementation with ADR-019 and ADR-002.
- **Predictable Performance**: Prevents local compute and memory exhaustion on portable devices.

### Negative

- **Semantic Search Limitations Offline**: Offline mode relies on LLM intent extraction and FTS, which may not catch pure semantic similarities as effectively as true cosine similarity.
