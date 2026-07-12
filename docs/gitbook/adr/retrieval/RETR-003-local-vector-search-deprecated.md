---
id: RETR-003
title: Local Vector Search Deprecated
status: accepted
date: 2026-07-06
domains: [retrieval]
supersedes: [legacy/ADR-029]
superseded_by: []
---

# Local Vector Search Deprecated

## Context
Originally, Docuvia integrated an ONNX-backed local vector embedding model (e.g., `all-MiniLM-L6-v2`) via `transformers.js` to enable "Local First" semantic search without external API calls. However, user feedback and performance metrics revealed significant drawbacks: the 30-80MB WASM download stalled the VS Code extension startup, local CPU inference blocked the event loop causing UI jitter, and the embedding quality of the micro-model was insufficient for complex architectural queries, resulting in poor RAG performance.

## Decision
We officially **DEPRECATE and REMOVE** the local, WASM-based ONNX vector search engine. We will **NOT** ship a local embedding model within the Docuvia extension or CLI.

Instead, we shift to a Graceful Degradation model:
1. **Primary Semantic Search**: Must be powered by an external/remote LLM Integration (e.g., OpenAI `text-embedding-3-small`, or a user-provided API endpoint).
2. **Offline Fallback (NL UI)**: If the user is offline or has no LLM configured, the Natural Language UI (Search bar) gracefully degrades to a robust **Full-Text Search (FTS5 in SQLite) + BM25 keyword matching**, abandoning semantic similarity entirely.

## Consequences
- **Positive**: Dramatically reduces extension bundle size and startup time. Eliminates UI jitter caused by CPU-bound WASM inference.
- **Negative**: "Local First" semantic search is no longer available; offline users are restricted to exact keyword matching.
