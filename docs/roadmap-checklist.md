# Docuvia — Phase Completion Checklist

> Audited: 2026-05-12 | Based on actual file structure from `find` output  
> Stack: TypeScript monorepo (Replit) — `lib/` + `artifacts/api-server/` + `artifacts/kg-engine/`
> Last updated: 2026-05-12 (v0.8 — SVN Integration implemented)

---

## Phase 1 | Foundation

| Item                            | Status         | Evidence                                                                                       |
| ------------------------------- | -------------- | ---------------------------------------------------------------------------------------------- |
| Monorepo directory layout       | ✅ Done        | `lib/`, `artifacts/`, `scripts/` structure                                                     |
| Core DB schemas defined         | ✅ Done        | `lib/db/src/schema/` — projects, commits, documents, llm_configs, activity_log                 |
| Logging                         | ✅ Done        | `artifacts/api-server/src/lib/logger.ts`                                                       |
| LLM abstraction layer           | ✅ Done        | `lib/integrations-openai-ai-server/` + Replit skills for Anthropic, Gemini, OpenAI, OpenRouter |
| Per-project model switching     | ✅ Done        | `lib/db/src/schema/llm_configs.ts` + API route `llm_config.ts`                                 |
| CI/CD pipeline (GitHub Actions) | ✅ Done        | `.github/workflows/ci.yml` — lint + typecheck-and-build parallel jobs, pnpm 9, Node 22         |

**Progress: 6 / 6**

---

## Phase 2 | Input Layer

| Item                                     | Status         | Evidence                                                                                                                                    |
| ---------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Git ingestion (commit + diff)            | ✅ Done        | `gitIngestInput.ts`, `gitIngestResult.ts`, `routes/ingest.ts`                                                                               |
| Document ingestion (PDF/Word/PPTX/MD)    | ✅ Done        | `document-parser.ts` (lazy require for pdf-parse/mammoth/officeparser), `upload.ts` (multer), `POST /projects/:id/ingest/document/upload` multipart endpoint |
| SVN integration                          | ✅ Done        | `lib/svn-client.ts` (execFile-based CLI wrapper), `routes/ingest.ts` `POST /projects/:id/ingest/svn`, `SvnIngestInput`/`SvnIngestResult` OpenAPI schemas, `vcsType`+`svnUrl` on projects, `revision`+`vcsType` on commits |
| Build artifact parser (map files, FV/FD) | ❌ Not started | No related files found                                                                                                                      |

**Progress: 3 / 4**

---

## Phase 3 | Knowledge Construction Layer

| Item                                       | Status  | Evidence                                                                                         |
| ------------------------------------------ | ------- | ------------------------------------------------------------------------------------------------ |
| Commit filter (convention-based)           | ✅ Done | `scoreCommit()` in `ingest.ts` — regex signal/noise patterns                                     |
| L1 Tagger — global tag pool                | ✅ Done | `lib/db/src/schema/l1_tags.ts`, `routes/l1_tags.ts`, full CRUD types                             |
| L2 Extractor — module/component            | ✅ Done | `lib/db/src/schema/l2_nodes.ts`, `routes/l2_nodes.ts`, full CRUD types                           |
| L3 Generator — rules, decisions, rationale | ✅ Done | `lib/db/src/schema/l3_nodes.ts`, `routes/l3_nodes.ts`, full CRUD types                           |
| Generate pipeline (diff → L1/L2/L3)        | ✅ Done | `routes/generate.ts` — 6-step fully wired pipeline with LLM, deduplication, review task creation |

**Progress: 5 / 5**

---

## Phase 4 | Knowledge Graph

| Item                           | Status     | Evidence                                                                                             |
| ------------------------------ | ---------- | ---------------------------------------------------------------------------------------------------- |
| Graph index — node links       | ✅ Done    | `lib/db/src/schema/node_links.ts`, `nodeLinkInput.ts`, `projectGraph.ts`                             |
| Vector index (semantic search) | ✅ Done    | `lib/embedding.ts` — in-memory cosine similarity; embeddings stored as JSON in `l2_nodes`/`l3_nodes` |
| Impact analysis traversal      | ✅ Done    | One-hop graph traversal via `nodeLinksTable`; `mcpImpactResult.ts` wired                             |
| Cross-project dynamic linking  | ✅ Done    | `detectCrossProjectLinks()` in `generate.ts` — cosine similarity ≥ 0.85 triggers review task with "merge" type suggesting cross-project link |

