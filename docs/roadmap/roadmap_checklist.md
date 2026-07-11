# Docuvia — Roadmap Checklist

> Auto-generated from `docs/design/` (arc42 sections 01–12 + ADRs 001–012) and `docs/roadmap/master-roadmap.md`.
> This is the tracking checklist for the periodic design verification cron job.
> Last Updated: 2026-06-11

## Legend

| Symbol     | Meaning                             |
| ---------- | ----------------------------------- |
| ✅ Done    | Implemented and verified            |
| ⚠️ WIP     | Partially implemented — gaps remain |
| ❌ Todo    | Not yet implemented                 |
| 🔵 Pending | Awaiting review/verification        |

---

## Milestone 1: Knowledge Graph Foundation & API Server

### 1.1 Core Database & ORM Setup

- [x] 1.1.1 ✅ Drizzle ORM schema for all 16 tables (projects, commits, documents, activity_log, l1_tags, l2_nodes, l3_nodes, node_links, review_tasks, correction_examples, pull_requests, project_integrations, notifications, subscriptions, llm_configs, prompt_templates)
- [x] 1.1.2 ✅ DB push / push-force scripts
- [x] 1.1.3 ✅ withRollback() integration test support
- [ ] 1.1.4 ⚠️ Test factories for DB state creation (factories.ts)

### 1.2 Multi-Format Ingestion (Git, SVN, PDF, Build logs, Documents)

- [ ] 1.2.1 ⚠️ Git ingestion via child_process.execFile (git log, git diff)
- [ ] 1.2.2 ⚠️ SVN ingestion via svn log --xml, svn diff
- [ ] 1.2.3 ⚠️ Document upload and parsing (PDF, Word/PPTX, Markdown, text)
- [ ] 1.2.4 ⚠️ Build artifact parser
- [ ] 1.2.5 ⚠️ scoreCommit() signal/noise filter
- [ ] 1.2.6 ⚠️ Incremental ingestion via cursor columns (lastGitIngestedAt, lastSvnRevision, processedAt)

### 1.3 RAG Orchestrator (Intent Router)

- [ ] 1.3.1 ⚠️ 4-way LLM-based intent classification (vector | graph | direct | hybrid)
- [ ] 1.3.2 ⚠️ Vector search: cosine similarity over JSONB embeddings
- [ ] 1.3.3 ⚠️ Graph search: node_links traversal
- [ ] 1.3.4 ⚠️ Direct search: full-text search on l3_nodes.content
- [ ] 1.3.5 ⚠️ Hybrid search: vector + graph merge and re-rank
- [ ] 1.3.6 ⚠️ Temporal decay scoring (lastVerifiedAt)

### 1.4 Server-Side Metabolism & Mutex

- [ ] 1.4.1 ⚠️ Asynchronous metabolism mechanism (ADR-008)
- [x] 1.4.2 ✅ Mutex / serialization for concurrent generate requests

---

## Milestone 2: VS Code Client (Local-First Architecture)

### 2.1 Standalone Engine (Graceful Degradation)

- [x] 2.1.1 ✅ Local-first operation without CentralServerClient
- [x] 2.1.2 ✅ Graceful degradation fallback logic (CentralServerClient.ts)

### 2.2 Zero-to-One Onboarding (@docuvia /init)

- [x] 2.2.1 ⚠️ Project initialization command (docuvia.initProject)
- [x] 2.2.2 ⚠️ Package.json ecosystem marker parsing (WIP — needs completion)
- [ ] 2.2.3 ⚠️ .docuvia/ directory creation with manifest.yaml, config.yaml, .snapshot-ref

### 2.3 Multi-root Workspace Support

- [x] 2.3.1 ✅ TaskRunner dynamic root scoping
- [x] 2.3.2 ✅ Per-workspace .docuvia/ isolation

### 2.4 Virtual Nodes (Unassigned Group) UI

- [x] 2.4.1 ✅ KnowledgeGraphTreeProvider with unassigned group
- [x] 2.4.2 ✅ Auto-categorize decisions command

