# Standard Ingestion Pipeline Refactoring (Solution C)

## Overview
This implementation plan addresses multiple issues discovered during design verification of the Docuvia knowledge graph engine. The core objective is to unify the data ingestion flow (Git, SVN, Documents) into a standardized pipeline, extract duplicated business logic, harden external process executions, and establish a robust test safety net.

## Implementation Goals
1. **Testing Safety Net**: `artifacts/api-server/test/support/factories.ts` exports `CommitFactory`, `DocumentFactory`, `L1TagFactory`, and `NodeLinkFactory` allowing deterministic DB seeding in tests.
2. **Commit Scorer Extraction**: `scoreCommit(commitMessage, diff)` exists purely in `artifacts/api-server/src/lib/commit-scorer.ts` and is consumed by `ingest.ts` and `github_webhooks.ts`.
3. **Local Git Ingestion**: `artifacts/api-server/src/lib/git-client.ts` uses `child_process.execFile` instead of the GitHub API, successfully cloning remote repositories to a temporary directory, and extracting commit logs and diffs.
4. **SVN Hardening**: The SVN ingestion route accepts `endRevision` as `"HEAD"` or a number. All SVN URLs are strictly validated (regex/URL parsing) before being passed to `execFile`.
5. **Document Ingestion Polish**: The `documentsTable` records a calculated SHA-256 `contentHash`. `activityLogTable` records successful document ingests. `.log` files map to the build artifact parser. `commitSha` is successfully propagated when provided.
6. **Pipeline Abstraction**: A unified function handles the standard ingestion sequence: `Hash deduplication -> Score -> DB Insert -> Activity Log -> Notification`.

## Approach / Methodology
1. **Safety First**: Begin by scaffolding the missing test factories. This allows subsequent refactoring to be verified easily.
2. **Utility Extraction**: Pull out the duplicated `scoreCommit` logic into a pure, testable utility function.
3. **Client Modernization**: Build the `git-client.ts` wrapper. It must securely manage `child_process.execFile` calls and handle temporary file system operations for cloning.
4. **Pipeline Consolidation**: Abstract the database writing, activity logging, and notification phases into a shared pipeline module.
5. **Route Refactoring**: Update the `ingest.ts` and `github_webhooks.ts` Express routes to feed data into the new unified pipeline.
6. **Validation & Hardening**: Fix Zod schemas and add strict URL validation to prevent command injection in SVN processes.

## Detailed Implementation Steps

### Step 1: Update Test Factories
- **Target**: `artifacts/api-server/test/support/factories.ts`
- **Action**: Add `CommitFactory`, `DocumentFactory`, `L1TagFactory`, and `NodeLinkFactory`.
- **Verifiable Criterion**: Running `pnpm test` successfully resolves the new factories if imported.

### Step 2: Extract `commit-scorer.ts`
- **Target**: `artifacts/api-server/src/lib/commit-scorer.ts`
- **Action**: Move the `scoreCommit()` function from the route handlers into this dedicated lib file.
- **Verifiable Criterion**: Both `ingest.ts` and `github_webhooks.ts` import and use `scoreCommit` from the new module without logic duplication.

### Step 3: Implement Local Git Client
- **Target**: `artifacts/api-server/src/lib/git-client.ts`
- **Action**: Implement a wrapper around `child_process.execFile` that provides `git clone`, `git log`, and `git diff` functionality.
- **Verifiable Criterion**: Calling the `git-client.ts` functions with a valid remote URL successfully clones to a temporary directory, extracts commit history, and returns structured data.

### Step 4: SVN Fixes & Zod Schema Adjustments
- **Target**: `artifacts/api-server/src/routes/ingest.ts` (or `lib/api-spec/openapi.yaml` if schema is defined there)
- **Action**: 
  - Modify `endRevision` schema to accept `"HEAD"` | `number`.
  - Add strict URL validation (e.g., `^https?://`, `^svn://`) in the SVN ingestion route before invoking SVN via `execFile`.
- **Verifiable Criterion**: Malformed SVN URLs are rejected with a 400 error before reaching the command execution layer.

### Step 5: Update Document Ingestion
- **Target**: `artifacts/api-server/src/routes/ingest.ts`
- **Action**:
  - Calculate `contentHash` using `crypto.createHash('sha256')` on document upload.
  - Fix the extension matching logic to map `.log` to the `build-artifact-parser`.
  - Ensure `commitSha` is parsed and passed to the DB.
  - Insert a record into `activity_log` upon success.
- **Verifiable Criterion**: Uploading a `.log` document yields a calculated hash, processes via the build artifact parser, and writes to both `documents` and `activity_log` tables.

### Step 6: Core Pipeline Abstraction
- **Target**: `artifacts/api-server/src/lib/ingestion-pipeline.ts` (New File)
- **Action**: Create a `processIngestion({ data, type })` flow that sequentially handles deduplication (hash checking), scoring (for commits), DB insertion, activity logging, and notifications.
- **Verifiable Criterion**: Git, SVN, and Document ingest routes all invoke `processIngestion()` instead of manually executing DB inserts and activity logs.

## Implementation Details

### Affected Workspace Packages
- `@workspace/api-server`
- `@workspace/api-spec` (If OpenAPI modifications are needed for SVN `endRevision`)

### Key Files
- `artifacts/api-server/test/support/factories.ts`
- `artifacts/api-server/src/lib/commit-scorer.ts` (New)
- `artifacts/api-server/src/lib/git-client.ts` (New/Modify)
- `artifacts/api-server/src/lib/ingestion-pipeline.ts` (New)
- `artifacts/api-server/src/routes/ingest.ts`
- `artifacts/api-server/src/routes/github_webhooks.ts`
- `lib/api-spec/openapi.yaml` (If applicable for Zod schema generation)