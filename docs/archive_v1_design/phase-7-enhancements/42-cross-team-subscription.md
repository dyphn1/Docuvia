# Cross-Team Subscription

## Overview

Allow teams to subscribe to knowledge updates from other projects and receive notifications on changes.

## Implementation

`lib/db/src/schema/subscriptions.ts`, `artifacts/api-server/src/routes/subscriptions.ts`. Types: `subscription.ts`, `subscriptionInput.ts`, `subscriptionListResponse.ts`.

### Key Files

- `lib/db/src/schema/subscriptions.ts`
- `artifacts/api-server/src/routes/subscriptions.ts`
- `lib/api-zod/src/generated/types/subscription.ts`

## Status

**✅ Done**

## Verification Checklist

### Code Structure & Paths

- [ ] **Validate Code Locations**: Confirm the existence and correct placement of the following modules/files:
  - `lib/db/src/schema/subscriptions.ts`
  - `notifications.ts`
  - `routes/subscriptions.ts`
  - `routes/notifications.ts`
  - `NotificationBell`
  - `/subscriptions`

### Functional & Logic Requirements

- [ ] **Verify 'notification hooks in ingest'**: Check that the business rules, data transformations, and edge cases for this entity are fully handled. Ensure the functionality behaves exactly as specified in the requirements.
- [ ] **Verify 'generate pipelines'**: Check that the business rules, data transformations, and edge cases for this entity are fully handled. Ensure the functionality behaves exactly as specified in the requirements.
- [ ] **Verify 'component'**: Check that the business rules, data transformations, and edge cases for this entity are fully handled. Ensure the functionality behaves exactly as specified in the requirements.
- [ ] **Verify 'page'**: Check that the business rules, data transformations, and edge cases for this entity are fully handled. Ensure the functionality behaves exactly as specified in the requirements.

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
  - `lib/db/src/schema/subscriptions.ts`
  - `notifications.ts`
  - `routes/subscriptions.ts`
  - `routes/notifications.ts`
  - `NotificationBell`
  - `/subscriptions`
  - **Validation Goal**: Read the file contents to verify that exported functions, interfaces, schemas, and variables precisely match the defined architecture and do not contain stubbed/mocked implementations.

### Logic Deep-Dive

- [ ] **Trigger `Requirement Analyzer` & `Task Verifier`** to perform semantic checks on the logic:
  - **notification hooks in ingest**: Trace the implementation from data ingestion/input down to the database or output response. Confirm that all required properties, valid types, and state transitions are explicitly coded.
  - **generate pipelines**: Trace the implementation from data ingestion/input down to the database or output response. Confirm that all required properties, valid types, and state transitions are explicitly coded.
  - **component**: Trace the implementation from data ingestion/input down to the database or output response. Confirm that all required properties, valid types, and state transitions are explicitly coded.
  - **page**: Trace the implementation from data ingestion/input down to the database or output response. Confirm that all required properties, valid types, and state transitions are explicitly coded.
  - **Validation Goal**: Output a strict pass/fail criteria matching the exact specification details instead of a generic 'looks good' response.

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