### 2.5 Token Limits & Chunking Configs

- [x] 2.5.1 ✅ maxFileSizeKBWarning in extension.ts
- [x] 2.5.2 ✅ Chunking configs for extraction

---

## Milestone 3: Swarm Intelligence & Git-Isomorphic Sync

### 3.1 Background Distillation Job

- [x] 3.1.1 ✅ correction_examples summary logic
- [x] 3.1.2 ✅ Few-shot injection into generate pipeline

### 3.2 Temporal Decay Scoring

- [x] 3.2.1 ✅ lastVerifiedAt math in intent-router.ts
- [x] 3.2.2 ✅ Decay application on knowledge query results

### 3.3 O(1) Fast-Path Filters (#attach)

- [x] 3.3.1 ✅ Regex pre-filters skipping LLM latency

### 3.4 Orphan Branch Read/Write Protocol

- [ ] 3.4.1 ❌ Orphan branch writer (orphan-branch-writer.ts)
- [ ] 3.4.2 ❌ Bidirectional sync between Client and Server
- [ ] 3.4.3 ❌ docuvia sync CLI (not yet implemented)
- [x] 3.4.4 ✅ VS Code KnowledgeStore rewrite to read from orphan branch ref

### 3.5 Diff Projection & Ancestor Anchoring

- [x] 3.5.1 ✅ git merge-base lookup for un-indexed commits
- [x] 3.5.2 ✅ Temporal delta projection

---

## Milestone 4: Knowledge Graph Features (ADRs 009–012)

### 4.1 L3 Semantic Deduplication (ADR-009)

- [x] 4.1.1 ✅ Cosine similarity ≥ 0.85 dedup check before L3 insert
- [x] 4.1.2 ✅ occurrenceCount increment on match
- [x] 4.1.3 ⚠️ sourceCommits JSONB array append
- [x] 4.1.4 ⚠️ AI condensation run at occurrence threshold (default: 30)
- [x] 4.1.5 ✅ l3_nodes schema: occurrenceCount, sourceCommits, validityStatus columns

### 4.2 L2 Bootstrap — AI Discovery to Path Rules (ADR-010)

- [x] 4.2.1 ⚠️ Progressive batch mode (commits in groups of 20)
- [x] 4.2.2 ⚠️ AI self-correction across batches
- [x] 4.2.3 ✅ L2 module map confirmation UI
- [x] 4.2.4 ✅ Path pattern storage in .docuvia/config.yaml
- [x] 4.2.5 ✅ Deterministic commit-to-module assignment via glob matching
- [ ] 4.2.6 ⚠️ commit_l2_links junction table (deprecate commits.l2NodeId)

### 4.3 Two-Phase Knowledge Validity (ADR-011)

- [x] 4.3.1 ✅ Phase 1: Local Review quality gate (existing review_tasks)
- [x] 4.3.2 ✅ Phase 2: Merge Gate — branch merge status check
- [x] 4.3.3 ⚠️ L3 validity status enum: pending | valid | orphaned
- [x] 4.3.4 ⚠️ MCP query default filter: status = valid only
- [ ] 4.3.5 ⚠️ include_pending=true query parameter
- [x] 4.3.6 ✅ Schema: validityStatus column on l3_nodes and commits
- [x] 4.3.7 ✅ Schema: branchName column on commits
- [x] 4.3.8 ✅ Branch merge status tracking (GitHub webhook or polling)

### 4.4 Document Misc Pool (ADR-012)

- [ ] 4.4.1 ⚠️ Nullable documents.projectId
- [ ] 4.4.2 ⚠️ contentHash (SHA-256) at upload time
- [ ] 4.4.3 ⚠️ Misc pool extraction without L1/L2/L3 generation
- [ ] 4.4.4 ⚠️ Project association flow (promote to pipeline)
- [x] 4.4.5 ✅ Web UI: Misc Pool view + "Associate with Project" action
- [ ] 4.4.6 ⚠️ Schema: contentHash, affiliatedAt columns on documents

---

## Milestone 5: Human-in-the-Loop & Review System

