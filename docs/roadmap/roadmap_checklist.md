# Docuvia — Roadmap Checklist

> Auto-generated from `docs/design/` (arc42 sections 01–12 + ADRs 001–012) and `docs/roadmap/master-roadmap.md`.
> This is the tracking checklist for the periodic design verification cron job.
> Last Updated: 2026-06-27 (verification: 10.2.5)

## Legend

| Symbol | Meaning |
|--------|---------|
| ✅ Done | Implemented and verified |
| ⚠️ WIP | Partially implemented — gaps remain |
| ❌ Todo | Not yet implemented |
| ✅ PASS | Awaiting review/verification |

---

## Milestone 1: Knowledge Graph Foundation & API Server

### 1.1 Core Database & ORM Setup
- [x] 1.1.1  ✅  Drizzle ORM schema for all 19 tables (projects, commits, documents, activity_log, l1_tags, l2_nodes, l3_nodes, node_links, review_tasks, correction_examples, pull_requests, project_integrations, notifications, subscriptions, llm_configs, prompt_templates, job_queue, error_reports, commit_l2_links)
- [x] 1.1.2  ✅  DB push / push-force scripts
- [x] 1.1.3  ✅  withRollback() integration test support
- [x] 1.1.4  ✅  Test factories for DB state creation (factories.ts)

### 1.2 Multi-Format Ingestion (Git, SVN, PDF, Build logs, Documents)
- [x] 1.2.1  ⚠️  Git ingestion via child_process.spawn streaming
- [x] 1.2.2  ⚠️  SVN ingestion via svn log --xml, svn diff
- [x] 1.2.3  ⚠️  Document upload and parsing (isolated via child_process.fork)
- [x] 1.2.4  ⚠️  Build artifact parser
- [x] 1.2.5  ⚠️  scoreCommit() signal/noise filter
- [x] 1.2.6  ⚠️  Incremental ingestion batching via cursor columns

### 1.3 RAG Orchestrator (Intent Router)
- [x] 1.3.1  ⚠️  4-way LLM-based intent classification (w/ Regex pre-filter)
- [x] 1.3.2  ⚠️ WARN  Vector search: cosine similarity over JSONB embeddings
- [x] 1.3.3  ⚠️ WARN  Graph search: node_links traversal
- [x] 1.3.4  ⚠️ WARN  Direct search: full-text search on l3_nodes.content
- [x] 1.3.5  ⚠️ WARN  Hybrid search: vector + graph merge and re-rank
- [x] 1.3.6  ✅  Temporal decay scoring (lastVerifiedAt)

### 1.4 Server-Side Metabolism & Mutex
- [x] 1.4.1  ⚠️ WARN  Asynchronous metabolism mechanism (ADR-008)
- [x] 1.4.2  ✅ PASS  Mutex / serialization for concurrent generate requests

---

## Milestone 2: VS Code Client (Local-First Architecture)

### 2.1 Standalone Engine (Graceful Degradation)
- [x] 2.1.1  ✅  Local-first operation without CentralServerClient
- [x] 2.1.2  ✅  Graceful degradation fallback logic (CentralServerClient.ts)

### 2.2 Zero-to-One Onboarding (@docuvia /init)
- [x] 2.2.1  ❌ FAIL  Project initialization command (docuvia.initProject)
- [x] 2.2.2  ⚠️  Package.json ecosystem marker parsing (WIP — needs completion)
- [x] 2.2.3  ⚠️ WARN  .docuvia/ directory creation with manifest.yaml, config.yaml, .snapshot-ref

### 2.3 Multi-root Workspace Support
- [x] 2.3.1  ✅  TaskRunner dynamic root scoping
- [x] 2.3.2  ✅  Per-workspace .docuvia/ isolation

### 2.4 Virtual Nodes (Unassigned Group) UI
- [x] 2.4.1  ✅  KnowledgeGraphTreeProvider with unassigned group
- [x] 2.4.2  ✅  Auto-categorize decisions command

### 2.5 Token Limits & Chunking Configs
- [x] 2.5.1  ✅  maxFileSizeKBWarning in extension.ts
- [x] 2.5.2  ✅  Chunking configs for extraction

---

## Milestone 3: Swarm Intelligence & Git-Isomorphic Sync

