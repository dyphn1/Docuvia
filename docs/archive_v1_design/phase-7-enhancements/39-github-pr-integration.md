# GitHub PR Integration

## Overview

Analyze pull requests against the knowledge graph to surface related decisions, impacted modules, and review recommendations.

## Implementation

`artifacts/api-server/src/routes/pull_requests.ts`. Types: `pullRequest.ts`, `pullRequestDetail.ts`, `pullRequestState.ts`, `prAnalyzeResult.ts`, `pullRequestAnalysisStatus.ts`.

### Key Files

- `artifacts/api-server/src/routes/pull_requests.ts`
- `lib/db/src/schema/pull_requests.ts`
- `lib/api-zod/src/generated/types/prAnalyzeResult.ts`

## Status

**✅ Done**

## Verification Checklist

### Code Structure & Paths

- [ ] **Validate Code Locations**: Confirm the existence and correct placement of the following modules/files:
  - `lib/db/src/schema/pull_requests.ts`
  - `artifacts/api-server/src/lib/github-client.ts`
  - `routes/github_webhooks.ts`
  - `routes/pull_requests.ts`
  - `artifacts/kg-engine/src/pages/pull-requests.tsx`

### Database Integrity

- [ ] **Schema Definitions**: Ensure the table schemas map correctly to TypeScript types, foreign key constraints are strictly enforced, and database migrations can be generated without conflicts.

### API Contract & Routing

- [ ] **Endpoint Correctness**: Verify that the endpoints are defined with correct path parameters, query parameters, request body schemas (via Zod), and return accurate JSON responses.

### User Interface & Client Integration

- [ ] **React Components**: Ensure the frontend components are correctly built using the designated UI library, state is properly managed, and the hooks generated from the API spec are correctly utilized.

### Compilation & Type Safety

- [ ] **Type Check**: Execute `pnpm run typecheck` across the workspace to ensure strict TypeScript compliance.
- [ ] **Build Process**: Execute `pnpm run build` to ensure the artifacts compile successfully without runtime resolution errors.

---

## 🤖 Agent Sub-Tasks

### Automated Source Code Inspection

- [ ] **Trigger `Explore` or `Task Verifier`** to analyze the following paths:
  - `lib/db/src/schema/pull_requests.ts`
  - `artifacts/api-server/src/lib/github-client.ts`
  - `routes/github_webhooks.ts`
  - `routes/pull_requests.ts`
  - `artifacts/kg-engine/src/pages/pull-requests.tsx`
  - **Validation Goal**: Read the file contents to verify that exported functions, interfaces, schemas, and variables precisely match the defined architecture and do not contain stubbed/mocked implementations.

### Database Schema Validation

- [ ] **Trigger `Database Schema Expert`**:
  - Inspect the Drizzle schema definitions for correct column types, indexes, and relations.
  - **Validation Goal**: Ensure that `drizzle-kit generate` produces valid SQL without errors and that the data model perfectly aligns with application requirements.

### API Endpoint Validation

- [ ] **Trigger `API Architect` & `Backend Developer`**:
  - Review the route handlers and OpenAPI specifications.
  - **Validation Goal**: Ensure all edge cases (e.g., 404 Not Found, 400 Bad Request) are handled properly and that the generated client hooks match the backend signatures.

### Frontend Validation

- [ ] **Trigger `Frontend Developer`**:
  - Inspect the `.tsx` files for correct component hierarchy, prop types, and state management.
  - **Validation Goal**: Guarantee that there are no unused variables, exhaustive dependencies are met in `useEffect`, and the UI aligns with the wireframe/design spec.

### Project Build & Type Verification

- [ ] **Trigger `Task Verifier`**:
  - Run the terminal commands: `pnpm run typecheck` and `pnpm run build`.
  - **Validation Goal**: Prove the stability of the implementation by ensuring zero TypeScript compilation errors and successful artifact generation.
