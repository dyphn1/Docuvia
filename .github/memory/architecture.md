# Architecture & Design Memory

## VS Code Client Architecture
- **Virtual Tree Nodes**: For hierarchical data in `TreeDataProvider` (e.g., Knowledge Graph nodes), do not drop orphaned items. Create synthetic virtual nodes (e.g., `unassigned-group`) to aggregate entities that lack a defined parent (like L3 decisions without an L2 module). This ensures full visibility without corrupting the underlying data schema.

## Knowledge Graph & Agentic RAG
- **Temporal Decay Scoring**: To prevent stale knowledge from dominating search results, use Exponential Temporal Decay in the search algorithm: `decayed_score = raw_score * exp(-λ * t)`, where `t` is the time since `last_verified_at`. Refresh a node's relevance by updating `last_verified_at` to `NOW()` when used in a successful RAG response.
- **O(1) Fast Arbitration Funnel**: To minimize "LLM arbitration tax" (latency/cost), implement deterministic fast-path filters *before* invoking an LLM for query intent routing. Use regex for explicit directives (e.g., `#attach`, specific file extensions) to force direct lookups, and exact-match checks against known ontology terms (L1/L2 nodes) to force graph traversal. Only fall back to LLM classification when fast-paths fail.

## Server-Side Metabolism & Background Jobs
- **Thundering Herd Prevention**: When multiple clients poll an endpoint to trigger background tasks (metabolism ticks), use a Mutex (in-memory or DB advisory lock). If a job is active, return `202 Accepted` or `409 Conflict` immediately to avoid overlapping micro-batch executions.
- **Client Heartbeat Jitter**: For background polling mechanisms (like `setInterval` in the VS Code client), always add randomized jitter (e.g., base interval ± random offset) to evenly distribute server load across active clients.
- **Swarm Intelligence Distillation**: Process human-in-the-loop corrections asynchronously during background "metabolism" ticks. Fetch unhandled `correction_examples`, use an LLM to distill the delta (original vs. corrected) into a concise architectural guardrail, insert it into `prompt_templates`, and mark the correction as processed (`processedAt`). This ensures continuous, non-blocking self-evolution.