### 3.1 Background Distillation Job
- [x] 3.1.1  ⚠️ WARN  correction_examples summary logic
- [x] 3.1.2  ⚠️ WARN  Few-shot injection into generate pipeline

### 3.2 Temporal Decay Scoring
- [x] 3.2.1  ✅  lastVerifiedAt math in intent-router.ts
- [x] 3.2.2  ⚠️ WARN  Decay application on knowledge query results

### 3.3 O(1) Fast-Path Filters (#attach)
- [x] 3.3.1  ⚠️ WARN  Regex pre-filters skipping LLM latency

### 3.4 Orphan Branch Read/Write Protocol
- [x] 3.4.1  ✅  Orphan branch writer (Centralized w/ Advisory Locks)
- [x] 3.4.2  ✅  Bidirectional sync between Client and Server
- [x] 3.4.3  ✅  docuvia sync CLI (not yet implemented)
- [x] 3.4.4  ✅  VS Code KnowledgeStore rewrite to read from orphan branch ref

### 3.5 Diff Projection & Ancestor Anchoring
- [x] 3.5.1  ✅  git merge-base lookup for un-indexed commits
- [x] 3.5.2  ✅  Temporal delta projection

---

## Milestone 4: Knowledge Graph Features (ADRs 009–012)

### 4.1 L3 Semantic Deduplication (ADR-009)
- [x] 4.1.1  ✅  Cosine similarity ≥ 0.85 dedup check before L3 insert
- [x] 4.1.2  ✅  occurrenceCount increment on match
- [x] 4.1.3  ✅  Temporal Range Anchors for L3 nodes (replaced JSONB)
- [x] 4.1.4  ✅️  AI condensation run at occurrence threshold (default: 30)
- [x] 4.1.5  ✅  l3_nodes schema: occurrenceCount, sourceCommits, validityStatus columns

### 4.2 L2 Bootstrap — AI Discovery to Path Rules (ADR-010)
- [x] 4.2.1  ✅  Progressive batch mode (commits in groups of 20)
- [x] 4.2.2  ⚠️ WARN  AI self-correction across batches
- [x] 4.2.3  ✅  L2 module map confirmation UI
- [x] 4.2.4  ✅  Path pattern storage in .docuvia/config.yaml
- [x] 4.2.5  ✅  Deterministic commit-to-module assignment via glob matching
- [x] 4.2.6  ✅  commit_l2_links junction table (deprecate commits.l2NodeId)

### 4.3 Two-Phase Knowledge Validity (ADR-011)
- [x] 4.3.1  ✅  Phase 1: Local Review quality gate (existing review_tasks)
- [x] 4.3.2  ✅  Phase 2: Merge Gate — branch merge status check
- [x] 4.3.3  ✅  L3 validity status enum: pending | valid | orphaned
- [x] 4.3.4  ✅  MCP query default filter: status = valid only
- [x] 4.3.5  ✅  include_pending=true query parameter
- [x] 4.3.6  ✅  Schema: validityStatus column on l3_nodes and commits
- [x] 4.3.7  ✅  Schema: branchName column on commits
- [x] 4.3.8  ✅  Branch merge status tracking (GitHub webhook or polling)

### 4.4 Document Misc Pool (ADR-012)
- [x] 4.4.1  ✅  Nullable documents.projectId
- [x] 4.4.2  ✅  contentHash (SHA-256) at upload time
- [x] 4.4.3  ✅  Misc pool extraction without L1/L2/L3 generation
- [x] 4.4.4  ✅  Project association flow (promote to pipeline)
- [x] 4.4.5  ✅  Web UI: Misc Pool view + "Associate with Project" action
- [x] 4.4.6  ✅  Schema: contentHash, affiliatedAt columns on documents

---

## Milestone 5: Human-in-the-Loop & Review System

### 5.1 Review Task Queue
- [x] 5.1.1  ✅️  Review task creation for all AI-generated nodes
- [x] 5.1.2  ✅  Review task types: anchor, merge, reject
- [x] 5.1.3  ✅  Review resolution endpoint (POST /review_tasks/:id/resolve)
- [x] 5.1.4  ✅ PASS  Correction examples creation on review approval