### 5.1 Review Task Queue

- [x] 5.1.1 ✅ Review task creation for all AI-generated nodes
- [x] 5.1.2 ✅ Review task types: anchor, merge, reject
- [x] 5.1.3 ✅ Review resolution endpoint (POST /review_tasks/:id/resolve)
- [x] 5.1.4 ✅ Correction examples creation on review approval

### 5.2 Review UI (kg-engine)

- [x] 5.2.1 ✅ Review page in kg-engine
- [x] 5.2.2 ✅ Review queue filtering and display
- [x] 5.2.3 ✅ Approve/merge/reject actions

### 5.3 Prompt Templates

- [ ] 5.3.1 ⚠️ prompt_templates table (schema exists)
- [ ] 5.3.2 ⚠️ Per-project overridable LLM prompts (L1, L2, L3)
- [ ] 5.3.3 ❌ Default fallback templates not seeded in migrations (D-07)

---

## Milestone 6: API & Protocol Layer

### 6.1 REST API (API-First via OpenAPI)

- [x] 6.1.1 ✅ openapi.yaml as single source of truth
- [x] 6.1.2 ✅ Orval codegen → Zod validators + React Query hooks
- [x] 6.1.3 ✅ All 21 route modules implemented
- [x] 6.1.4 ✅ Zod validation on all request payloads

### 6.2 MCP (Model Context Protocol)

- [x] 6.2.1 ✅ POST /mcp/query endpoint
- [x] 6.2.2 ✅ MCP tool discovery
- [x] 6.2.3 ✅ Bearer token auth for MCP

### 6.3 GitHub Integration

- [x] 6.3.1 ✅ GitHub webhook listener (POST /github/webhooks)
- [x] 6.3.2 ✅ HMAC-SHA256 signature validation
- [x] 6.3.3 ✅ GitHub PR analysis (fetch commits, diff, post comment)
- [x] 6.3.4 ✅ pull_requests table for analysis records

### 6.4 Slack / Teams Notifications

- [x] 6.4.1 ✅ Slack webhook notification dispatcher
- [x] 6.4.2 ✅ Teams webhook notification dispatcher
- [x] 6.4.3 ✅ project_integrations table for per-project config

### 6.5 Export

- [x] 6.5.1 ✅ JSON export endpoint
- [ ] 6.5.2 ⚠️ Markdown export (may be missing — D-06)

---

## Milestone 7: Frontend (kg-engine)

### 7.1 Dashboard

- [x] 7.1.1 ✅ Dashboard page with project statistics
- [x] 7.1.2 ✅ Pipeline status display
- [x] 7.1.3 ✅ Review queue health indicator

### 7.2 Pipeline Page

- [x] 7.2.1 ✅ Ingest trigger UI
- [x] 7.2.2 ✅ Generate trigger UI
- [x] 7.2.3 ✅ Pipeline result display

### 7.3 Query Page

- [x] 7.3.1 ✅ Natural language query interface
- [x] 7.3.2 ✅ Query result display with strategy indicator

### 7.4 Settings & Project Management

- [x] 7.4.1 ✅ Project CRUD
- [x] 7.4.2 ✅ LLM config management
- [x] 7.4.3 ✅ Integration management

---

## Milestone 8: VS Code Extension UI

### 8.1 Knowledge Graph TreeView

- [x] 8.1.1 ✅ TreeView with L1/L2/L3 hierarchy
- [x] 8.1.2 ✅ Virtual nodes (unassigned group)
- [x] 8.1.3 ✅ Refresh and update events

### 8.2 CodeLens & Hover Providers

- [x] 8.2.1 ✅ CodeLens: L3 decision count above functions/classes
- [x] 8.2.2 ✅ Hover: L3 decision preview on symbol hover
- [ ] 8.2.3 ⚠️ Line-number anchoring drift issue (D-05)

### 8.3 Copilot Chat Participant (@docuvia)

- [x] 8.3.1 ✅ /explore command
- [x] 8.3.2 ✅ /query command
- [x] 8.3.3 ✅ /extract command
- [x] 8.3.4 ✅ /help command

