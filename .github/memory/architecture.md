# Architecture & Design Memory

## VS Code Client Architecture
- **Eradicate Single-Root Bias**: Never use `workspaceFolders[0]`. Always pass an explicit `workspaceUri` down the call chain, and map UI instances and state to specific workspace roots. 
- **Multi-Root State Management**: Avoid global singletons. Use `store.getSnapshotFor(uri)` instead of a global `store.snapshot`. Convert UI singletons (like `DashboardPanel`) to Maps keyed by `workspaceRoot`.
- **Multi-Root UI Strategy**: For resolving multi-root contexts, use a **Tree-Node Expansion strategy** (aligning with VS Code's native workspace layout) instead of "global active view" or dropdowns. For Chat commands (`/query`, `/extract`), resolve context from the active text editor, or prompt the user via `QuickPick` if ambiguous.
- **Virtual Tree Nodes**: For hierarchical data in `TreeDataProvider` (e.g., Knowledge Graph nodes), do not drop orphaned items. Create synthetic virtual nodes (e.g., `unassigned-group`) to aggregate entities that lack a defined parent (like L3 decisions without an L2 module). This ensures full visibility without corrupting the underlying data schema.
- **No-LLM-in-Hover Rule**: Never invoke LLM parsing inside synchronous editor callbacks (like Hover, CodeLens, or Completion providers) due to catastrophic UI performance impacts. Keep UI rendering paths pure, strictly read-only, and sub-millisecond.
- **Interval Tree Caching**: For editor overlays, use O(log N) data structures like `IntervalTree` to cache AST symbol boundaries asynchronously. A background `KnowledgeIndexer` should fuzzy-match AST symbols against the external knowledge base and populate the cache.
- **State-Sync Self-Healing**: To maintain valid anchors while typing, hook `onDidChangeTextDocument` to mathematically shift cache intervals up/down in O(log N) time. Use `onDidSaveTextDocument` to trigger a full background re-index to catch renames or structural changes.

## Knowledge Graph & Agentic RAG
- **"实体化 Inbox" (Tangible Inbox / No Null Parents)**: To maintain graph integrity and RAG accuracy, strictly prohibit "orphan nodes" (null or empty `l2_module_id`). Uncategorized extractions must always map to a tangible placeholder node (e.g., `sys-uncategorized`). This ensures the structural schema remains strict and predictable across the database and OpenAPI layers.
- **Dual-Track Extraction**: Split extraction logic based on context size. Snippets or single-file extractions attempt immediate categorization (Track A). Bulk multi-file extractions are funneled into the `sys-uncategorized` node (Track B) to avoid blocking or hallucinating module assignments.
- **Multi-Stage Sieve Model (Sieving Uncategorized Nodes)**: Do not blast massive volumes of uncategorized content directly to an LLM for routing. Instead, implement a multi-stage scoring sieve (e.g., using Git History, Directory Structure, and Semantic Vectors) to suggest or auto-resolve the correct L2 module.
- **Temporal Decay Scoring**: To prevent stale knowledge from dominating search results, use Exponential Temporal Decay in the search algorithm: `decayed_score = raw_score * exp(-λ * t)`, where `t` is the time since `last_verified_at`. Refresh a node's relevance by updating `last_verified_at` to `NOW()` when used in a successful RAG response.
- **O(1) Fast Arbitration Funnel**: To minimize "LLM arbitration tax" (latency/cost), implement deterministic fast-path filters *before* invoking an LLM for query intent routing. Use regex for explicit directives (e.g., `#attach`, specific file extensions) to force direct lookups, and exact-match checks against known ontology terms (L1/L2 nodes) to force graph traversal. Only fall back to LLM classification when fast-paths fail.

## Server-Side Metabolism & Background Jobs
- **Thundering Herd Prevention**: When multiple clients poll an endpoint to trigger background tasks (metabolism ticks), use a Mutex (in-memory or DB advisory lock). For database-backed state, use atomic updates (e.g., `UPDATE ... WHERE status='active'`) instead of application-level read-then-write checks to prevent race conditions. If a job is active, return `202 Accepted` or `409 Conflict` immediately to avoid overlapping micro-batch executions.
- **Client Heartbeat Jitter**: For background polling mechanisms (like `setInterval` in the VS Code client), always add randomized jitter (e.g., base interval ± random offset) to evenly distribute server load across active clients.
- **Swarm Intelligence Distillation**: Process human-in-the-loop corrections asynchronously during background "metabolism" ticks. Fetch unhandled `correction_examples`, use an LLM to distill the delta (original vs. corrected) into a concise architectural guardrail, insert it into `prompt_templates`, and mark the correction as processed (`processedAt`). This ensures continuous, non-blocking self-evolution.

## Unified Query Routing & Search
- **Centralized Intent Routing**: Avoid disjointed search endpoints. Unite all search interfaces (Vector, Direct, Hybrid, Graph) behind a single `intent-router` to maintain consistent parameter handling and response schemas.
- **Search Logic Precision**: Ensure Hybrid search implements strict intersection logic (e.g., combining semantic proximity with keyword matches) rather than loose unions. Verify that Direct search correctly implements full-text indexing logic.
- **Test-Driven Core Math**: Core routing decisions, hybrid intersection algorithms, and scoring math must be isolated from API handlers and maintain high unit test coverage (using Vitest), independent of DB-backed integration tests.

## Security & API Design
- **Zero-Trust Administrative Routes**: Never leave admin or internal infrastructure routes unauthenticated. Always enforce appropriate authentication or network boundaries, even for internal testing or background triggers.

## Ingestion Pipeline Protocolization
- **Unified Pipeline Abstraction**: Consolidate disparate ingestion flows (Git, SVN, Documents) into a standardized pipeline sequence (`processIngestion`): Hash deduplication -> Score -> DB Insert -> Activity Log -> Notification. This prevents logic drift between API entry points.
- **Local Process Execution**: For source control interactions, prefer hardened local client wrappers (`child_process.execFile` with temporary directories) over remote API dependencies for operations like cloning and extracting diffs, ensuring robust handling of arbitrary or private repos.
- **Pure Utility Extraction**: Pure business logic (e.g., `scoreCommit`) must be decoupled from route handlers and placed in testable, standalone utility modules.
