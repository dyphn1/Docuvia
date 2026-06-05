# SaaS & Commercialization Roadmap

This document outlines the architectural enhancements required to transition Docuvia from a local/single-user tool into a production-ready, multi-tenant SaaS product.

## 1. Deployment & Distribution
- **Current State**: Requires Node.js, `pnpm`, and PostgreSQL to run from source.
- **Target State**: 
  - Provide an official `docker-compose.yml` for one-click deployment (API Server, KG-Engine UI, DB).
  - Encapsulate the entire experience within a VS Code Extension for a single-click, unified interface.

## 2. Security & Access Control
- **Target State**: 
  - Implement API token verification for internal/extension communication (`DOCUVIA_API_KEY`).
  - Implement HMAC signature validation for external webhooks (e.g., Slack, GitHub).
  - Implement OAuth (e.g., GitHub, GitLab) for user authentication in the public product.

## 3. Multi-Tenancy & Data Isolation (SaaS Only)
- **Target State**:
  - Introduce `users`, `workspaces` (tenants), and `workspace_users` into the DB schema to support RBAC and federated identity.
  - Implement **Row-Level Security (RLS)** in PostgreSQL to enforce absolute data isolation across workspaces.

## 4. Background Jobs & Queueing
- **Current State**: Ingestion and LLM generation run synchronously on the HTTP request thread, risking timeouts and process crashes.
- **Target State**:
  - Implement a Postgres-backed task queue (e.g., `pg-boss` or `graphile-worker`).
  - HTTP routes should only enqueue jobs and return 202 Accepted.
  - Workers handle API rate limits (HTTP 429) via exponential backoff.

## 5. Observability & Debugging
- **Target State**:
  - Implement an **LLM Tracing & Audit Log**.
  - Create an `llm_traces` table to store system prompts, user messages, token usage, and raw responses.
  - Surface an "AI Trace" view in the UI to help users understand *why* a specific decision or tag was generated.

## 6. Git History Rewrite Handling (Orphaned Knowledge GC)
- **Current State**: Deleting or rewriting git history creates orphaned knowledge nodes.
- **Target State (Soft Delete & Diff-based Sync)**:
  - Add `is_orphaned` or `deleted_at` to the `commitsTable`. Do not cascade delete.
  - Rely on `incremental` mode for speed normally. 
  - Trigger a full "Orphan GC" process either periodically (via Cron sampling), manually via UI ("Force Sync State"), or via `forced: true` GitHub webhook payloads.
  - Flag dependent L3 decisions as `Needs Review` for human-in-the-loop validation.

## 7. Billing & Quota Management
- **Default/Personal Mode**: 
  - **BYOK (Bring Your Own Key)**: Users must provide their own OpenAI/LLM API keys. The financial risk of massive ingestions (e.g., Linux kernel) is entirely on the user.
- **Commercial/SaaS Mode (Private Branch)**:
  - **Platform Billing**: Platform pays for API costs and enforces quotas.
  - Implement static hard limits (`max_commits_per_ingest`, `max_llm_calls_per_month`) on the `workspacesTable`.
  - Implement a **Budget Interceptor** in the Job Worker to pause processing and request plan upgrades when quotas are exhausted.