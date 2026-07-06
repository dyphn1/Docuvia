> **Note:** This document contains competitor analysis and self-evaluation notes that have not been fully integrated into the current implementation yet.
>
> **PARTIALLY RESOLVED:** The "Zero Vector Capabilities" fatal flaw below was addressed by [ADR-019 (pgvector Migration)](../adr/ADR-019-pgvector-migration.md), accepted 2026-07-02, and is marked done in the roadmap ([Vector Index & Search](../roadmap/features/vector-index-search.md), [pgvector Migration](../roadmap/features/pgvector-migration.md)). The narrative below is retained as-written since it is the historical context ADR-019 was written against; treat the vector-search gap itself as closed, but the remaining points (prompt batching, project-wide synthesis, rate limiting) as still open.

# Agentic RAG & Background Intent Extraction Competitor Analysis

## Current State

Docuvia handles L3 intent extraction asynchronously using a local model (`ollama/llama3-8b`) or cloud provider mapped via `docuvia.json`. Extracted insights are directly linked to AST L2 nodes in SQLite.

## Competitors

GitHub Copilot Workspace, GitNexus

## What Competitors Have That We Don't

- **Native Vector Search**: Copilot Workspace uses deeply integrated embeddings for fuzzy intention mapping. Docuvia completely lacks a local Vector Database; we only use FTS5 (Full-Text Search) in SQLite. _(Resolved — see the ADR-019 note above.)_
- **Prompt Batching**: GitNexus batches multiple small extractions into a single LLM call to save tokens. Docuvia fires a separate API request for every single file.
- **Project-Wide Synthesis**: Copilot Workspace synthesizes context across the entire repository to draft multi-file plans. Docuvia's L3 nodes are strictly file-isolated.

## What We Have That They Don't

- **Offline Background Processing**: We can run RAG asynchronously (`--deep`) in the background on local open-source models, completely bypassing the massive cloud costs associated with Copilot.
- **Deterministic AST Anchoring**: Our L3 insights are permanently anchored to exact AST node IDs. If the file is renamed, the insights follow the node.

## Fatal Flaws

- **Zero Vector Capabilities** _(resolved)_: FTS5 string matching is fundamentally incapable of true Agentic RAG. If a user asks for "authentication", and the L3 node says "login management", FTS5 will return 0 results. → Closed via `pgvector` (ADR-019).
- **LLM Rate Limiting**: Sending 1000 files to an LLM provider simultaneously via `ExtractService` will immediately trigger a 429 Too Many Requests error.

## Immediate Next Steps

- ~~Integrate a local vector embedding generator (e.g., `all-MiniLM-L6-v2` via ONNX) and store vectors directly in a `pgvector` or `sqlite-vss` compatible format.~~ Done via ADR-019.
- Implement a task queue to throttle and batch `ExtractService` requests. _(still open — see [Semantic Deduplication in Agentic RAG](../roadmap/features/semantic-deduplication-in-agentic-rag.md), 🔲 Planned)_

```mermaid
flowchart TD
    subgraph Cloud [Competitors: Copilot Workspace, GitNexus]
        direction TD
        C_SRC[Source Code] --> C_BATCH[Prompt Batching]
        C_BATCH --> C_LLM((Cloud LLM))
        C_LLM --> C_VEC[(Native Vector DB)]
        C_VEC --> C_SYN[Project-Wide Context Synthesis]
    end

    subgraph Local [Docuvia]
        direction TD
        D_SRC[Source Code] -->|Offline / No Batching| D_LLM(("Local Open-Source LLM<br/>e.g. ollama"))
        D_LLM -->|Extract L3 Insights| D_BIND[Deterministic AST Anchoring]
        D_BIND --> D_SQL[(SQLite FTS5)]

        D_SQL -->|Done: ADR-019| D_VEC[("pgvector")]
    end

    classDef cloud fill:#fff3cd,stroke:#333,stroke-width:2px;
    classDef local fill:#cce5ff,stroke:#333,stroke-width:2px;
    class Cloud cloud;
    class Local local;
```