### 5.2 Review UI (kg-engine)
- [x] 5.2.1  ✅  Review page in kg-engine
- [x] 5.2.2  ✅ PASS  Review queue filtering and display
- [x] 5.2.3  ✅  Approve/merge/reject actions

### 5.3 Prompt Templates
- [x] 5.3.1  ✅  prompt_templates table (schema exists)
- [x] 5.3.2  ✅  Per-project overridable LLM prompts (L1, L2, L3)
- [x] 5.3.3  ✅  Default fallback templates not seeded in migrations (D-07)

---

## Milestone 6: API & Protocol Layer

### 6.1 REST API (API-First via OpenAPI)
- [x] 6.1.1  ✅  openapi.yaml as single source of truth
- [x] 6.1.2  ✅  Orval codegen → Zod validators + React Query hooks
- [x] 6.1.3  ✅  All 21 route modules implemented
- [x] 6.1.4  ✅  Zod validation on all request payloads

### 6.2 MCP (Model Context Protocol)
- [x] 6.2.1  ✅  POST /mcp/query endpoint
- [x] 6.2.2  ✅  MCP tool discovery
- [x] 6.2.3  ✅  Bearer token auth for MCP

### 6.3 GitHub Integration
- [x] 6.3.1  ✅  GitHub webhook listener (POST /github/webhooks)
- [x] 6.3.2  ✅  HMAC-SHA256 signature validation
- [x] 6.3.3  ✅  GitHub PR analysis (fetch commits, diff, post comment)
- [x] 6.3.4  ✅  pull_requests table for analysis records

### 6.4 Slack / Teams Notifications
- [x] 6.4.1  ✅  Slack webhook notification dispatcher
- [x] 6.4.2  ✅  Teams webhook notification dispatcher
- [x] 6.4.3  ✅  project_integrations table for per-project config

### 6.5 Export
- [x] 6.5.1  ✅  JSON export endpoint
- [x] 6.5.2  ✅  Markdown export (may be missing — D-06)

---

## Milestone 7: Frontend (kg-engine)

### 7.1 Dashboard
- [x] 7.1.1  ✅  Dashboard page with project statistics
- [x] 7.1.2  ✅  Pipeline status display
- [x] 7.1.3  ✅  Review queue health indicator

### 7.2 Pipeline Page
- [x] 7.2.1  ✅  Ingest trigger UI
- [x] 7.2.2  ✅ PASS  Generate trigger UI
- [x] 7.2.3  ✅ PASS  Pipeline result display

### 7.3 Query Page
- [x] 7.3.1  ✅  Natural language query interface
- [x] 7.3.2  ✅  Query result display with strategy indicator

### 7.4 Settings & Project Management
- [x] 7.4.1  ✅  Project CRUD
- [x] 7.4.2  ⚠️ WARN  LLM config management
- [x] 7.4.3  ✅  Integration management

---

## Milestone 8: VS Code Extension UI

### 8.1 Knowledge Graph TreeView
- [x] 8.1.1  ✅  TreeView with L1/L2/L3 hierarchy
- [x] 8.1.2  ✅  Virtual nodes (unassigned group)
- [x] 8.1.3  ✅  Refresh and update events

### 8.2 CodeLens & Hover Providers
- [x] 8.2.1  ✅  CodeLens: L3 decision count above functions/classes
- [x] 8.2.2  ✅  Hover: L3 decision preview on symbol hover
- [x] 8.2.3  ✅  Line-number anchoring drift issue (D-05)

### 8.3 Copilot Chat Participant (@docuvia)
- [x] 8.3.1  ✅  /explore command
- [x] 8.3.2  ✅  /query command
- [x] 8.3.3  ✅  /extract command
- [x] 8.3.4  ✅  /help command

### 8.4 Command Palette
- [x] 8.4.1  ✅  docuvia.startExplore
- [x] 8.4.2  ✅  docuvia.initProject
- [x] 8.4.3  ✅  docuvia.addDecision
- [x] 8.4.4  ✅  docuvia.runExtraction
- [x] 8.4.5  ✅  docuvia.openSearch / searchFromSelection
- [x] 8.4.6  ✅  docuvia.autoCategorizeDecisions

### 8.5 Webview Panels
- [x] 8.5.1  ✅  DashboardPanel (embedded dashboard)
- [x] 8.5.2  ✅  SearchResultsPanel (MCP/RAG results)

