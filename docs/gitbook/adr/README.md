# Architectural Decision Records

This section holds Docuvia2's Architectural Decision Records (ADRs). The decisions are organized into coarse capability domains, providing a living overview of "What is true now" alongside the immutable historical decisions.

> 💡 **Start Here:** To understand how these architectural decisions map directly to actual user-facing features, read the **[CLI-Driven Architecture Mapping](cli-driven-architecture.md)**. It breaks down every CLI command and links it to the specific decisions that govern its behavior.

## Capability Domains

- **[Storage (STOR)](storage/README.md)**: Knowledge graph persistence, SQLite vs Git.
- **[Graph (GRPH)](graph/README.md)**: Graph model, ingestion, AST engine.
- **[Impact (IMPT)](impact/README.md)**: Blast radius and impact analysis.
- **[Retrieval (RETR)](retrieval/README.md)**: RAG routing, semantic search, and querying.
- **[LLM (LLM)](llm/README.md)**: Model providers, extraction efficiency.
- **[Interface (IFCE)](interface/README.md)**: CLI UX, VS Code client, prompt handling.
- **[Platform (PLAT)](platform/README.md)**: Virtual Contracts, Local-first architecture, hooks.
- **[Legacy (Legacy)](legacy/README.md)**: Frozen Docuvia1 ADRs kept for historical context.
