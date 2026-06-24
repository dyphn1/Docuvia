# Action Plan: Roadmap (Functional Additions / Architectural Parity)

*These are incomplete systems, planned features, and gaps in achieving the final architectural vision (especially Milestone 4 Local-First parity).*

## Local-First & Synchronization
- **Complete Local SQLite Outbox (ADR-002)**: Implement the local SQLite write cache and `SyncOutbox` queue to allow durable offline edits instead of direct YAML writes.
- **Zero-Server Deep Traversal**: Introduce a pure local graph querying mechanism via MCP/CLI without requiring the API Server.
- **Local Context Compression**: Add a proxy layer to reversibly compress AI agent context (AST, logs, RAG) locally to save token limits.
- **Bidirectional Sync Activation**: Wire up `CentralServerClient.sync()`, add manual `docuvia.sync` command, and implement the `docuvia sync` CLI with proper 3-way merge logic.
- **Temporal Delta Projection (ADR-004)**: Connect the dead `getProjectedCommits()` (merge-base fallback) to the ingestion pipeline and populate `introducedInCommit` / `verifiedUntilCommit`.

## Asynchronous Metabolism (ADR-008)
- **Distributed Locks & DLQ**: Replace the single-instance in-memory mutex with Postgres `FOR UPDATE SKIP LOCKED`.
- **Dead Letter Queue**: Fully implement the `job_queue` table with 3-retry DLQ transition for failed LLM distillation tasks.
- **Auto-Trigger Scheduler**: Add an internal cron or event trigger for `/metabolism-tick` so abandoned branches and pending nodes are processed automatically.

## Search & Knowledge Processing
- **pgvector Migration**: Upgrade from in-memory cosine similarity (which fails at 100K+ nodes) to Postgres `vector(1536)` with an IVFFlat/HNSW index.
- **AST Chunking Strategy**: Implement `tree-sitter` AST chunking for extraction (the code currently has a TODO and falls back to line-based chunking).
- **Orphan Detection**: Ensure L3 nodes from PRs that are closed *without* merging are transitioned to `"orphaned"` instead of remaining `"pending"` indefinitely.

## Web UI Enhancements
- **LLM Config Management**: Create a settings UI to manage prompts, thresholds, and providers (`GET/PATCH /projects/:id/llm-config`).
- **Dashboard Observability**: Add a visual pipeline status section (Active/Indexing/Error) and a Review Queue health badge to the dashboard.
- **Project Settings**: Add frontend UI to Update and Delete projects.
- **Review Queue Polish**: Add pagination, server-side status filtering, and project-level filtering to the `/review` page.