### 8.4 Command Palette

- [x] 8.4.1 ✅ docuvia.startExplore
- [x] 8.4.2 ✅ docuvia.initProject
- [x] 8.4.3 ✅ docuvia.addDecision
- [x] 8.4.4 ✅ docuvia.runExtraction
- [x] 8.4.5 ✅ docuvia.openSearch / searchFromSelection
- [x] 8.4.6 ✅ docuvia.autoCategorizeDecisions

### 8.5 Webview Panels

- [x] 8.5.1 ✅ DashboardPanel (embedded dashboard)
- [x] 8.5.2 ✅ SearchResultsPanel (MCP/RAG results)

---

## Milestone 9: Cross-Cutting Concerns

### 9.1 Security

- [x] 9.1.1 ✅ HMAC-SHA256 for GitHub webhooks
- [x] 9.1.2 ✅ API key via VS Code SecretStorage
- [x] 9.1.3 ✅ Zod validation on all API payloads
- [ ] 9.1.4 ⚠️ Bearer token auth for MCP (verify implementation)
- [ ] 9.1.5 ⚠️ CORS configuration review
- [ ] 9.1.6 ⚠️ Input sanitization on document upload

### 9.2 Observability

- [x] 9.2.1 ✅ Structured logging (pino)
- [x] 9.2.2 ✅ Activity log table (audit trail)
- [ ] 9.2.3 ⚠️ Log level configuration per environment
- [ ] 9.2.4 ⚠️ Error reporting / alerting mechanism

### 9.3 Coding Standards & Architecture

- [x] 9.3.1 ✅ Defensive design (early return / guard clauses)
- [x] 9.3.2 ✅ MVC pattern for UI layers
- [x] 9.3.3 ✅ POP (Protocol-Oriented Programming) for services
- [x] 9.3.4 ✅ OOP for UI structures (VS Code providers)
- [x] 9.3.5 ✅ Code style rules (line length, function length, indentation)

### 9.4 Testing

- [x] 9.4.1 ✅ Unit tests: RAG math (decay & cosine)
- [x] 9.4.2 ✅ Integration tests: DB transactions with withRollback()
- [ ] 9.4.3 ⚠️ E2E: VS Code extension onboarding (Playwright — not done)
- [ ] 9.4.4 ⚠️ E2E: LLM pipeline full flow (mock fixture needed)
- [ ] 9.4.5 ⚠️ UI component snapshot tests (not done)
- [ ] 9.4.6 ⚠️ GitHub webhook E2E with real PR diff

---

## Milestone 10: Deployment & Operations

### 10.1 CI/CD

- [x] 10.1.1 ✅ GitHub Actions: lint job
- [x] 10.1.2 ✅ GitHub Actions: typecheck-and-build job
- [ ] 10.1.3 ⚠️ CI runs Node 22, production targets Node 24 (documented discrepancy)
- [x] 10.1.4 ✅ No .vsix packaging step in CI (D-02)

### 10.2 Deployment

- [x] 10.2.1 ✅ Single-host deployment topology documented
- [ ] 10.2.2 ⚠️ Environment variables documented
- [x] 10.2.3 ✅ No Docker image provided in v1
- [x] 10.2.4 ✅ Static frontend serving not wired for production (D-03)
- [ ] 10.2.5 ⚠️ Database migrations: push vs migrate strategy

### 10.3 VS Code Extension Distribution

- [x] 10.3.1 ✅ No .vsix build script (D-02)
- [ ] 10.3.2 ⚠️ Extension activation events configured

---

## Verification Tracking

