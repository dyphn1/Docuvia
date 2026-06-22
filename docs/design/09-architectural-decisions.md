# 9. Architectural Decisions

## 9.1 ADR Index

This document records the key architectural decisions made during the development of Docuvia v1.0. Each record follows the format: **Context → Decision → Consequences**.

| ADR                                                                                | Title                                                        | Status        |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------ | ------------- |
| [ADR-001](#adr-001-openapi-as-single-source-of-truth)                              | OpenAPI as Single Source of Truth                            | Accepted      |
| [ADR-002](#adr-002-postgresql-with-jsonb-for-embeddings)                           | PostgreSQL with JSONB for Embeddings (No External Vector DB) | Accepted (v1) |
| [ADR-003](#adr-003-three-tier-knowledge-graph-l1l2l3)                              | Three-Tier Knowledge Graph (L1/L2/L3)                        | Accepted      |
| [ADR-004](#adr-004-openai-compatible-llm-interface-only)                           | OpenAI-Compatible LLM Interface Only                         | Accepted (v1) |
| [ADR-005](#adr-005-mvc-pattern-for-ui-layers)                                      | MVC Pattern for UI Layers                                    | Accepted      |
| [ADR-006](#adr-006-human-in-the-loop-via-review-queue)                             | Human-in-the-Loop via Review Queue                           | Accepted      |
| [ADR-007](#adr-007-incremental-ingestion-via-cursor-columns)                       | Incremental Ingestion via Cursor Columns                     | Accepted      |
| [ADR-008](#adr-008-orphan-branch-as-knowledge-store)                               | Orphan Git Branch as Knowledge Store                         | Accepted      |
| [ADR-009](#adr-009-l3-semantic-deduplication-via-occurrence-count)                 | L3 Semantic Deduplication via Occurrence Count               | Accepted      |
| [ADR-010](#adr-010-l2-bootstrap-ai-discovery-to-path-rules)                        | L2 Bootstrap: AI Discovery to Path Rules                     | Accepted      |
| [ADR-011](#adr-011-two-phase-knowledge-validity)                                   | Two-Phase Knowledge Validity                                 | Accepted      |
| [ADR-012](#adr-012-document-misc-pool)                                             | Document Misc Pool for Unaffiliated Documents                | Accepted      |
| [ADR-013](adrs/ADR-013-adversarial-implementation-protocol.md)                     | Adversarial Implementation Protocol                          | Active        |
| [ADR-014](adrs/ADR-014-microkernel-ast-architecture.md)                            | Microkernel AST Architecture                                 | Accepted      |
| [ADR-015](adrs/ADR-015-sql-indexed-graph-and-database-as-ipc.md)                   | SQL-Indexed Graph and Database-as-IPC                        | Accepted      |
| [ADR-016](adrs/ADR-016-progressive-enrichment-and-ast-lsp-dual-engine.md)          | Progressive Enrichment & AST/LSP Dual Engine                 | Accepted      |
| [ADR-017](adrs/ADR-017-git-blob-native-identity-and-checkout-thrashing-defense.md) | Git Blob-Native Identity & Checkout Thrashing Defense        | Accepted      |
| [ADR-018](adrs/ADR-018-tiered-storage-and-orphan-branch-graph-maintenance.md)      | Tiered Storage & Orphan Branch Graph Maintenance             | Accepted      |
| [ADR-019](adrs/ADR-019-temporal-and-conceptual-bidirectional-linking.md)           | Temporal & Conceptual Bidirectional Linking                  | Accepted      |
| [ADR-020](adrs/ADR-020-local-first-ast-parser.md)                                  | Local-First AST Parser Architecture for VS Code Client       | Accepted      |
| [ADR-021](adrs/ADR-021-unified-isomorphic-ast-engine.md)                           | Unified Isomorphic AST Engine                                | Accepted      |
| [ADR-022](adrs/ADR-022-ast-microkernel-architecture.md)                            | AST Microkernel Architecture & Ingestion Pipeline            | Accepted      |

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
All LLM calls go through `lib/integrations-openai-ai-server/`, which wraps an OpenAI-compatible `/v1/chat/completions` and `/v1/embeddings` endpoint. No native Ollama, Anthropic, or Gemini adapters are implemented.

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

The following topics require future architectural decisions. See the master roadmap for implementation plans:

| Topic                                    | Current State               | Reference                                                                                                              |
| ---------------------------------------- | --------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Multi-hop graph traversal (BFS/DFS)      | 1-hop only via `node_links` | See [11-risks-and-debt.md R-02](11-risks-and-debt.md)                                                                  |
| External vector DB migration             | In-memory cosine similarity | See ADR-002 consequences                                                                                               |
| Multi-tenant SaaS architecture           | Single-tenant in v1         | See [do../archive_v1_design/saas-commercialization-roadmap.md](../archive_v1_design/saas-commercialization-roadmap.md) |
| Local LLM adapter (Ollama native)        | OpenAI-compatible only      | See ADR-004 consequences                                                                                               |
| VS Code extension distribution (`.vsix`) | No CI packaging step        | See [11-risks-and-debt.md D-02](11-risks-and-debt.md)                                                                  |

---

### ADR-008: Orphan Git Branch as Knowledge Store

**Status:** Accepted

**Context:**  
The original design stored knowledge in PostgreSQL exclusively, with `.docuvia/` YAML files as a local working copy managed by the VS Code extension. This created two problems: (1) `.docuvia/` files were too large to commit into the working tree for large projects, as every branch checkout would carry the entire knowledge snapshot; (2) there was no mechanism to sync knowledge between developers without a live server connection.

**Decision:**  
Knowledge is stored in three layers with distinct responsibilities:

- **PostgreSQL** — full company-wide knowledge index, query engine, and review queue backend.
- **`docuvia-knowledge` orphan git branch** — the canonical, human-readable YAML/Markdown knowledge files, versioned independently of source code. Managed by the Docuvia server. Developers fetch this branch to get the latest knowledge snapshot.
- **`.docuvia/` (working tree)** — a lightweight manifest (`manifest.yaml`, `config.yaml`, `.snapshot-ref`) that points to the orphan branch HEAD. Committed to the source repo. Does NOT contain full knowledge content.

The git hook (`post-push`) triggers `docuvia sync`, which uploads local changes to the server. The server writes back to the orphan branch.

**Consequences:**

- ✅ Working tree is clean — no knowledge bloat regardless of project size
- ✅ Knowledge versioning is native git — `git log docuvia-knowledge` shows knowledge evolution
- ✅ Branch-agnostic — checking out any feature branch does not change the knowledge view
- ✅ Offline capability via `git fetch origin docuvia-knowledge` before going offline
- ⚠️ `docuvia sync` CLI is a new component that does not yet exist
- ⚠️ VS Code `KnowledgeStore` must be rewritten — current implementation reads `.docuvia/` files directly from the working tree filesystem; it must instead read from the orphan branch ref (via server API or `git show`)

---

### ADR-009: L3 Semantic Deduplication via Occurrence Count

**Status:** Accepted

**Context:**  
The generate pipeline inserts a new L3 node for every commit processed, with no deduplication. A large project with many commits touching the same design concern (e.g., “JWT is used for authentication”) would produce dozens of near-identical L3 nodes, violating the principle that knowledge should be condensed, not accumulated redundantly.

**Decision:**  
Before inserting a new L3 node, the pipeline computes cosine similarity between the candidate's embedding and all existing L3 nodes under the same L2 parent. If similarity ≥ 0.85 (configurable in `.docuvia/config.yaml` as `similarity_threshold`):

1. The new node is NOT inserted.
2. The matching existing node's `occurrenceCount` is incremented.
3. The source commit hash is appended to the existing node's `sourceCommits` JSONB array.

When `occurrenceCount` reaches a threshold (default: 30, configurable as `condensation_threshold`), an AI condensation run re-synthesizes the node's `content` field using all `sourceCommits` as input. Whether condensation triggers a review task is configurable (`condensation_review_required`, default: false).

A DB index on `l3_nodes(l2NodeId)` with pre-loaded embeddings makes the per-node scan efficient at L2-scoped scale.

**Consequences:**

- ✅ Knowledge converges — frequently-recurring design decisions become richer over time
- ✅ `occurrenceCount` is itself a quality signal: high count = core architectural decision
- ✅ Full evidence trail preserved via `sourceCommits[]`
- ✅ Reverse index (`commit_hash → l3_node_ids`) enables “what knowledge did this commit contribute to?”
- ⚠️ Similarity scan adds latency per L3 candidate — acceptable at L2-scoped scale but must be monitored
- ⚠️ `l3_nodes` schema requires new columns: `occurrenceCount integer`, `sourceCommits jsonb`, `validityStatus text`

---

### ADR-010: L2 Bootstrap — AI Discovery to Path Rules

**Status:** Accepted

**Context:**  
For a new project with no prior knowledge, there is no module map. The early design required a human to pre-define L2 modules before any generate run, which is impossible when “we don’t even know what the project does yet” (the core Docuvia use case: legacy projects with no documentation).

**Decision:**  
The first generate run uses a progressive batch mode: commits are processed in groups of 20. Each batch's LLM prompt includes the L2 module list produced by previous batches, enabling the AI to self-correct module names and boundaries across batches (automatic, no human review needed for cross-batch merges). After all batches complete, the system presents the discovered L2 module map to the project manager for confirmation.

Upon human confirmation:

- L2 module boundaries are written as glob path patterns to `.docuvia/config.yaml` under `modules:`.
- All future commits are assigned to L2 modules deterministically by path matching — LLM is no longer used for L2 assignment.
- Historical `commit_l2_links` rows are flagged with `reindexRequired: true` and retroactively corrected on the next generate run.

**Consequences:**

- ✅ Zero-configuration cold start — Docuvia can onboard any unknown legacy project
- ✅ L2 boundaries become stable and deterministic after bootstrap
- ✅ Path patterns are human-readable and editable without re-running AI
- ⚠️ Bootstrap batch mode is a distinct pipeline mode from normal incremental generate — must be implemented separately
- ⚠️ `l2_nodes` schema requires new columns: `pathPatterns jsonb`, `reindexRequired boolean`
- ⚠️ `commit_l2_links` junction table must be created; `commits.l2NodeId` column is deprecated

---

### ADR-011: Two-Phase Knowledge Validity

**Status:** Accepted

**Context:**  
AI-generated knowledge nodes can originate from commits on any branch — including feature branches that are later abandoned. Treating all generated knowledge as equally valid regardless of its source branch’s fate would pollute the knowledge graph with decisions from discarded design attempts.

**Decision:**  
L3 knowledge validity is determined by two independent gates:

**Phase 1 — Local Review (Quality Gate):**  
The developer or reviewer inspects the AI-generated content in VS Code or the Web UI. They confirm whether the AI's interpretation is accurate. This gate ensures content quality and is the current `review_tasks` mechanism. Passing Phase 1 sets status to `pending`.

**Phase 2 — Merge Gate (Validity Gate):**  
When the `docuvia sync` hook fires on `git push`, the server checks whether the source commits have been merged into the main/default branch. Commits confirmed merged set their associated L3 nodes to `valid`. Commits on branches that are later deleted without merging cause their L3 nodes to be set to `orphaned` (archived by default, not shown in standard queries).

Both phases are required for `valid` status. A human-reviewed L3 node from an abandoned branch remains `pending` until/unless the branch is merged, then transitions to `valid`.

**Validity status enum:** `pending | valid | orphaned`

**MCP query behavior:** Default filter is `status = valid` only. Query parameter `include_pending=true` enables pending knowledge (e.g., for querying a specific feature branch's design decisions).

**Consequences:**

- ✅ Abandoned design attempts do not contaminate the canonical knowledge graph
- ✅ In-progress work is visible to collaborators (with clear status labels)
- ✅ The review queue (Phase 1) retains its existing role; Phase 2 is additive
- ⚠️ Server must track branch merge status — requires either GitHub webhook integration or periodic polling
- ⚠️ `l3_nodes` and `commits` tables require `validityStatus` column
- ⚠️ `commits` table requires `branchName text` column

---

### ADR-012: Document Misc Pool for Unaffiliated Documents

**Status:** Accepted

**Context:**  
Documents (PDF, Word, Markdown specs) uploaded to Docuvia often cannot be immediately attributed to a specific project. Forcing project assignment at upload time makes Docuvia unusable for organizations that upload company-wide specs or standards that span multiple projects.

**Decision:**  
`documents.projectId` is made nullable. Documents uploaded without a project ID enter the **misc pool** (`projectId = null`, `status = 'unaffiliated'`). The pipeline extracts text content and computes a `contentHash` (SHA-256) at upload time, but does NOT run L1/L2/L3 generation and does NOT create review tasks.

When a project manager manually associates a misc pool document with a project (via Web UI), the system:

1. Sets `documents.projectId` to the target project.
2. Uses `contentHash` to check if this document has already been processed for this project — avoids duplicate generate runs.
3. Promotes the document into the project's generate pipeline on next run.

**Consequences:**

- ✅ Zero-friction document ingestion — upload first, classify later
- ✅ Company-wide specs can be associated with multiple projects over time
- ✅ No wasted LLM calls on documents not yet ready for knowledge extraction
- ⚠️ `documents` schema change: `projectId` must change from `NOT NULL` to nullable; add `contentHash text`, `affiliatedAt timestamp` columns
- ⚠️ Web UI needs a “Misc Pool” view and a “Associate with Project” action