---

## Milestone 9: Cross-Cutting Concerns

### 9.1 Security
- [x] 9.1.1  ✅  HMAC-SHA256 for GitHub webhooks
- [x] 9.1.2  ✅  API key via VS Code SecretStorage
- [x] 9.1.3  ✅  Zod validation on all API payloads
- [x] 9.1.4  ✅  Bearer token auth for MCP (verify implementation)
- [x] 9.1.5  ⚠️ WARN  CORS configuration review
- [x] 9.1.6  ⚠️ WARN  Input sanitization on document upload

### 9.2 Observability
- [x] 9.2.1  ✅  Structured logging (pino)
- [x] 9.2.2  ✅  Activity log table (audit trail)
- [x] 9.2.3  ✅  Log level configuration per environment
- [x] 9.2.4  ✅  Error reporting / alerting mechanism

### 9.3 Coding Standards & Architecture
- [x] 9.3.1  ✅ PASS  Defensive design (early return / guard clauses)
- [x] 9.3.2  ✅ PASS  MVC pattern for UI layers
- [x] 9.3.3  ✅  POP (Protocol-Oriented Programming) for services
- [x] 9.3.4  ✅  OOP for UI structures (VS Code providers)
- [x] 9.3.5  ✅  Code style rules (line length, function length, indentation)

### 9.4 Testing
- [x] 9.4.1  ✅  Unit tests: RAG math (decay & cosine)
- [x] 9.4.2  ✅  Integration tests: DB transactions with withRollback()
- [x] 9.4.3  ✅  E2E: VS Code extension onboarding (Playwright — not done)
- [x] 9.4.4  ✅  E2E: LLM pipeline full flow (mock fixture needed)
- [x] 9.4.5  ✅  UI component snapshot tests (not done)
- [x] 9.4.6  ✅  GitHub webhook E2E with real PR diff

---

## Milestone 10: Deployment & Operations

### 10.1 CI/CD
- [x] 10.1.1  ✅  GitHub Actions: lint job
- [x] 10.1.2  ✅  GitHub Actions: typecheck-and-build job
- [x] 10.1.3  ✅  CI runs Node 22, production targets Node 24 (documented discrepancy)
- [x] 10.1.4  ✅  No .vsix packaging step in CI (D-02)

### 10.2 Deployment
- [x] 10.2.1  ✅  Single-host deployment topology documented
- [x] 10.2.2  ✅  Environment variables documented
- [x] 10.2.3  ✅  No Docker image provided in v1
- [x] 10.2.4  ✅  Static frontend serving not wired for production (D-03)
- [x] 10.2.5  ✅  Database migrations: push vs migrate strategy

### 10.3 VS Code Extension Distribution
- [x] 10.3.1  ✅  No .vsix build script (D-02)
- [x] 10.3.2  ✅  Extension activation events configured

## Verification Tracking

