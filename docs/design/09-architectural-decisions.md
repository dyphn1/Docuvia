# 9. Architectural Decisions

## 9.1 ADR Index

This document records the key architectural decisions made during the development of Docuvia v1.0. Each record follows the format: **Context → Decision → Consequences**.

Additional implementation planning documents are stored in [`docs/ai_plans/`](../ai_plans/) and represent decisions made for specific feature increments.

| ADR | Title | Status |
|---|---|---|
| [ADR-001](#adr-001-openapi-as-single-source-of-truth) | OpenAPI as Single Source of Truth | Accepted |
| [ADR-002](#adr-002-postgresql-with-jsonb-for-embeddings) | PostgreSQL with JSONB for Embeddings (No External Vector DB) | Accepted (v1) |
| [ADR-003](#adr-003-three-tier-knowledge-graph-l1l2l3) | Three-Tier Knowledge Graph (L1/L2/L3) | Accepted |
| [ADR-004](#adr-004-openai-compatible-llm-interface-only) | OpenAI-Compatible LLM Interface Only | Accepted (v1) |
| [ADR-005](#adr-005-mvc-pattern-for-ui-layers) | MVC Pattern for UI Layers | Accepted |
| [ADR-006](#adr-006-human-in-the-loop-via-review-queue) | Human-in-the-Loop via Review Queue | Accepted |
| [ADR-007](#adr-007-incremental-ingestion-via-cursor-columns) | Incremental Ingestion via Cursor Columns | Accepted |

---

## 9.2 Decision Records

---

### ADR-001: OpenAPI as Single Source of Truth

**Status:** Accepted

**Context:**  
Docuvia has multiple consumers of its API: a React frontend (`@workspace/kg-engine`), an Express backend that validates requests (`@workspace/api-server`), and a VS Code extension that calls REST endpoints. Without a canonical contract, types drift between layers, causing runtime errors that TypeScript alone cannot catch.

**Decision:**  
All API types are generated from `lib/api-spec/openapi.yaml` via Orval. The generated files (`lib/api-zod/src/generated/`, `lib/api-client-react/src/generated/`) are committed but never edited manually. Hand-writing API types, Zod schemas, or fetch wrappers that duplicate the spec is prohibited.

**Consequences:**
- ✅ Zero type drift between frontend, backend, and spec
- ✅ Adding a new endpoint requires editing only `openapi.yaml` + implementing the route handler
- ⚠️ Codegen must be run after every spec change (`pnpm --filter @workspace/api-spec run codegen`)
- ⚠️ Generated file churn in PRs — reviewers should skip generated files in diff review

---

### ADR-002: PostgreSQL with JSONB for Embeddings

**Status:** Accepted (v1) — migration to dedicated vector DB planned for v2

**Context:**  
Agentic RAG requires semantic search over L2 and L3 node embeddings. External vector databases (Qdrant, Chroma, Pinecone) add infrastructure complexity and an additional deployment dependency. For v1, the node count is expected to stay under ~100K.

**Decision:**  
Embeddings are stored as JSONB columns in `l2_nodes.embedding` and `l3_nodes.embedding`. Cosine similarity is computed in-memory by loading relevant embeddings from PostgreSQL, ranking, and returning top-K results. No external vector DB is required.

**Consequences:**
- ✅ No additional infrastructure dependency; single PostgreSQL instance is sufficient
- ✅ Zero embedding index maintenance
- ⚠️ Does not scale beyond ~100K nodes — query latency and memory usage increase linearly
- ⚠️ No approximate nearest-neighbour (ANN) index; full embedding scan per query
- 🔄 Migration to Qdrant or pgvector planned for v2 when node count growth demands it

---

### ADR-003: Three-Tier Knowledge Graph (L1/L2/L3)

**Status:** Accepted

**Context:**  
Code documentation systems often conflate global taxonomy (what area does this belong to?), structural metadata (which module/package?), and specific implementation knowledge (why was this decision made?). Mixing these levels makes search noisy and cross-project comparison impossible.

**Decision:**  
A three-tier hierarchy is enforced:
- **L1 Tags**: Global, cross-project classification pool (e.g., `Security`, `Caching`)
- **L2 Nodes**: Per-project Package / Module / Component with embedding
- **L3 Nodes**: Per-L2-node Implementation Decision / Rule / Rationale with embedding

All generate pipeline outputs must produce nodes in this hierarchy. Cross-project links connect L2 nodes across projects.

**Consequences:**
- ✅ Clean separation of concerns between global taxonomy and local knowledge
- ✅ Cross-project linking is structurally meaningful (L2 ↔ L2 links)
- ✅ L1 tags provide a project-independent classification vocabulary
- ⚠️ Three-table join required for full context retrieval
- ⚠️ LLM prompts must be carefully tuned per level to avoid conflation

---

### ADR-004: OpenAI-Compatible LLM Interface Only

**Status:** Accepted (v1)

**Context:**  
Docuvia needs LLM capabilities (text generation, embedding) but must remain provider-agnostic. Native SDKs (Anthropic, Google, Ollama) each have different APIs and add per-provider maintenance burden. The OpenAI API format has become the de facto standard supported by most providers and local runners.

**Decision:**  
All LLM calls go through `lib/integrations-openai-ai-server/`, which wraps an OpenAI-compatible `/v1/chat/completions` and `/v1/embeddings` endpoint. No native Ollama, Anthropic, or Gemini adapters are implemented. In development on Replit, the platform provisions an OpenAI-compatible endpoint automatically.

**Consequences:**
- ✅ Single integration point for all LLM calls
- ✅ Compatible with OpenAI, Azure OpenAI, OpenRouter, Groq, any OpenAI-compatible self-hosted model server
- ⚠️ Ollama requires an OpenAI-compatible compatibility layer (Ollama supports this via `OLLAMA_HOST`)
- ⚠️ Provider-specific features (structured output, vision, function calling variants) may require adapter adjustments

---

### ADR-005: MVC Pattern for UI Layers

**Status:** Accepted

**Context:**  
Early prototype code mixed data fetching, event handling, and rendering in single component files. This made unit testing impossible and created tight coupling between API shapes and visual layout.

**Decision:**  
Enforce strict View / Controller / Model separation in both the React frontend and VS Code extension (see [Section 8.3.2](08-crosscutting-concepts.md#832-ui-architecture-mvc) for the full rule specification).

**Consequences:**
- ✅ View components are pure and testable without API mocking
- ✅ Controller logic can be unit-tested without rendering
- ✅ Model (KnowledgeStore, React Query cache) is independently replaceable
- ⚠️ Requires discipline in PR reviews to catch layer violations
- ⚠️ Small components may feel over-structured; the rule applies only to components with meaningful state

---

### ADR-006: Human-in-the-Loop via Review Queue

**Status:** Accepted

**Context:**  
LLM-generated knowledge graph nodes can be inaccurate, hallucinated, or misclassified. Silently anchoring AI outputs to the knowledge graph would erode developer trust quickly. Equally, requiring 100% human-written nodes defeats the automation value proposition.

**Decision:**  
All AI-generated nodes are created with `status: "pending"` in `review_tasks`. Humans review and either anchor, merge, or reject. Approved corrections are stored in `correction_examples` and injected as few-shot prompts in subsequent pipeline runs, creating a continuous improvement loop.

**Consequences:**
- ✅ Human trust is maintained; no AI-generated data enters the graph without approval
- ✅ Correction examples create a project-specific fine-tuning signal without actual fine-tuning
- ⚠️ Review queue can accumulate if pipeline runs frequently on large repositories
- ⚠️ `review_tasks` table is a critical path — must not be bypassed

---

### ADR-007: Incremental Ingestion via Cursor Columns

**Status:** Accepted

**Context:**  
Re-ingesting full repository history on every pipeline run is prohibitively slow for repositories with thousands of commits. A stateless ingestion approach would also produce duplicate commits.

**Decision:**  
The `projects` table has `lastGitIngestedAt` (timestamp) and `lastSvnRevision` (string) cursor columns. The `commits` table has a `processedAt` column. Incremental ingestion reads only commits newer than the cursor; the `mode: "incremental" | "full"` parameter is respected in all ingest routes.

**Consequences:**
- ✅ Ingestion time is proportional to new commits, not total history
- ✅ No duplicate commits in the database
- ⚠️ Cursor must be updated atomically with commit inserts to prevent gaps on failure
- ⚠️ `mode: "full"` must be available as a recovery mechanism when cursor drift is suspected

---

## 9.3 Deferred Decisions

The following topics require future architectural decisions. See [`docs/ai_plans/`](../ai_plans/) for implementation plans:

| Topic | Current State | Reference |
|---|---|---|
| Multi-hop graph traversal (BFS/DFS) | 1-hop only via `node_links` | See [11-risks-and-debt.md R-02](11-risks-and-debt.md) |
| External vector DB migration | In-memory cosine similarity | See ADR-002 consequences |
| Multi-tenant SaaS architecture | Single-tenant in v1 | See [docs/saas-commercialization-roadmap.md](../saas-commercialization-roadmap.md) |
| Local LLM adapter (Ollama native) | OpenAI-compatible only | See ADR-004 consequences |
| VS Code extension distribution (`.vsix`) | No CI packaging step | See [11-risks-and-debt.md D-02](11-risks-and-debt.md) |
