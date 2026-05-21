# VS Code Extension API

## Overview
Allow developers to query the Docuvia knowledge graph from VS Code while writing code. Implemented as **server-side API endpoints** that a VS Code extension client can call — the packaged `.vsix` extension itself is not yet built.

## Implementation
`artifacts/api-server/src/routes/extensions_vscode.ts` — 3 endpoints:
- `POST /extensions/vscode/query` — natural language query using the agentic RAG intent router
- `POST /extensions/vscode/create-decision` — create an L3 decision record from the editor
- `GET /extensions/vscode/file-context` — retrieve knowledge nodes relevant to a file path

`artifacts/api-server/src/lib/extensions-service.ts` — service layer with `vscodeQuery()`, `createL3Decision()`, `getFileContext()`. Test file at `test/extensions_vscode.test.ts` (Vitest + supertest).

> ⚠️ **Scope Note**: The "VS Code Extension" feature in this repo is **server-side API endpoints only**. No VS Code extension package (no `package.json` with `engines.vscode`, no `.vsix`, no `extension.ts` entry point) exists in this codebase. A future task is to build the VS Code client that calls these endpoints.

### Key Files
- `artifacts/api-server/src/routes/extensions_vscode.ts` — route handlers
- `artifacts/api-server/src/lib/extensions-service.ts` — service layer
- `test/extensions_vscode.test.ts` — VS Code extension endpoint test
- `lib/api-zod/src/generated/types/vscodeQueryInput.ts` — generated request type
- `lib/api-zod/src/generated/types/vscodeQueryResult.ts` — generated response type

## Status
**✅ Done (server-side API)** — VS Code client package not yet built.

## Verification Checklist

### API Endpoints

- [ ] **Confirm `POST /extensions/vscode/query` exists** and accepts `{ query: string, projectId?: number, fileContext?: string }` in the request body.
  - Verify it calls `routeQuery()` from `intent-router.ts` and returns an `AgenticSearchResult`.
- [ ] **Confirm `POST /extensions/vscode/create-decision` exists** and accepts `{ title, content, l2NodeId, commitHash? }` to create an L3 node with `nodeType: 'decision'`.
- [ ] **Confirm `GET /extensions/vscode/file-context` exists** and accepts `filePath` as a query parameter, returning L2/L3 nodes whose `sourcePath` matches.

### Service Layer

- [ ] **Confirm `extensions-service.ts` implements all three functions**: `vscodeQuery()`, `createL3Decision()`, `getFileContext()`.
- [ ] **Confirm `vscodeQuery()` delegates to `routeQuery()`** from `intent-router.ts` (not a direct DB query).

### Test Coverage

- [ ] **Confirm `test/extensions_vscode.test.ts` covers all 3 endpoints** with at least happy-path assertions using supertest.
- [ ] **Run `pnpm test`** (or equivalent) to verify the test suite passes.

### Known Gap

- [ ] **Document that the VS Code client package is missing**: no `engines.vscode` manifest, no `.vsix` build script, no `extension.ts` entry point. Future work must build the client extension that uses these endpoints.

### Compilation & Type Safety

- [ ] **Type Check**: `pnpm run typecheck` must pass with zero errors.
- [ ] **Build Process**: `pnpm run build` must succeed.

---

## 🤖 Agent Sub-Tasks

### Route & Service Inspection

- [ ] **Trigger `Explore`** to read `artifacts/api-server/src/routes/extensions_vscode.ts` and `artifacts/api-server/src/lib/extensions-service.ts`.
  - **Validation Goal**: Confirm all 3 endpoints are wired, their Zod request validation schemas match the generated types, and error responses (400/404/500) are handled. Confirm `vscodeQuery()` uses `routeQuery()` from `intent-router.ts`.

### Test Execution

- [ ] **Trigger `Task Verifier`** to run:
  ```bash
  pnpm test
  ```
  - **Validation Goal**: All tests pass. If no test runner is configured, raise a gap report.

### OpenAPI Contract Check

- [ ] **Trigger `API Architect`** to verify the 3 VS Code extension endpoints are defined in `lib/api-spec/openapi.yaml` and that `lib/api-zod/src/generated/` reflects them.
  - **Validation Goal**: Confirm `vscodeQueryInput`, `vscodeQueryResult`, `vscodeFileContextParams`, `vscodeCreateDecisionInput` types are all generated and match the route handlers.

### Project Build & Type Verification

- [ ] **Trigger `Task Verifier`** to run `pnpm run typecheck && pnpm run build`.
  - **Validation Goal**: Zero TypeScript errors, successful build.

## Verification Checklist


### Functional & Logic Requirements

