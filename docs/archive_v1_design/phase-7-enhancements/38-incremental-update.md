# Incremental Update (Cursor-Based)

## Overview

Avoid full re-indexing on every run by tracking ingestion cursors per project and processing only new/unprocessed commits since the last run.

## Implementation

Cursor columns on the `projects` table: `lastGitIngestedAt` (timestamp) and `lastSvnRevision` (integer). `processedAt` column on the `commits` table. `mode: 'full' | 'incremental'` parameter on `POST /projects/:id/ingest/git`, `POST /projects/:id/ingest/svn`, and `POST /projects/:id/generate`. `GET /projects/:id/ingest/status` endpoint. `IngestStatusCard` component in the pipeline UI.

> ⚠️ **Doc was wrong** — the title said "Webhook-Based" and listed `github_webhooks.ts` as the key file. `github_webhooks.ts` handles **GitHub PR events** (not incremental ingestion). The actual incremental update mechanism is cursor-based, not webhook-triggered.

### Key Files

- `lib/db/src/schema/projects.ts` — `lastGitIngestedAt`, `lastSvnRevision` cursor columns
- `lib/db/src/schema/commits.ts` — `processedAt` column
- `artifacts/api-server/src/routes/ingest.ts` — `mode` param handling, `GET /status`
- `artifacts/api-server/src/routes/generate.ts` — `mode: incremental` skips already-processed commits
- `artifacts/kg-engine/src/pages/pipeline.tsx` — `IngestStatusCard` + mode toggle

## Status

**✅ Done**

## Verification Checklist

### Schema — Cursor Columns

- [ ] **Confirm `projects` table has `lastGitIngestedAt TIMESTAMP`** column defined in `lib/db/src/schema/projects.ts`.
- [ ] **Confirm `projects` table has `lastSvnRevision INTEGER`** column defined in the same schema file.
- [ ] **Confirm `commits` table has `processedAt TIMESTAMP`** column in `lib/db/src/schema/commits.ts`.

### Ingest Route — Incremental Mode

- [ ] **Confirm `POST /projects/:id/ingest/git` accepts `mode: 'full' | 'incremental'`** in the request body.
- [ ] **In `incremental` mode**, confirm the route filters commits by `commitDate > lastGitIngestedAt` (or equivalent) and skips already-ingested commits.
- [ ] **Confirm `lastGitIngestedAt` is updated** on the project row after a successful incremental git ingest.
- [ ] **Same checks for SVN**: `mode` param, `revision > lastSvnRevision` filter, cursor update after success.

### Generate Route — Incremental Mode

- [ ] **Confirm `POST /projects/:id/generate` accepts `mode: 'full' | 'incremental'`**.
- [ ] **In `incremental` mode**, confirm only commits with null `processedAt` are fed to the L1/L2/L3 pipeline.
- [ ] **Confirm `processedAt` is set** on each commit row after it is successfully processed.

### Status Endpoint

- [ ] **Confirm `GET /projects/:id/ingest/status`** returns `{ lastGitIngestedAt, lastSvnRevision, pendingCommits }` (or equivalent summary).

### Frontend

- [ ] **Confirm `IngestStatusCard`** in `pipeline.tsx` displays the cursor values and a mode toggle (full vs. incremental).

### Compilation & Type Safety

- [ ] **Type Check**: `pnpm run typecheck` must pass with zero errors.
- [ ] **Build Process**: `pnpm run build` must succeed.

---

## 🤖 Agent Sub-Tasks

### Schema Inspection

- [ ] **Trigger `Database Schema Expert`** to inspect `lib/db/src/schema/projects.ts` and `lib/db/src/schema/commits.ts`.
  - **Validation Goal**: Confirm `lastGitIngestedAt`, `lastSvnRevision`, and `processedAt` columns exist with correct types. Verify indexes on `processedAt` (or `commitDate`) for performance.

### Ingest Route Inspection

- [ ] **Trigger `Explore`** to read `artifacts/api-server/src/routes/ingest.ts`, filtering for the `mode` parameter handling.
  - **Validation Goal**: Confirm the cursor-based filtering logic: (1) reads the current cursor value from the project row, (2) only fetches/processes items newer than the cursor, (3) updates the cursor after success, (4) does not update the cursor on partial failure.

### Generate Route Inspection

- [ ] **Trigger `Explore`** to read `artifacts/api-server/src/routes/generate.ts` for the `mode: 'incremental'` handling.
  - **Validation Goal**: Confirm that in incremental mode only commits with `processedAt IS NULL` are selected, and `processedAt` is set to `NOW()` after processing.

### Project Build & Type Verification

- [ ] **Trigger `Task Verifier`** to run `pnpm run typecheck && pnpm run build`.
  - **Validation Goal**: Zero TypeScript errors, successful build.

### Compilation & Type Safety

- [ ] **Type Check**: Execute `pnpm run typecheck` across the workspace to ensure strict TypeScript compliance.
- [ ] **Build Process**: Execute `pnpm run build` to ensure the artifacts compile successfully without runtime resolution errors.

---

## 🤖 Agent Sub-Tasks

### Automated Source Code Inspection

- [ ] **Trigger `Explore` or `Task Verifier`** to analyze the following paths:
  - `lastGitIngestedAt`
  - `lastSvnRevision`
  - `processedAt`
  - **Validation Goal**: Read the file contents to verify that exported functions, interfaces, schemas, and variables precisely match the defined architecture and do not contain stubbed/mocked implementations.

### Logic Deep-Dive

- [ ] **Trigger `Requirement Analyzer` & `Task Verifier`** to perform semantic checks on the logic:
  - **/ cursors on projects**: Trace the implementation from data ingestion/input down to the database or output response. Confirm that all required properties, valid types, and state transitions are explicitly coded.
  - **on commits**: Trace the implementation from data ingestion/input down to the database or output response. Confirm that all required properties, valid types, and state transitions are explicitly coded.
  - \*\*`mode: full\*\*: Trace the implementation from data ingestion/input down to the database or output response. Confirm that all required properties, valid types, and state transitions are explicitly coded.
  - **Validation Goal**: Output a strict pass/fail criteria matching the exact specification details instead of a generic 'looks good' response.

### Project Build & Type Verification

- [ ] **Trigger `Task Verifier`**:
  - Run the terminal commands: `pnpm run typecheck` and `pnpm run build`.
  - **Validation Goal**: Prove the stability of the implementation by ensuring zero TypeScript compilation errors and successful artifact generation.