**Progress: 4 / 4**

---

## Phase 5 | Query Layer & MCP Tools

| Item                                | Status         | Evidence                                                      |
| ----------------------------------- | -------------- | ------------------------------------------------------------- |
| MCP route scaffolding               | ✅ Done        | `artifacts/api-server/src/routes/mcp.ts`                      |
| `search_knowledge` endpoint         | ✅ Done        | `mcpSearchKnowledgeParams.ts`, `mcpSearchResult.ts`           |
| `get_dependencies` endpoint         | ✅ Done        | `mcpGetDependenciesParams.ts`, `mcpDependencyResult.ts`       |
| `impact_analysis` endpoint          | ✅ Done        | `mcpImpactAnalysisParams.ts`, `mcpImpactResult.ts`            |
| `get_decision_record` endpoint      | ✅ Done        | `mcpGetDecisionRecordParams.ts`, `mcpDecisionRecord.ts`       |
| `list_projects` endpoint            | ✅ Done        | `mcpProjectList.ts`, `mcpProjectListProjectsItem.ts`          |
| Agentic RAG (intent-driven routing) | ✅ Done        | `intent-router.ts` + `POST /mcp/query` — LLM-classified 4-way routing (vector/graph/direct/hybrid), OpenAPI spec updated, `useMcpQuery` hook generated |
| Natural language CLI / Web UI       | ✅ Done        | `artifacts/kg-engine/src/pages/query.tsx` — semantic search UI with project filter, layer-colored result cards, score display |

**Progress: 8 / 8**

---

## Phase 6 | Human-in-the-Loop

| Item                                   | Status         | Evidence                                                                    |
| -------------------------------------- | -------------- | --------------------------------------------------------------------------- |
| Review task schema                     | ✅ Done        | `lib/db/src/schema/review_tasks.ts`, full CRUD types                        |
| Review API routes                      | ✅ Done        | `artifacts/api-server/src/routes/review_tasks.ts`                           |
| Review stats                           | ✅ Done        | `reviewStats.ts`                                                            |
| Review resolution workflow             | ✅ Done        | `reviewResolution.ts`, `reviewResolutionStatus.ts`                          |
| Review UI (frontend)                   | ✅ Done        | `review.tsx` — TaskCard, approve/reject/defer, correction editing confirmed |
| Noise detection (inconsistent tagging) | ✅ Done        | `runNoiseDetection()` in `generate.ts` — flags low-usage tags (≤1 use) and near-duplicate tag names, creates `anchor`/`merge` review tasks automatically |
| Feedback loop (corrections → prompts)  | ✅ Done        | `lib/db/src/schema/correction_examples.ts` + writeback in `review_tasks.ts` stores corrections; `getRecentCorrections()` in `generate.ts` injects last 5 corrections as few-shot examples |
| Template management (L1/L2/L3)         | ✅ Done        | `lib/db/src/schema/prompt_templates.ts` + `routes/templates.ts` (GET/PUT/DELETE per project per type) + `/templates` frontend page — editable per-project prompts with default fallback |

**Progress: 8 / 8**

---

## Phase 7 | Enhancements & Ecosystem

| Item                            | Status         | Evidence                                                        |
| ------------------------------- | -------------- | --------------------------------------------------------------- |
| Export (Markdown / JSON)        | ✅ Done        | `artifacts/api-server/src/routes/export.ts`, `projectExport.ts` |
| Dashboard & stats               | ✅ Done        | `routes/dashboard.ts`, `dashboardStats.ts`, `activityItem.ts`   |
| Incremental update (delta-only) | ❌ Not started | No event listener or delta tracking found                       |
| Cross-team subscription         | ❌ Not started | —                                                               |
| VS Code extension               | ❌ Not started | —                                                               |
| Slack / Teams bot               | ❌ Not started | —                                                               |
| GitHub PR integration           | ❌ Not started | —                                                               |