|     |        | Item ID    | Last Verified        | Report File   | Status  |
| --- | ------ | ---------- | -------------------- | ------------- | ------- |
|     | 3.2.1  | 2026-06-10 | 0039_3.2.1.md        | ✅ PASS       |
|     | 1.1.2  | 2026-06-08 | 0002_1.1.2.md        | ✅ PASS       |
|     | 1.1.3  | 2026-06-08 | 0003_1.1.3.md        | ✅ PASS       |
|     | 1.1.4  | 2026-06-08 | 0004_1.1.4.md        | ⚠️ WARN       |
|     | 1.2.1  | 2026-06-08 | 0005_1.2.1.md        | ⚠️ WARN       |
|     | 1.2.2  | 2026-06-08 | 0006_1.2.2.md        | ⚠️ WARN       |
|     | 1.2.3  | 2026-06-08 | 0007_1.2.3.md        | ⚠️ WARN       |
|     | 1.2.4  | 2026-06-08 | 0008_1.2.4.md        | ⚠️ WARN       |
|     | 1.2.5  | 2026-06-08 | 0009_1.2.5.md        | ⚠️ WARN       |
|     | 1.2.6  | 2026-06-08 | 0010_1.2.6.md        | ⚠️ WARN       |
|     | 1.3.1  | 2026-06-08 | 0023_1.3.1.md        | ⚠️ WARN       |
|     | 1.3.2  | 2026-06-08 | 0014_1.3.2.md        | ⚠️ WARN       |
|     | 1.3.3  | 2026-06-08 | 0015_1.3.3.md        | ⚠️ WARN       |
|     | 1.3.4  | 2026-06-08 | 0016_1.3.4.md        | ⚠️ WARN       |
|     | 1.3.5  | 2026-06-08 | 0017_1.3.5.md        | ⚠️ WARN       |
|     | 1.3.6  | 2026-06-08 | 0019_1.3.6.md        | ⚠️ WARN       |
|     | 1.4.1  | 2026-06-08 | 0020_1.4.1.md        | ⚠️ WARN       |
|     | 1.4.2  | 2026-06-12 | 0077_1.4.2.md        | ✅ PASS       |
|     | 2.1.1  | 2026-06-08 | 0022_2.1.1.md        | ✅ PASS       |
|     | 2.1.2  | 2026-06-10 | 0024_2.1.2.md        | ✅ PASS       |
|     | 2.2.1  | 2026-06-10 | 0046_2.2.1.md        | ⚠️ WARN       |
|     | 2.2.2  | 2026-06-10 | 0047_2.2.2.md        | ⚠️ WARN       |
|     | 2.2.3  | 2026-06-10 | 0048_2.2.3.md        | ⚠️ WARN       |
|     | 2.3.1  | 2026-06-10 | 0036_2.3.1.md        | ✅ PASS       |
|     | 2.3.2  | 2026-06-10 | 0029_2.3.2.md        | ✅ PASS       |
|     | 2.4.1  | 2026-06-10 | 0031_2.4.1.md        | ✅ PASS       |
|     | 2.4.2  | 2026-06-10 | 0032_2.4.2.md        | ✅ PASS       |
|     | 2.5.1  | 2026-06-10 | 0033_2.5.1.md        | ✅ PASS       |
|     | 2.5.2  | 2026-06-10 | 0034_2.5.2.md        | ✅ PASS       |
|     | 3.1.1  | 2026-06-10 | 0037_3.1.1.md        | ✅ PASS       |
|     | 3.1.2  | 2026-06-10 | 0038_3.1.2.md        | ✅ PASS       |
|     | 3.2.2  | 2026-06-10 | 0050_3.2.2.md        | ⚠️ WARN       |
|     | 3.3.1  | 2026-06-09 | 0041_3.3.1.md        | ⚠️ WARN       |
|     | 3.4.1  | 2026-06-09 | 0042_3.4.1.md        | ⚠️ WARN       |
|     | 3.4.2  | 2026-06-09 | 0043_3.4.2.md        | ⚠️ WARN       |
|     | 3.4.3  | 2026-06-09 | 0044_3.4.3.md        | ⚠️ WARN       |
|     | 3.4.4  | 2026-06-12 | 0078_3.4.4.md        | ✅ PASS       |
|     | 3.5.1  | 2026-06-12 | 0079_3.5.1.md        | ✅ PASS       |
|     | 3.5.2  | 2026-06-12 | 0080_3.5.2.md        | ✅ PASS       |
|     | 4.1.1  | 2026-06-10 | 0052_4.1.1.md        | ✅ PASS       |
|     | 4.1.2  | 2026-06-10 | 0054_4.1.2.md        | ✅ PASS       |
|     | 4.1.3  | 2026-06-11 | manually_verified.md | ✅ PASS       |
|     | 4.1.4  | 2026-06-11 | manually_verified.md | ✅ PASS       |
|     | 4.1.5  | 2026-06-10 | 0057_4.1.5.md        | ✅ PASS       |
|     | 4.2.1  | 2026-06-10 | 0058_4.2.1.md        | ⚠️ WARN       |
|     | 4.2.2  | 2026-06-10 | 0059_4.2.2.md        | ⚠️ WARN       |
|     | 4.2.3  | 2026-06-12 | 0081_4.2.3.md        | ✅ PASS       |
|     | 4.2.4  | 2026-06-12 | 0082_4.2.4.md        | ✅ PASS       |
|     | 4.2.5  | 2026-06-12 | 0083_4.2.5.md        | ✅ PASS       |
|     |        | 4.2.6      | 2026-06-11           | 0064_4.2.6.md | ⚠️ WARN |
|     |        | 4.3.1      | 2026-06-11           | 0065_4.3.1.md | ✅ PASS |
|     |        | 4.3.2      | 2026-06-12           | 0084_4.3.2.md | ✅ PASS |
|     |        | 4.3.3      | 2026-06-11           | 0067_4.3.3.md | ⚠️ WARN |
|     | 4.3.4  | 2026-06-11 | 0068_4.3.4.md        | ⚠️ WARN       |
|     | 4.3.5  | 2026-06-11 | 0069_4.3.5.md        | ⚠️ WARN       |
|     | 4.3.6  | 2026-06-12 | 0094_4.3.6.md        | ✅ PASS       |
|     | 4.3.7  | 2026-06-12 | 0093_4.3.7.md        | ✅ PASS       |
|     | 4.3.8  | 2026-06-12 | 0085_4.3.8.md        | ✅ PASS       |
|     | 4.4.1  | 2026-06-11 | 0071_4.4.1.md        | ✅ PASS       |
|     | 4.4.2  | 2026-06-11 | 0072_4.4.2.md        | ✅ PASS       |
|     | 4.4.3  | 2026-06-11 | 0073_4.4.3.md        | ✅ PASS       |
|     | 4.4.4  | 2026-06-11 | 0074_4.4.4.md        | ✅ PASS       |
|     | 4.4.5  | 2026-06-11 | 0075_4.4.5.md        | ✅ PASS       |
|     | 4.4.6  | 2026-06-11 | 0076_4.4.6.md        | ✅ PASS       |
|     | 5.1.1  | 2026-06-12 | 0095_5.1.1.md        | ✅ PASS       |
|     | 5.1.2  | 2026-06-12 | 0096_5.1.2.md        | ✅ PASS       |
|     | 5.1.3  | —          | —                    | 🔵 Pending    |
|     | 5.1.4  | —          | —                    | 🔵 Pending    |
|     | 5.2.1  | —          | —                    | 🔵 Pending    |
|     | 5.2.2  | —          | —                    | 🔵 Pending    |
|     | 5.2.3  | —          | —                    | 🔵 Pending    |
|     | 5.3.1  | —          | —                    | 🔵 Pending    |
|     | 5.3.2  | —          | —                    | 🔵 Pending    |
|     | 5.3.3  | —          | —                    | 🔵 Pending    |
|     | 6.1.1  | —          | —                    | 🔵 Pending    |
|     | 6.1.2  | —          | —                    | 🔵 Pending    |
|     | 6.1.3  | —          | —                    | 🔵 Pending    |
|     | 6.1.4  | —          | —                    | 🔵 Pending    |
|     | 6.2.1  | —          | —                    | 🔵 Pending    |
|     | 6.2.2  | —          | —                    | 🔵 Pending    |
|     | 6.2.3  | —          | —                    | 🔵 Pending    |
|     | 6.3.1  | —          | —                    | 🔵 Pending    |
|     | 6.3.2  | —          | —                    | 🔵 Pending    |
|     | 6.3.3  | —          | —                    | 🔵 Pending    |
|     | 6.3.4  | —          | —                    | 🔵 Pending    |
|     | 6.4.1  | —          | —                    | 🔵 Pending    |
|     | 6.4.2  | —          | —                    | 🔵 Pending    |
|     | 6.4.3  | —          | —                    | 🔵 Pending    |
|     | 6.5.1  | —          | —                    | 🔵 Pending    |
|     | 6.5.2  | —          | —                    | 🔵 Pending    |
|     | 7.1.1  | —          | —                    | 🔵 Pending    |
|     | 7.1.2  | —          | —                    | 🔵 Pending    |
|     | 7.1.3  | —          | —                    | 🔵 Pending    |
|     | 7.2.1  | —          | —                    | 🔵 Pending    |
|     | 7.2.2  | —          | —                    | 🔵 Pending    |
|     | 7.2.3  | —          | —                    | 🔵 Pending    |
|     | 7.3.1  | —          | —                    | 🔵 Pending    |
|     | 7.3.2  | —          | —                    | 🔵 Pending    |
|     | 7.4.1  | —          | —                    | 🔵 Pending    |
|     | 7.4.2  | —          | —                    | 🔵 Pending    |
|     | 7.4.3  | —          | —                    | 🔵 Pending    |
|     | 8.1.1  | —          | —                    | 🔵 Pending    |
|     | 8.1.2  | —          | —                    | 🔵 Pending    |
|     | 8.1.3  | —          | —                    | 🔵 Pending    |
|     | 8.2.1  | —          | —                    | 🔵 Pending    |
|     | 8.2.2  | —          | —                    | 🔵 Pending    |
|     | 8.2.3  | —          | —                    | 🔵 Pending    |
|     | 8.3.1  | —          | —                    | 🔵 Pending    |
|     | 8.3.2  | —          | —                    | 🔵 Pending    |
|     | 8.3.3  | —          | —                    | 🔵 Pending    |
|     | 8.3.4  | —          | —                    | 🔵 Pending    |
|     | 8.4.1  | —          | —                    | 🔵 Pending    |
|     | 8.4.2  | —          | —                    | 🔵 Pending    |
|     | 8.4.3  | —          | —                    | 🔵 Pending    |
|     | 8.4.4  | —          | —                    | 🔵 Pending    |
|     | 8.4.5  | —          | —                    | 🔵 Pending    |
|     | 8.4.6  | —          | —                    | 🔵 Pending    |
|     | 8.5.1  | —          | —                    | 🔵 Pending    |
|     | 8.5.2  | —          | —                    | 🔵 Pending    |
|     | 9.1.1  | —          | —                    | 🔵 Pending    |
|     | 9.1.2  | —          | —                    | 🔵 Pending    |
|     | 9.1.3  | —          | —                    | 🔵 Pending    |
|     | 9.1.4  | —          | —                    | 🔵 Pending    |
|     | 9.1.5  | —          | —                    | 🔵 Pending    |
|     | 9.1.6  | —          | —                    | 🔵 Pending    |
|     | 9.2.1  | —          | —                    | 🔵 Pending    |
|     | 9.2.2  | —          | —                    | 🔵 Pending    |
|     | 9.2.3  | —          | —                    | 🔵 Pending    |
|     | 9.2.4  | —          | —                    | 🔵 Pending    |
|     | 9.3.1  | —          | —                    | 🔵 Pending    |
|     | 9.3.2  | —          | —                    | 🔵 Pending    |
|     | 9.3.3  | —          | —                    | 🔵 Pending    |
|     | 9.3.4  | —          | —                    | 🔵 Pending    |
|     | 9.3.5  | —          | —                    | 🔵 Pending    |
|     | 9.4.1  | —          | —                    | 🔵 Pending    |
|     | 9.4.2  | —          | —                    | 🔵 Pending    |
|     | 9.4.3  | 2026-06-12 | 0086_9.4.3.md        | ✅ PASS       |
|     | 9.4.4  | 2026-06-12 | 0087_9.4.4.md        | ✅ PASS       |
|     | 9.4.5  | —          | —                    | 🔵 Pending    |
|     | 9.4.6  | —          | —                    | 🔵 Pending    |
|     | 10.1.1 | —          | —                    | 🔵 Pending    |
|     | 10.1.2 | —          | —                    | 🔵 Pending    |
|     | 10.1.3 | —          | —                    | 🔵 Pending    |
|     | 10.1.4 | 2026-06-12 | 0091_10.1.4.md       | ✅ PASS       |
|     | 10.2.1 | —          | —                    | 🔵 Pending    |
|     | 10.2.2 | —          | —                    | 🔵 Pending    |
|     | 10.2.3 | 2026-06-12 | 0088_10.2.3.md       | ✅ PASS       |
|     | 10.2.4 | 2026-06-12 | 0089_10.2.4.md       | ✅ PASS       |
|     | 10.2.5 | 2026-06-12 | 0090_10.2.5.md       | ✅ PASS       |
|     | 10.3.1 | 2026-06-12 | 0092_10.3.1.md       | ✅ PASS       |
|     | 10.3.2 | —          | —                    | 🔵 Pending    |

