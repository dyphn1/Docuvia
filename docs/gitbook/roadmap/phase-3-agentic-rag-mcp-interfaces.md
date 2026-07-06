# Phase 3: Agentic RAG & MCP Interfaces

## 🎯 Objective

Expose the parsed knowledge graph to external AI Agents (Claude Code, Cursor) and humans via advanced RAG and standard MCP protocols.

## 🛠️ Implementation Method

- **RAG Routing:** Implement an intent-router with 4-way classification prioritizing O(1) local cache.
- **MCP Routes:** Build standard query_graph, detect_changes tools accessible via stdio.
- **Vector Math:** Vector search must rely on pgvector.

## 📋 Feature Tracking

This phase tracks the following specific features. Click on any feature to view its real implementation details, tests, and up-to-date status.

| Feature                               | Status  | Link                                                              |
| :------------------------------------ | :------ | :---------------------------------------------------------------- |
| Agentic RAG (Intent Router)           | ✅ Done | [View Details](features/agentic-rag-intent-router.md)             |
| Vector Index & Search                 | ✅ Done | [View Details](features/vector-index-search.md)                   |
| Semantic search                       | ✅ Done | [View Details](features/semantic-search.md)                       |
| Graph index                           | ✅ Done | [View Details](features/graph-index.md)                           |
| MCP Route scaffolding                 | ✅ Done | [View Details](features/mcp-route-scaffolding.md)                 |
| Semantic Deduplication in Agentic RAG | 🔲 TODO | [View Details](features/semantic-deduplication-in-agentic-rag.md) |
| Background Agentic RAG                | 🔲 TODO | [View Details](features/background-agentic-rag.md)                |
