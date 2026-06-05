# Docuvia Architecture Audit: Design Flaws & Gaps

This document presents a comprehensive audit of the Docuvia monorepo, contrasting the system design specifications (under `docs/design/` and `artifacts/vscode-client/design/`) with the actual codebase implementation.

Following a 3-pass deep architectural reflection, we have identified key design inconsistencies, flaws, unimplemented mechanisms, and bugs.

---

## Pass 1: Local-First vs. Central Server Gaps (Extension & Backend)

### 1.1 Asynchronous Metabolism is Entirely Unimplemented

- **Design Doc**: [`docs/design/asynchronous-metabolism.md`](file:///d:/GitHub/Docuvia/docs/design/asynchronous-metabolism.md)
- **Design Spec**: Describes a client heartbeat-driven mechanism where the VS Code extension periodically pings `/api/metabolism-tick` to trigger micro-batch jobs (embedding calculation, decay processing, distillation) on the PostgreSQL DB-backed queue. It also details a `/api/admin/metabolism-tick` endpoint for cron triggers.
- **Implementation Gap**:
  - No `/api/metabolism-tick` or `/api/admin/metabolism-tick` endpoints exist in [`artifacts/api-server/src/routes/`](file:///d:/GitHub/Docuvia/artifacts/api-server/src/routes/).
  - The VS Code client [`CentralServerClient.ts`](file:///d:/GitHub/Docuvia/artifacts/vscode-client/src/CentralServerClient.ts) has no heartbeat/ping dispatcher.
  - Ingestion and generation run entirely synchronously or as single-run blocked request routes (e.g. `POST /projects/:id/generate`) rather than utilizing a client-driven drip feed.

### 1.2 Missing `last_verified_at` for Temporal Decay & Garbage Collection

- **Design Docs**: [`docs/design/agentic-rag-routing.md`](file:///d:/GitHub/Docuvia/docs/design/agentic-rag-routing.md) and [`docs/design/local-first-architecture.md`](file:///d:/GitHub/Docuvia/docs/design/local-first-architecture.md)
- **Design Spec**: Describes a temporal decay calculation applied to vector/graph search scores based on `last_verified_at` and `created_at` fields on knowledge nodes. Touched knowledge is "refreshed" while untouched knowledge decays.
- **Implementation Gap**:
  - Drizzle schemas for L2 and L3 nodes ([`l2_nodes.ts`](file:///d:/GitHub/Docuvia/lib/db/src/schema/l2_nodes.ts) and [`l3_nodes.ts`](file:///d:/GitHub/Docuvia/lib/db/src/schema/l3_nodes.ts)) do not contain `last_verified_at` or `lastVerifiedAt` fields.
  - The orchestrator [`intent-router.ts`](file:///d:/GitHub/Docuvia/artifacts/api-server/src/lib/intent-router.ts) has no decay math inside its handlers. Results are sorted solely by raw cosine similarity or graph edge distance.

### 1.3 Hardcoded Single Workspace assumption in Multi-Root Actions

- **Design Docs**: [`artifacts/vscode-client/design/knowledge-graph/nodes.md`](file:///d:/GitHub/Docuvia/artifacts/vscode-client/design/knowledge-graph/nodes.md) and [`artifacts/vscode-client/design/knowledge-graph/store.md`](file:///d:/GitHub/Docuvia/artifacts/vscode-client/design/knowledge-graph/store.md)
- **Design Spec**: Details full support for multi-root workspaces, resolving and executing actions scoped to the active workspace folder.
- **Implementation Gap**:
  - `docuvia.acceptL1Tags` (triggered by `/explore` button) is hardcoded to write strictly to `vscode.workspace.workspaceFolders?.[0]`. If a developer runs `/explore` on a secondary workspace root in a multi-root setup, the tags are written to the first workspace root instead.
  - Extraction writes in `TaskRunner.writeExtractionResults` are hardcoded to `workspaceFolders[0]`, lacking folder routing based on the file being extracted.

---

## Pass 2: Parser Fragility and Configuration Defects (VS Code client)

### 2.1 Critical Parser Crash on L1 Tags Format

- **Design Doc**: [`artifacts/vscode-client/design/command-palette/init-project.md`](file:///d:/GitHub/Docuvia/artifacts/vscode-client/design/command-palette/init-project.md)
- **Design Spec**: `initProject` scaffolds a skeleton `l1_tags.yaml` containing project metadata and a nested tag list:
  ```yaml
  project_name: "MyProject"
  tags:
    - id: 1
      name: Core
  ```
- **Implementation Gap**:
  - [`parser.ts::parseTags`](file:///d:/GitHub/Docuvia/artifacts/vscode-client/src/parser.ts) runs `parseYaml(content) as unknown[]` and calls `.map()` on it.
  - Because the skeleton is a top-level object (`{ project_name, tags }`), `parseYaml` returns a plain object, causing `.map()` to throw `TypeError: raw.map is not a function`.
  - The `tryParse` wrapper in [`KnowledgeStore.ts`](file:///d:/GitHub/Docuvia/artifacts/vscode-client/src/KnowledgeStore.ts) catches this error silently and returns an empty array `[]`.
  - **Result**: If the developer populates the tags list under the scaffolded format, the tree view displays zero L1 tags, leaving the user with no visual categories.

### 2.2 Missing Configurations and Warnings in package.json

- **Design Doc**: [`artifacts/vscode-client/design/command-palette/run-extraction.md`](file:///d:/GitHub/Docuvia/artifacts/vscode-client/design/command-palette/run-extraction.md)
- **Design Spec**: Checks file size against `docuvia.extraction.maxFileSizeKBWarning` before starting extraction.
- **Implementation Gap**:
  - `docuvia.extraction.maxFileSizeKBWarning` is completely absent from `package.json` configurations.
  - [`extension.ts`](file:///d:/GitHub/Docuvia/artifacts/vscode-client/src/extension.ts) (`runExtraction()`) only validates line count against `maxLinesWarning`, completely ignoring byte size checks.

### 2.3 Dead Template Tokens in Chat Classification

- **Design Doc**: [`artifacts/vscode-client/design/chat-participant/slash-commands.md`](file:///d:/GitHub/Docuvia/artifacts/vscode-client/design/chat-participant/slash-commands.md)
- **Design Spec**: Lists `data-science` as a fast-path override keyword matching built-in templates.
- **Implementation Gap**:
  - While `data-science` is registered in `TYPE_TOKENS` in [`ChatParticipant.ts`](file:///d:/GitHub/Docuvia/artifacts/vscode-client/src/ChatParticipant.ts), there is no matching entry in `L1_TEMPLATES`.
  - As a result, typing `/explore data-science` silently fails to skip workspace scanning and does not return templates.

### 2.4 Unassigned Decisions Node is Unimplemented in Tree View

- **Design Doc**: [`artifacts/vscode-client/design/knowledge-graph/nodes.md`](file:///d:/GitHub/Docuvia/artifacts/vscode-client/design/knowledge-graph/nodes.md)
- **Design Spec**: Specifies a virtual container node `unassigned-group` under Project to display L3 decisions where `l2_module_id` is `'unassigned'` or invalid.
- **Implementation Gap**:
  - [`KnowledgeGraphTreeProvider.ts`](file:///d:/GitHub/Docuvia/artifacts/vscode-client/src/KnowledgeGraphTreeProvider.ts) has zero logic for creating or appending `unassigned-group` nodes. Unassigned decisions are hidden from the UI hierarchy.

---

## Pass 3: RAG Routing & Swarm Intelligence Oversimplifications

### 3.1 LLM Intent Classification Caching and Efficiency Gaps

- **Design Doc**: [`docs/design/agentic-rag-routing.md`](file:///d:/GitHub/Docuvia/docs/design/agentic-rag-routing.md)
- **Design Spec**: Routing arbitration prioritizes $O(1)$ local caches and map keys over expensive LLM inference.
- **Implementation Gap**:
  - [`intent-router.ts`](file:///d:/GitHub/Docuvia/artifacts/api-server/src/lib/intent-router.ts) (`routeQuery()`) invokes `classifyIntent()` immediately for every query, which performs a blocking LLM api call (`gpt-4o-mini`).
  - No cache layer, no keyword parsing fallback, and no map key resolution is performed prior to the LLM classification.

### 3.2 Swarm Intelligence / Distillation Job is Static

- **Design Doc**: [`docs/design/self-evolution-architecture.md`](file:///d:/GitHub/Docuvia/docs/design/self-evolution-architecture.md)
- **Design Spec**: Details a background distillation worker that compiles corrections from `correction_examplesTable` to automatically update `prompt_templatesTable` and sync O(1) map keys via the `docuvia-knowledge` git branch.
- **Implementation Gap**:
  - The `correction_examples` table is purely write-only.
  - No background process or LLM distillation handler exists to process these rows.
  - No prompt template update jobs exist, and git branch mapping for O(1) cache rollouts is completely absent.

---

## Summary of Critical Action Items for Round 2

1.  **Parser Fix**: Update `parseTags` in `parser.ts` to support both flat arrays and `{ project_name, tags }` structure to prevent silent category drops.
2.  **Multiroot Scoping**: Scavenge target workspace roots from current active editor context in VS Code client commands (`acceptL1Tags`, `runExtraction` output paths) instead of default folder index `[0]`.
3.  **Virtual Nodes**: Append the virtual `unassigned-group` node in `KnowledgeGraphTreeProvider.ts` to expose unassigned L3 decisions in the tree view.
4.  **Configuration Alignment**: Add `docuvia.extraction.maxFileSizeKBWarning` to package.json and enforce file byte size checks in `runExtraction`.
