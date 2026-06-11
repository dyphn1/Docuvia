# Docuvia Roadmap Completion: 4-Phase Action Plan

> This document details the step-by-step execution plan to resolve all remaining `❌ FAIL`, `❌ Todo`, and `⚠️ WIP` items from the `roadmap_checklist.md`. It incorporates constraints identified by the Architecture and QA teams.

## Phase 1: Stabilization & Concurrency (The Foundation)
**Goal:** Prevent data corruption and fix the local-first sync architecture.

*   **[BE] Item 1.4.2 (Mutex for Generate):** 
    *   Implement PostgreSQL Advisory Locks (`pg_advisory_xact_lock`) in `generate.ts` to serialize concurrent requests without risking stale in-memory locks.
*   **[FE/SA] Item 3.4.4 (VS Code KnowledgeStore Rewrite):** 
    *   Rewrite `KnowledgeStore.ts` to fetch primarily from the `docuvia-knowledge` orphan branch via `git show`.
    *   Implement cache layer to prevent UI blocking during `Hover` events.
*   **[BE] Item 3.5.1 & 3.5.2 (Merge-base & Temporal Delta):** 
    *   Implement `git merge-base HEAD <base>` lookup to properly inherit knowledge baselines.
    *   Add fallback logic: If no ancestor is found, treat the diff as a fresh slate.

## Phase 2: Core Logic — L2 Bootstrap & Merge Gate
**Goal:** Automate L2 routing and implement the 2-Phase validity gate.

*   **[FE] Item 4.2.3 (L2 Module Confirmation UI):** 
    *   Build the confirmation view in `kg-engine` to allow PMs to review the AI-discovered L2 modules.
*   **[BE] Item 4.2.4 & 4.2.5 (Glob Path Assignment):** 
    *   Store confirmed path patterns in `.docuvia/config.yaml`.
    *   Implement deterministic assignment in the ingestion pipeline. **Critical:** Use "longest path match first" priority for conflicting globs.
*   **[BE] Item 4.3.2 & 4.3.8 (Phase 2: Merge Gate):** 
    *   Extend `github_webhooks.ts` to detect PR merges.
    *   Update associated L3 nodes' `validityStatus` from `pending` to `valid`.

## Phase 3: QA & Automated Testing (Defensive Engineering)
**Goal:** Ensure the system doesn't regress before packaging.

*   **[QA/FE] Item 9.4.3 (VS Code E2E Tests):** 
    *   Use `@vscode/test-electron` to test `docuvia.initProject`. 
    *   **Critical:** Add awaitable events (`isIndexing`) to prevent flaky tests.
*   **[QA/BE] Item 9.4.4 (LLM Pipeline E2E):** 
    *   Create MSW (Mock Service Worker) handlers mimicking OpenAI JSON responses to test `generate.ts` end-to-end without spending API credits.

## Phase 4: Operations & Distribution
**Goal:** Package the product for end-users and self-hosters.

*   **[SA] Item 10.2.3 & 10.2.4 (Docker & Static Serving):** 
    *   Create `Dockerfile` for the API server.
    *   Configure Express to serve `kg-engine/dist` statically with proper `Cache-Control` headers.
*   **[FE] Item 10.1.4 & 10.3.1 (VSIX Packaging):** 
    *   Update GitHub Actions to run `vsce package` and upload the `.vsix` artifact on tagged releases.