---

## Summary

| Category                                               | Total   | Done    | WIP    | Todo  | Pending Verification |
| ------------------------------------------------------ | ------- | ------- | ------ | ----- | -------------------- |
| Milestone 1: Knowledge Graph Foundation & API Server   | 19      | 4       | 14     | 0     | 0                    |
| Milestone 2: VS Code Client (Local-First Architecture) | 12      | 8       | 3      | 0     | 0                    |
| Milestone 3: Swarm Intelligence & Git-Isomorphic Sync  | 12      | 8       | 0      | 3     | 0                    |
| Milestone 4: Knowledge Graph Features (ADRs 009–012)   | 26      | 12      | 13     | 0     | 0                    |
| Milestone 5: Human-in-the-Loop & Review System         | 11      | 7       | 2      | 1     | 8                    |
| Milestone 6: API & Protocol Layer                      | 17      | 15      | 1      | 0     | 16                   |
| Milestone 7: Frontend (kg-engine)                      | 12      | 11      | 0      | 0     | 11                   |
| Milestone 8: VS Code Extension UI                      | 19      | 17      | 1      | 0     | 18                   |
| Milestone 9: Cross-Cutting Concerns                    | 22      | 12      | 9      | 0     | 19                   |
| Milestone 10: Deployment & Operations                  | 12      | 7       | 4      | 0     | 6                    |
| **TOTAL**                                              | **162** | **101** | **47** | **4** | **78**               |

