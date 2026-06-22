# Natural Language Query Interface (Frontend)

## Overview

A frontend UI allowing users to query the knowledge graph in natural language and browse results.

## Implementation

`artifacts/kg-engine/src/pages/query.tsx` — full semantic search UI with project selector, layer-colored result cards (violet for L1, blue for L2, emerald for L3), similarity score display per result, loading and error states. Calls `POST /api/search`.

> ⚠️ **Doc was stale** — previously recorded as "Partial — frontend not implemented" but `query.tsx` is fully implemented.

### Key Files

- `artifacts/kg-engine/src/pages/query.tsx` — search page component
- `artifacts/api-server/src/routes/search.ts` — backend `POST /search` (vector + SQL fallback)
- `lib/api-zod/src/generated/` — generated React Query hooks

## Status

**✅ Done**

## Verification Checklist

### Component Structure

- [ ] **Confirm `query.tsx` renders a project selector `<Select>`** whose options are populated from the project list API.
- [ ] **Confirm a text input / search bar** triggers the `POST /api/search` call on submit.
- [ ] **Confirm result cards render with layer-specific colors**: L1 = violet, L2 = blue, L3 = emerald (or equivalent Tailwind classes).
- [ ] **Confirm each result card shows**: node name, layer (L1/L2/L3), score percentage, and a snippet of the node content.

### API Integration

- [ ] **Confirm `POST /api/search` is called** with `{ query, projectId?, limit? }` and the response is consumed via the generated React Query hook or direct fetch.
- [ ] **Confirm error state** is displayed when the API returns a non-2xx response.
- [ ] **Confirm loading state** (spinner or skeleton) is shown while the search request is in flight.

### Compilation & Type Safety

- [ ] **Type Check**: `pnpm run typecheck` must pass with zero errors for `kg-engine`.
- [ ] **Frontend Build**: `pnpm --filter @workspace/kg-engine run build` must succeed.

---

## 🤖 Agent Sub-Tasks

### Component Inspection

- [ ] **Trigger `Explore`** to read `artifacts/kg-engine/src/pages/query.tsx` in full.
  - **Validation Goal**: Confirm the component contains a project filter Select, a search input, a submit handler calling the search API, result rendering with layer-color logic, and both loading and error states. Report any missing states or hardcoded values.

### Backend Search Route Verification

- [ ] **Trigger `Explore`** to read `artifacts/api-server/src/routes/search.ts`.
  - **Validation Goal**: Confirm the route accepts `query`, optional `projectId`, and optional `limit`. Confirm it first attempts vector cosine similarity search, then falls back to SQL `LIKE` if no embeddings exist. Confirm it returns results from L1, L2, and L3 tables in a unified response shape.

### Frontend Build Verification

- [ ] **Trigger `Task Verifier`** to run:
  ```bash
  pnpm --filter @workspace/kg-engine run build
  ```

  - **Validation Goal**: Exit code 0, no TypeScript or Vite build errors.

## Verification Checklist

### Code Structure & Paths

- [ ] **Validate Code Locations**: Confirm the existence and correct placement of the following modules/files:
  - `artifacts/kg-engine/src/pages/query.tsx`

### Functional & Logic Requirements

- [ ] **Verify 'semantic search UI with project filter'**: Check that the business rules, data transformations, and edge cases for this entity are fully handled. Ensure the functionality behaves exactly as specified in the requirements.
- [ ] **Verify 'layer-colored result cards'**: Check that the business rules, data transformations, and edge cases for this entity are fully handled. Ensure the functionality behaves exactly as specified in the requirements.
- [ ] **Verify 'score display'**: Check that the business rules, data transformations, and edge cases for this entity are fully handled. Ensure the functionality behaves exactly as specified in the requirements.

### User Interface & Client Integration

- [ ] **React Components**: Ensure the frontend components are correctly built using the designated UI library, state is properly managed, and the hooks generated from the API spec are correctly utilized.

### Compilation & Type Safety

- [ ] **Type Check**: Execute `pnpm run typecheck` across the workspace to ensure strict TypeScript compliance.
- [ ] **Build Process**: Execute `pnpm run build` to ensure the artifacts compile successfully without runtime resolution errors.

---

## 🤖 Agent Sub-Tasks

### Automated Source Code Inspection

- [ ] **Trigger `Explore` or `Task Verifier`** to analyze the following paths:
  - `artifacts/kg-engine/src/pages/query.tsx`
  - **Validation Goal**: Read the file contents to verify that exported functions, interfaces, schemas, and variables precisely match the defined architecture and do not contain stubbed/mocked implementations.

### Logic Deep-Dive

- [ ] **Trigger `Requirement Analyzer` & `Task Verifier`** to perform semantic checks on the logic:
  - **semantic search UI with project filter**: Trace the implementation from data ingestion/input down to the database or output response. Confirm that all required properties, valid types, and state transitions are explicitly coded.
  - **layer-colored result cards**: Trace the implementation from data ingestion/input down to the database or output response. Confirm that all required properties, valid types, and state transitions are explicitly coded.
  - **score display**: Trace the implementation from data ingestion/input down to the database or output response. Confirm that all required properties, valid types, and state transitions are explicitly coded.
  - **Validation Goal**: Output a strict pass/fail criteria matching the exact specification details instead of a generic 'looks good' response.

### Frontend Validation

- [ ] **Trigger `Frontend Developer`**:
  - Inspect the `.tsx` files for correct component hierarchy, prop types, and state management.
  - **Validation Goal**: Guarantee that there are no unused variables, exhaustive dependencies are met in `useEffect`, and the UI aligns with the wireframe/design spec.

### Project Build & Type Verification

- [ ] **Trigger `Task Verifier`**:
  - Run the terminal commands: `pnpm run typecheck` and `pnpm run build`.
  - **Validation Goal**: Prove the stability of the implementation by ensuring zero TypeScript compilation errors and successful artifact generation.
