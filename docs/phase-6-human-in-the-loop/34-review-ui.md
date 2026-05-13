# Review UI (Frontend)

## Overview
A frontend interface for reviewers to view, approve, reject, and correct AI-generated L1/L2/L3 nodes.

## Implementation
`artifacts/kg-engine/src/pages/review.tsx` — full review queue UI with `TaskCard` component, approve/reject/defer action buttons, inline correction textarea (shown when editing), `useResolveReviewTask` mutation hook, and `useGetReviewStats` for a badge showing pending count.

> ⚠️ **Doc was stale** — previously recorded as "Partial — frontend not implemented" but `review.tsx` is fully implemented.

### Key Files
- `artifacts/kg-engine/src/pages/review.tsx` — review queue page
- `artifacts/api-server/src/routes/review_tasks.ts` — `GET /review-tasks`, `PATCH /review-tasks/:id/resolve`, `GET /review-tasks/stats`

## Status
**✅ Done**

## Verification Checklist

### Component Structure

- [ ] **Confirm `review.tsx` renders a list of `TaskCard` components** loaded from `GET /review-tasks`.
- [ ] **Confirm `TaskCard` shows**: task type (anchor/merge/confirm/flag), entity name, AI-generated content, and a confidence indicator.
- [ ] **Confirm Approve button** calls `PATCH /review-tasks/:id/resolve` with `{ status: 'approved' }`.
- [ ] **Confirm Reject button** calls `PATCH /review-tasks/:id/resolve` with `{ status: 'rejected' }`.
- [ ] **Confirm Defer button** calls `PATCH /review-tasks/:id/resolve` with `{ status: 'deferred' }`.
- [ ] **Confirm inline correction textarea** is rendered when the user clicks an "Edit" or "Correct" action, and the corrected value is submitted alongside the `approved` status.
- [ ] **Confirm review stats badge** (pending count) updates after a resolution action.

### API Integration

- [ ] **Confirm `GET /review-tasks` is called** on page load and returns an array of task objects with `taskType`, `status`, `entityType`, and `correctedValue` fields.
- [ ] **Confirm `GET /review-tasks/stats`** is polled or fetched to display the pending badge count.

### Compilation & Type Safety

- [ ] **Type Check**: `pnpm run typecheck` must pass with zero errors.
- [ ] **Frontend Build**: `pnpm --filter @workspace/kg-engine run build` must succeed.

---

## 🤖 Agent Sub-Tasks

### Component Inspection

- [ ] **Trigger `Explore`** to read `artifacts/kg-engine/src/pages/review.tsx` in full.
  - **Validation Goal**: Confirm the page: (1) fetches task list, (2) renders `TaskCard` with all 4 action states (approve/reject/defer/edit), (3) shows inline correction textarea on edit, (4) submits `correctedValue` with approved resolution, (5) invalidates/refetches the task list after each resolution.

### Resolution API Verification

- [ ] **Trigger `Explore`** to read `artifacts/api-server/src/routes/review_tasks.ts`, specifically the `PATCH /:id/resolve` handler.
  - **Validation Goal**: Confirm that on `status: 'approved'` with a non-empty `correctedValue`, the handler writes a row to `correction_examples` (for feedback loop). Confirm `status` transitions are validated (cannot re-resolve an already-resolved task).

### Frontend Build Verification

- [ ] **Trigger `Task Verifier`** to run:
  ```bash
  pnpm --filter @workspace/kg-engine run build
  ```
  - **Validation Goal**: Exit code 0, no TypeScript or Vite build errors.

## Verification Checklist

### Code Structure & Paths

- [ ] **Validate Code Locations**: Confirm the existence and correct placement of the following modules/files:
  - `review.tsx`

### Functional & Logic Requirements

- [ ] **Verify 'TaskCard'**: Check that the business rules, data transformations, and edge cases for this entity are fully handled. Ensure the functionality behaves exactly as specified in the requirements.
- [ ] **Verify 'approve/reject/defer'**: Check that the business rules, data transformations, and edge cases for this entity are fully handled. Ensure the functionality behaves exactly as specified in the requirements.
- [ ] **Verify 'correction editing confirmed'**: Check that the business rules, data transformations, and edge cases for this entity are fully handled. Ensure the functionality behaves exactly as specified in the requirements.

### User Interface & Client Integration

- [ ] **React Components**: Ensure the frontend components are correctly built using the designated UI library, state is properly managed, and the hooks generated from the API spec are correctly utilized.

### Compilation & Type Safety

- [ ] **Type Check**: Execute `pnpm run typecheck` across the workspace to ensure strict TypeScript compliance.
- [ ] **Build Process**: Execute `pnpm run build` to ensure the artifacts compile successfully without runtime resolution errors.

---

## 🤖 Agent Sub-Tasks

### Automated Source Code Inspection

- [ ] **Trigger `Explore` or `Task Verifier`** to analyze the following paths:
  - `review.tsx`
  - **Validation Goal**: Read the file contents to verify that exported functions, interfaces, schemas, and variables precisely match the defined architecture and do not contain stubbed/mocked implementations.


### Logic Deep-Dive

- [ ] **Trigger `Requirement Analyzer` & `Task Verifier`** to perform semantic checks on the logic:
  - **TaskCard**: Trace the implementation from data ingestion/input down to the database or output response. Confirm that all required properties, valid types, and state transitions are explicitly coded.
  - **approve/reject/defer**: Trace the implementation from data ingestion/input down to the database or output response. Confirm that all required properties, valid types, and state transitions are explicitly coded.
  - **correction editing confirmed**: Trace the implementation from data ingestion/input down to the database or output response. Confirm that all required properties, valid types, and state transitions are explicitly coded.
  - **Validation Goal**: Output a strict pass/fail criteria matching the exact specification details instead of a generic 'looks good' response.


### Frontend Validation

- [ ] **Trigger `Frontend Developer`**:
  - Inspect the `.tsx` files for correct component hierarchy, prop types, and state management.
  - **Validation Goal**: Guarantee that there are no unused variables, exhaustive dependencies are met in `useEffect`, and the UI aligns with the wireframe/design spec.


### Project Build & Type Verification

- [ ] **Trigger `Task Verifier`**:
  - Run the terminal commands: `pnpm run typecheck` and `pnpm run build`.
  - **Validation Goal**: Prove the stability of the implementation by ensuring zero TypeScript compilation errors and successful artifact generation.