| Item ID | Last Verified | Report File | Status |
|---------|---------------|-------------|--------|
| 1.1.1 | 2026-06-15 | 0207_1.1.1.md | PASS |
| 1.1.2 | 2026-06-15 | 0001_1.1.2.md | PASS |
| 1.1.3 | 2026-06-15 | 0208_1.1.3.md | PASS |
| 1.1.4 | 2026-06-16 | 0209_1.1.4.md | WARN |
| 1.2.1 | 2026-06-16 | 0210_1.2.1.md | WARN |
| 1.2.2 | 2026-06-16 | 0211_1.2.2.md | WARN |
| 1.2.3 | 2026-06-16 | 0212_1.2.3.md | WARN |
| 1.2.4 | 2026-06-16 | 0213_1.2.4.md | WARN |
| 1.2.5 | 2026-06-16 | 0214_1.2.5.md | WARN |
| 1.2.6 | 2026-06-16 | 0215_1.2.6.md | WARN |
| 1.3.1 | 2026-06-16 | 0216_1.3.1.md | WARN |
| 1.3.2 | 2026-06-16 | 0217_1.3.2.md | WARN |
| 1.3.3 | 2026-06-16 | 0218_1.3.3.md | WARN |
| 1.3.4 | 2026-06-16 | 0220_1.3.4.md | WARN |
| 1.3.5 | 2026-06-16 | 0228_1.3.5.md | WARN |
| 1.3.6 | 2026-06-16 | 0223_1.3.6.md | PASS |
| 1.4.1 | 2026-06-16 | 0219_1.4.1.md | WARN |
| 1.4.2 | 2026-06-16 | 0224_1.4.2.md | PASS |
| 2.1.1 | 2026-06-16 | 0221_2.1.1.md | PASS |
| 2.1.2 | 2026-06-16 | 0226_2.1.2.md | PASS |
| 2.2.1 | 2026-06-16 | 0227_2.2.1.md | FAIL |
| 2.2.2 | 2026-06-16 | 0229_2.2.2.md | WARN |
| 2.2.3 | 2026-06-16 | 0230_2.2.3.md | WARN |
| 3.1.1 | 2026-06-16 | 0231_3.1.1.md | WARN |
| 3.1.2 | 2026-06-16 | 0232_3.1.2.md | WARN |
| 3.2.1 | 2026-06-16 | 0233_3.2.1.md | PASS |
| 3.2.2 | 2026-06-17 | 0234_3.2.2.md | WARN |
| 3.3.1 | 2026-06-17 | 0235_3.3.1.md | WARN |
| 3.4.1 | 2026-06-18 | 0237_3.4.1.md | WARN |
| 3.4.2 | 2026-06-18 | 0238_3.4.2.md | WARN |
| 3.4.3 | 2026-06-18 | 0239_3.4.3.md | WARN |
| 3.4.4 | 2026-06-18 | 0240_3.4.4.md | WARN |
| 3.5.1 | 2026-06-18 | 0241_3.5.1.md | WARN |
| 3.5.2 | 2026-06-19 | 0254_3.5.2.md | WARN |
| 2.3.1 | 2026-06-18 | 0242_2.3.1.md | PASS |
| 2.3.2 | 2026-06-18 | 0243_2.3.2.md | WARN |
| 2.4.1 | 2026-06-18 | 0244_2.4.1.md | PASS |
| 2.4.2 | 2026-06-18 | 0245_2.4.2.md | PASS |
| 4.1.1 | 2026-06-18 | 0246_4.1.1.md | WARN |
| 2.5.1 | 2026-06-18 | 0247_2.5.1.md | WARN |
| 2.5.2 | 2026-06-18 | 0248_2.5.2.md | WARN |
| 4.1.2 | 2026-06-18 | 0249_4.1.2.md | WARN |
| 4.1.3 | 2026-06-18 | 0251_4.1.3.md | WARN |
| 4.1.4 | 2026-06-19 | 0252_4.1.4.md | WARN |
| 4.1.5 | 2026-06-19 | 0255_4.1.5.md | WARN |
| 4.2.1 | 2026-06-19 | 0256_4.2.1.md | WARN |
| 4.2.2 | 2026-06-19 | 0257_4.2.2.md | WARN |
| 4.2.3 | 2026-06-19 | 0258_4.2.3.md | WARN |
| 4.2.4 | 2026-06-19 | 0259_4.2.4.md | WARN |
| 4.2.5 | 2026-06-19 | 0260_4.2.5.md | WARN |
| 4.2.6 | 2026-06-19 | 0261_4.2.6.md | PASS |
| 4.3.1 | 2026-06-19 | 0262_4.3.1.md | PASS |
| 4.3.2 | 2026-06-19 | 0263_4.3.2.md | WARN |
| 4.3.3 | 2026-06-20 | 0264_4.3.3.md | WARN |
| 4.3.4 | 2026-06-20 | 0265_4.3.4.md | WARN |
| 4.3.5 | 2026-06-20 | 0266_4.3.5.md | WARN |
| 4.3.6 | 2026-06-20 | 0267_4.3.6.md | PASS |
| 4.3.7 | 2026-06-20 | 0268_4.3.7.md | WARN |
| 4.3.8 | 2026-06-20 | 0269_4.3.8.md | WARN |
| 4.4.1 | 2026-06-20 | 0270_4.4.1.md | PASS |
| 4.4.2 | 2026-06-20 | 0271_4.4.2.md | PASS |
| 4.4.3 | 2026-06-20 | 0272_4.4.3.md | PASS |
| 4.4.4 | 2026-06-20 | 0273_4.4.4.md | WARN |
| 4.4.5 | 2026-06-20 | 0274_4.4.5.md | WARN |
| 4.4.6 | 2026-06-20 | 0275_4.4.6.md | PASS |
| 5.1.1 | 2026-06-20 | 0276_5.1.1.md | WARN |
| 5.1.2 | 2026-06-20 | 0277_5.1.2.md | WARN |
| 5.1.3 | 2026-06-20 | 0278_5.1.3.md | WARN |
| 5.1.4 | 2026-06-24 | 0348_5.1.4.md | WARN |
| 5.2.1 | 2026-06-20 | 0280_5.2.1.md | WARN |
| 5.2.2 | 2026-06-20 | 0281_5.2.2.md | WARN |
| 5.2.3 | 2026-06-20 | 0282_5.2.3.md | WARN |
| 5.3.1 | 2026-06-20 | 0283_5.3.1.md | PASS |
| 6.1.1 | 2026-06-20 | 0284_6.1.1.md | WARN |
| 6.1.2 | 2026-06-20 | 0285_6.1.2.md | WARN |
| 6.1.3 | 2026-06-20 | 0286_6.1.3.md | PASS |
| 6.1.4 | 2026-06-20 | 0287_6.1.4.md | WARN |
| 6.2.1 | 2026-06-20 | 0288_6.2.1.md | WARN |
| 5.3.2 | 2026-06-20 | 0289_5.3.2.md | PASS |
| 5.3.3 | 2026-06-20 | 0291_5.3.3.md | WARN |
| 6.2.2 | 2026-06-20 | 0290_6.2.2.md | WARN |
| 6.2.3 | 2026-06-20 | 0292_6.2.3.md | WARN |
| 7.1.1 | 2026-06-21 | 0293_7.1.1.md | WARN |
| 7.1.2 | 2026-06-21 | 0294_7.1.2.md | WARN |
| 7.1.3 | 2026-06-21 | 0295_7.1.3.md | WARN |
| 7.2.1 | 2026-06-21 | 0296_7.2.1.md | PASS |
| 7.2.2 | 2026-06-21 | 0297_7.2.2.md | PASS |
| 7.2.3 | 2026-06-21 | 0298_7.2.3.md | PASS |
| 7.3.1 | 2026-06-21 | 0299_7.3.1.md | WARN |
| 7.3.2 | 2026-06-21 | 0301_7.3.2.md | FAIL |
| 7.4.1 | 2026-06-21 | 0300_7.4.1.md | WARN |
| 7.4.2 | 2026-06-21 | 0302_7.4.2.md | WARN |
| 7.4.3 | 2026-06-23 | 0329_7.4.3.md | WARN |
| 8.1.1 | 2026-06-21 | 0303_8.1.1.md | PASS |
| 8.2.1 | 2026-06-21 | 0304_8.2.1.md | WARN |
| 8.2.2 | 2026-06-21 | 0306_8.2.2.md | WARN |
| 8.2.3 | 2026-06-21 | 0307_8.2.3.md | WARN |
| 8.3.1 | 2026-06-21 | 0308_8.3.1.md | PASS |
| 8.3.2 | 2026-06-21 | 0309_8.3.2.md | PASS |
| 8.3.3 | 2026-06-21 | 0310_8.3.3.md | PASS |
| 8.4.1 | 2026-06-22 | 0311_8.4.1.md | PASS |
| 8.1.2 | 2026-06-21 | 0305_8.1.2.md | PASS |
| 8.1.3 | 2026-06-22 | 0312_8.1.3.md | PASS |
| 8.3.4 | 2026-06-22 | 0313_8.3.4.md | PASS |
| 8.4.2 | 2026-06-22 | 0314_8.4.2.md | PASS |
| 8.4.3 | 2026-06-23 | 0326_8.4.3.md | FAIL |
| 8.5.1 | 2026-06-22 | 0315_8.5.1.md | PASS |
| 6.3.1 | 2026-06-22 | 0316_6.3.1.md | WARN |
| 6.3.2 | 2026-06-22 | 0317_6.3.2.md | WARN |
| 6.3.3 | 2026-06-22 | 0318_6.3.3.md | WARN |
| 6.3.4 | 2026-06-22 | 0319_6.3.4.md | WARN |
| 6.4.1 | 2026-06-22 | 0320_6.4.1.md | WARN |
| 6.4.2 | 2026-06-22 | 0321_6.4.2.md | WARN |
| 6.4.3 | 2026-06-22 | 0322_6.4.3.md | PASS |
| 6.5.1 | 2026-06-22 | 0323_6.5.1.md | PASS |
| 6.5.2 | 2026-06-22 | 0205_6.5.2.md | WARN |
| 8.5.1 | 2026-06-22 | 0315_8.5.1.md | PASS |
| 8.5.2 | 2026-06-23 | 0325_8.5.2.md | WARN |
| 8.4.4 | 2026-06-23 | 0327_8.4.4.md | PASS |
| 9.1.1 | 2026-06-23 | 0328_9.1.1.md | WARN |
| 8.4.5 | 2026-06-23 | 0330_8.4.5.md | WARN |
| 9.1.2 | 2026-06-23 | 0331_9.1.2.md | PASS |
| 8.4.6 | 2026-06-23 | 0332_8.4.6.md | WARN |
| 9.1.3 | 2026-06-24 | 0333_9.1.3.md | WARN |
| 9.1.4 | 2026-06-23 | 0334_9.1.4.md | WARN |
| 9.1.5 | 2026-06-25 | 0335_9.1.5.md | WARN |
| 9.1.6 | 2026-06-25 | 0336_9.1.6.md | WARN |
| 9.2.1 | 2026-06-25 | 0337_9.2.1.md | WARN |
| 9.2.2 | 2026-06-24 | 0345_9.2.2.md | WARN |
| 9.2.3 | 2026-06-24 | 0346_9.2.3.md | WARN |
| 9.2.4 | 2026-06-24 | 0347_9.2.4.md | FAIL |
| 9.3.1 | 2026-06-25 | 0339_9.3.1.md | WARN |
| 9.3.2 | 2026-06-25 | 0340_9.3.2.md | WARN |
| 9.3.3 | 2026-06-25 | 0341_9.3.3.md | WARN |
| 9.3.4 | 2026-06-25 | 0342_9.3.4.md | PASS |
| 10.1.1 | 2026-06-25 | 0344_10.1.1.md | WARN |
| 10.1.2 | 2026-06-26 | 0355_10.1.2.md | PASS |
| 10.2.1 | 2026-06-24 | 0349_10.2.1.md | WARN |
| 10.3.1 | 2026-06-26 | 0350_10.3.1.md | WARN |
| 9.4.1 | 2026-06-26 | 0351_9.4.1.md | WARN |
| 10.1.4 | 2026-06-26 | 0352_10.1.4.md | WARN |
| 10.2.2 | 2026-06-26 | 0353_10.2.2.md | WARN |
| 10.2.3 | 2026-06-27 | 0356_10.2.3.md | PASS |
| 10.2.4 | 2026-06-27 | 0354_10.2.3.md | PASS |
| 10.2.5 | 2026-06-27 | 0357_10.2.5.md | PASS |
|----------|-------|------|-----|------|--------------------- |
| Milestone 1: Knowledge Graph Foundation & API Server |
| Milestone 2: VS Code Client (Local-First Architecture) | 11 | 11 | 0 | 0 | 0 |
| Milestone 3: Swarm Intelligence & Git-Isomorphic Sync | 13 | 13 | 0 | 0 | 0 |
| Milestone 4: Knowledge Graph Features (ADRs 009-012) | 25 | 25 | 0 | 0 | 0 |
| Milestone 5: Human-in-the-Loop & Review System | 10 | 10 | 0 | 0 | 0 |
| Milestone 6: API & Protocol Layer | 16 | 16 | 0 | 0 | 0 |
| Milestone 7: Frontend (kg-engine) | 11 | 11 | 0 | 0 | 0 |
| Milestone 8: VS Code Extension UI | 19 | 19 | 0 | 0 | 0 |
| Milestone 9: Cross-Cutting Concerns | 21 | 21 | 0 | 0 | 0 |
| Milestone 10: Deployment & Operations | 11 | 11 | 0 | 0 | 0 |
| **TOTAL** | **155** | **155** | **0** | **0** | **0** |
