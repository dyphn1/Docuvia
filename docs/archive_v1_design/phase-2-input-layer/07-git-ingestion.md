# Git Ingestion

## Overview
Fetch commit history and diffs from Git repositories (GitHub API or local git) and store as structured commits.

## Implementation
`artifacts/api-server/src/lib/github-client.ts` handles GitHub API calls. `routes/ingest.ts` exposes the ingestion endpoint. Types: `gitIngestInput.ts`, `gitIngestResult.ts`, `gitIngestInputMode.ts`.

### Key Files
- `artifacts/api-server/src/lib/github-client.ts`
- `artifacts/api-server/src/routes/ingest.ts`
- `lib/api-zod/src/generated/types/gitIngestInput.ts`

## Status
**✅ Done**

## Verification Checklist

### Code Structure & Paths

- [ ] **Validate Code Locations**: Confirm the existence and correct placement of the following modules/files:
  - `gitIngestInput.ts`
  - `gitIngestResult.ts`
  - `routes/ingest.ts`

### API Contract & Routing

- [ ] **Endpoint Correctness**: Verify that the endpoints are defined with correct path parameters, query parameters, request body schemas (via Zod), and return accurate JSON responses.

### Compilation & Type Safety

- [ ] **Type Check**: Execute `pnpm run typecheck` across the workspace to ensure strict TypeScript compliance.
- [ ] **Build Process**: Execute `pnpm run build` to ensure the artifacts compile successfully without runtime resolution errors.

---

## 🤖 Agent Sub-Tasks

### Automated Source Code Inspection

- [ ] **Trigger `Explore` or `Task Verifier`** to analyze the following paths:
  - `gitIngestInput.ts`
  - `gitIngestResult.ts`
  - `routes/ingest.ts`
  - **Validation Goal**: Read the file contents to verify that exported functions, interfaces, schemas, and variables precisely match the defined architecture and do not contain stubbed/mocked implementations.


### API Endpoint Validation

- [ ] **Trigger `API Architect` & `Backend Developer`**:
  - Review the route handlers and OpenAPI specifications.
  - **Validation Goal**: Ensure all edge cases (e.g., 404 Not Found, 400 Bad Request) are handled properly and that the generated client hooks match the backend signatures.


### Project Build & Type Verification

- [ ] **Trigger `Task Verifier`**:
  - Run the terminal commands: `pnpm run typecheck` and `pnpm run build`.
  - **Validation Goal**: Prove the stability of the implementation by ensuring zero TypeScript compilation errors and successful artifact generation.