**Progress: 2 / 7**

---

## 📋 Remaining Task List

### 🔴 High Priority — Core Gaps

- [x] **CI/CD**: ✅ Implemented — `.github/workflows/ci.yml` with lint + typecheck-and-build jobs, `.prettierrc`, `.prettierignore`
- [x] **Document parsers**: ✅ Implemented — `document-parser.ts` + `upload.ts` + `POST /projects/:id/ingest/document/upload`
- [x] **Agentic RAG**: ✅ Implemented — `intent-router.ts` (LLM intent classification, 4-way routing), `POST /mcp/query` endpoint, OpenAPI spec + Orval codegen (`useMcpQuery` hook)

### 🟠 Medium Priority — Complete Partial Implementations

- [x] **Cross-project AI detection**: ✅ Implemented — `detectCrossProjectLinks()` in `generate.ts` uses cosine similarity (≥0.85 threshold) to find similar L2 nodes in other projects after each generation run; creates `merge`-type review task with similarity score
- [x] **kg-engine frontend — L2 Directory**: ✅ Implemented — `projects/[id].tsx` L2 Directory tab: expandable node cards with L3 children, type filter, search, confidence scores, review badges
- [x] **Template management UI**: ✅ Implemented — `lib/db/src/schema/prompt_templates.ts` + `routes/templates.ts` + `/templates` page — per-project editable L1/L2/L3 system prompts with reset-to-default

### 🟡 Lower Priority — Human-in-the-Loop Depth

- [x] **Noise detection**: ✅ Implemented — `runNoiseDetection()` in `generate.ts` — runs automatically post-generation; flags low-usage tags (≤1 use) + near-duplicate tag names; creates `anchor`/`merge` review tasks
- [x] **Feedback loop**: ✅ Implemented — `lib/db/src/schema/correction_examples.ts` + updated `review_tasks.ts` (stores original→corrected pairs on approval); `generate.ts` fetches last 5 corrections per project and injects as few-shot examples into L2 extraction prompt

### 🟠 Medium Priority — Phase 2 Gaps

- [x] **SVN integration**: ✅ Implemented — `artifacts/api-server/src/lib/svn-client.ts` (typed `execFile` wrapper for `svn log --xml` + `svn diff`), `POST /projects/:id/ingest/svn` route with deduplication, `SvnIngestInput`/`SvnIngestResult` OpenAPI schemas + Orval codegen, `vcsType`/`svnUrl` on projects table, `revision`/`vcsType` on commits table

### ⚪ Future — Phase 7

- [ ] Incremental update (watch new commits, delta indexing)
- [ ] Build artifact parser (map files, FV/FD, compile logs)
- [ ] VS Code extension
- [ ] Slack / Teams bot
- [ ] GitHub PR integration

---

## Summary

| Phase     | Name                   | Progress           |
| --------- | ---------------------- | ------------------ |
| 1         | Foundation             | 6 / 6 — 100%       |
| 2         | Input Layer            | 3 / 4 — 75%        |
| 3         | Knowledge Construction | 5 / 5 — 100%       |
| 4         | Knowledge Graph        | 4 / 4 — 100%       |
| 5         | Query Layer / MCP      | 8 / 8 — 100%       |
| 6         | Human-in-the-Loop      | 8 / 8 — 100%       |
| 7         | Enhancements           | 2 / 7 — 29%        |
| **Total** |                        | **36 / 42 — 86%** |

> **Key insight:** Core pipeline (L1→L2→L3), semantic search, impact analysis, review UI, document parsers, CI/CD, Agentic RAG, cross-project AI detection, L2 Directory UI, prompt template management, noise detection, feedback loop, and SVN integration are now fully implemented.  
> The remaining Phase 2 gap is Build artifact parser. Remaining Phase 7 gaps are ecosystem integrations (VS Code, Slack, GitHub PR, incremental update).

---

_Document version: v0.8 — Audited & updated from actual file structure + post-implementation_  
*Last updated: 2026-05-12 (v0.8 — SVN Integration implemented: svn-client.ts, ingest/svn route, OpenAPI schemas, DB schema columns)*
