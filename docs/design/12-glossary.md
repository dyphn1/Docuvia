# 12. Glossary

## Core Domain Terms

| Term | Definition |
|---|---|
| **L1 Tag** | A global classification label applied across all projects. Represents top-level architectural or functional areas (e.g., `Security`, `Networking`, `Build System`). AI-suggested L1 candidates always enter the review queue before anchoring. Stored in the `l1_tags` table. |
| **L2 Node** | A Package, Module, or Component scoped to a single project. Extracted from commit diff paths and code structure by the generate pipeline. Linked to one or more L1 Tags. Stores an embedding vector (JSONB) enabling semantic search. Stored in `l2_nodes`. |
| **L3 Node** | An Implementation Decision, Rule, or Rationale record scoped to an L2 Node. The primary output of the generate pipeline and the deepest level of the knowledge graph. Stores an embedding vector. Linked to source commits. Stored in `l3_nodes`. |
| **Node Link** | A directed relationship between two L2 or L3 nodes (intra-project or cross-project). Created when a human approves a cross-project similarity match, or by explicit manual linking. Stored in `node_links`. |
| **Generate Pipeline** | The 6-step LLM pipeline that transforms raw ingested commits into L1/L2/L3 nodes. Steps: (1) fetch unprocessed commits → (2) L1 tagging → (3) L2 extraction with embeddings → (4) L3 generation with embeddings → (5) cross-project similarity detection → (6) noise detection. |
| **Ingest** | The process of importing commit history from a VCS (Git or SVN) or uploading documents into Docuvia's database. Produces `commits` and `documents` rows. Uses `scoreCommit()` to filter low-signal commits. |
| **Agentic RAG** | Retrieval-Augmented Generation with LLM-based intent routing. A 4-way query strategy (vector \| graph \| direct \| hybrid) that selects the best retrieval method for a natural language query. Exposed at `/mcp/query`. |
| **Intent Router** | The LLM-powered component (`intent-router.ts`) that classifies incoming `/mcp/query` requests into one of four strategies and routes them to the appropriate search mechanism. |
| **Review Task** | A human-in-the-loop work item stored in the `review_tasks` table. Created by the generate pipeline for every AI-generated node. Types: `anchor` (confirm the node), `merge` (consolidate with another node), `reject` (discard the node). |
| **Correction Example** | A human-approved edit to an AI-generated node, stored in `correction_examples`. Injected as few-shot examples into subsequent generate pipeline runs to improve LLM accuracy over time. |
| **Prompt Template** | A per-project overridable LLM system prompt for L1, L2, or L3 generation. Falls back to a built-in default if not set for a project. Stored in `prompt_templates`. |
| **MCP** | Model Context Protocol — the HTTP-based protocol used by AI IDEs (Cursor, GitHub Copilot, Claude, etc.) to call Docuvia's knowledge graph as a set of tools. Exposed via `/mcp/*` Express routes. |
| **Impact Analysis** | A traversal of the `node_links` graph to determine which other modules or decisions are transitively affected by a change to a given node. Currently one-hop; multi-hop BFS/DFS traversal is planned. |
| **Cross-Project Link** | A `node_links` row connecting L2 nodes from different projects, detected via cosine similarity ≥ 0.85 between embeddings. Requires human review approval before the link is activated. |
| **Incremental Ingestion** | An ingestion mode that processes only new commits since the last run, using cursor columns (`lastGitIngestedAt` on `projects` for Git, `lastSvnRevision` for SVN, and `processedAt` on `commits`). |
| **Noise Detection** | An automated step at the end of the generate pipeline that flags low-usage L1 tags and near-duplicate tag names, creating `anchor` and `merge` review tasks for human resolution. |
| **VS Code Client** | The VS Code extension in `artifacts/vscode-client/`. Provides a Knowledge Graph TreeView, Command Palette commands (Init, Ingest, Extract, Search), a Copilot Chat participant (`@docuvia`), CodeLens, and Hover providers. |
| **KnowledgeStore** | The singleton service (`KnowledgeStore.ts`) in the VS Code extension that manages the in-memory snapshot of the `.docuvia/` YAML files and syncs changes to disk. Acts as the Model layer of the VS Code extension. |
| **`.docuvia/`** | The per-workspace configuration and snapshot directory created by the VS Code extension's `Init Project` command. Contains `l1_tags.yaml`, `l2_modules.yaml`, and `l3_decisions/` subdirectory. |
| **Orval** | The code generation tool that reads `lib/api-spec/openapi.yaml` and generates Zod validators (`lib/api-zod/src/generated/`) and React Query hooks (`lib/api-client-react/src/generated/`). Run via `pnpm --filter @workspace/api-spec run codegen`. |
| **scoreCommit()** | The signal/noise scoring function applied during ingestion to filter out low-value commits (e.g., merge commits, `chore:` bumps, auto-generated changes). Returns a numeric score; commits below the threshold are skipped. |

---

## Acronyms

| Acronym | Expansion |
|---|---|
| VCS | Version Control System |
| MCP | Model Context Protocol |
| RAG | Retrieval-Augmented Generation |
| LLM | Large Language Model |
| ADR | Architectural Decision Record |
| ORM | Object-Relational Mapper |
| NFR | Non-Functional Requirement |
| POP | Protocol-Oriented Programming |
| OOP | Object-Oriented Programming |
| MVC | Model-View-Controller |
| HMAC | Hash-based Message Authentication Code |
| JSONB | JSON Binary (PostgreSQL column type for binary-encoded JSON with indexing support) |
| ESM | ECMAScript Modules |
| HMR | Hot Module Replacement |
| ANN | Approximate Nearest Neighbour (used in vector search) |
| CI | Continuous Integration |
| PR | Pull Request |
| YAML | YAML Ain't Markup Language (used in `.docuvia/` workspace files) |
| FTS | Full-Text Search |
| BFS | Breadth-First Search (planned multi-hop graph traversal algorithm) |
| DFS | Depth-First Search (planned multi-hop graph traversal algorithm) |

---

## References

- [08-crosscutting-concepts.md](08-crosscutting-concepts.md#81-domain-model) — Full domain model entity-relationship diagram
- [05-building-blocks.md](05-building-blocks.md#54-level-2--db-package-schemas) — Full schema table list
- [AGENTS.md](../../AGENTS.md) — Product domain knowledge section