---

## Addendum: Audit-Driven CLI Command-Parity Improvements

Not part of the original 10-milestone/162-item ADR-scoped plan above — tracked separately so it doesn't distort that scope's counts. Emerged from [`docuvia-cli-vs-gitnexus-2026-07-10.md`](../analysis/docuvia-cli-vs-gitnexus-2026-07-10.md) and [`gitnexus-vs-docuvia-full-command-matrix-2026-07-11.md`](../analysis/gitnexus-vs-docuvia-full-command-matrix-2026-07-11.md).

- [x] A.1 ✅ `docuvia impact <target>` CLI command — expose the already-built, already-tested `QueryService.getImpact()` (used internally by `docuvia review` and the `docuvia_impact` MCP tool) as a standalone by-symbol command. Spec: [`cli.md`](../gitbook/packages/cli.md#command-reference). No new ADR — follows the existing thin-CLI-wrapper-over-`@workspace/core`-service pattern already decided in [ADR-021](../gitbook/adr/ADR-021-shared-core-api-and-presentation-layers.md).

| Item ID | Last Verified | Report File                        | Status  |
| ------- | ------------- | ---------------------------------- | ------- |
| A.1     | 2026-07-11    | [0097_A.1.md](reports/0097_A.1.md) | ✅ PASS |