- [ ] **Verify 'PR: https://github.com/dyphn1/Docuvia/pull/new/fix/api-zod-codegen-and-ts-errors'**: Check that the business rules, data transformations, and edge cases for this entity are fully handled. Ensure the functionality behaves exactly as specified in the requirements.
- [ ] **Verify 'files: artifacts/api-server/src/routes/extensions_vscode.ts'**: Check that the business rules, data transformations, and edge cases for this entity are fully handled. Ensure the functionality behaves exactly as specified in the requirements.
- [ ] **Verify 'artifacts/api-server/src/lib/extensions-service.ts'**: Check that the business rules, data transformations, and edge cases for this entity are fully handled. Ensure the functionality behaves exactly as specified in the requirements.
- [ ] **Verify 'lib/api-spec/orval.config.ts'**: Check that the business rules, data transformations, and edge cases for this entity are fully handled. Ensure the functionality behaves exactly as specified in the requirements.
- [ ] **Verify 'lib/api-spec/orval.config.cjs'**: Check that the business rules, data transformations, and edge cases for this entity are fully handled. Ensure the functionality behaves exactly as specified in the requirements.
- [ ] **Verify 'lib/api-zod/src/generated/api.ts'**: Check that the business rules, data transformations, and edge cases for this entity are fully handled. Ensure the functionality behaves exactly as specified in the requirements.
- [ ] **Verify 'lib/api-zod/src/generated/types.ts'**: Check that the business rules, data transformations, and edge cases for this entity are fully handled. Ensure the functionality behaves exactly as specified in the requirements.
- [ ] **Verify 'test/extensions_vscode.test.ts'**: Check that the business rules, data transformations, and edge cases for this entity are fully handled. Ensure the functionality behaves exactly as specified in the requirements.

### API Contract & Routing

- [ ] **Endpoint Correctness**: Verify that the endpoints are defined with correct path parameters, query parameters, request body schemas (via Zod), and return accurate JSON responses.

### Compilation & Type Safety

- [ ] **Type Check**: Execute `pnpm run typecheck` across the workspace to ensure strict TypeScript compliance.
- [ ] **Build Process**: Execute `pnpm run build` to ensure the artifacts compile successfully without runtime resolution errors.

---

## 🤖 Agent Sub-Tasks


### Logic Deep-Dive

- [ ] **Trigger `Requirement Analyzer` & `Task Verifier`** to perform semantic checks on the logic:
  - **PR: https://github.com/dyphn1/Docuvia/pull/new/fix/api-zod-codegen-and-ts-errors**: Trace the implementation from data ingestion/input down to the database or output response. Confirm that all required properties, valid types, and state transitions are explicitly coded.
  - **files: artifacts/api-server/src/routes/extensions_vscode.ts**: Trace the implementation from data ingestion/input down to the database or output response. Confirm that all required properties, valid types, and state transitions are explicitly coded.
  - **artifacts/api-server/src/lib/extensions-service.ts**: Trace the implementation from data ingestion/input down to the database or output response. Confirm that all required properties, valid types, and state transitions are explicitly coded.
  - **lib/api-spec/orval.config.ts**: Trace the implementation from data ingestion/input down to the database or output response. Confirm that all required properties, valid types, and state transitions are explicitly coded.
  - **lib/api-spec/orval.config.cjs**: Trace the implementation from data ingestion/input down to the database or output response. Confirm that all required properties, valid types, and state transitions are explicitly coded.
  - **lib/api-zod/src/generated/api.ts**: Trace the implementation from data ingestion/input down to the database or output response. Confirm that all required properties, valid types, and state transitions are explicitly coded.
  - **lib/api-zod/src/generated/types.ts**: Trace the implementation from data ingestion/input down to the database or output response. Confirm that all required properties, valid types, and state transitions are explicitly coded.
  - **test/extensions_vscode.test.ts**: Trace the implementation from data ingestion/input down to the database or output response. Confirm that all required properties, valid types, and state transitions are explicitly coded.
  - **Validation Goal**: Output a strict pass/fail criteria matching the exact specification details instead of a generic 'looks good' response.


### API Endpoint Validation

- [ ] **Trigger `API Architect` & `Backend Developer`**:
  - Review the route handlers and OpenAPI specifications.
  - **Validation Goal**: Ensure all edge cases (e.g., 404 Not Found, 400 Bad Request) are handled properly and that the generated client hooks match the backend signatures.


### Project Build & Type Verification

- [ ] **Trigger `Task Verifier`**:
  - Run the terminal commands: `pnpm run typecheck` and `pnpm run build`.
  - **Validation Goal**: Prove the stability of the implementation by ensuring zero TypeScript compilation errors and successful artifact generation.
