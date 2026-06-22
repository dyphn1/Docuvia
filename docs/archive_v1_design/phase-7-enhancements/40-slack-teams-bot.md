# Slack / Teams Bot

## Overview

Allow team members to query the knowledge graph via Slack or Microsoft Teams using natural language.

## Implementation

`artifacts/api-server/src/lib/slack-teams-client.ts`, `routes/notifications.ts`.

### Key Files

- `artifacts/api-server/src/lib/slack-teams-client.ts`
- `artifacts/api-server/src/routes/notifications.ts`
- `lib/db/src/schema/notifications.ts`

## Status

**✅ Done**

## Verification Checklist

### Code Structure & Paths

- [ ] **Validate Code Locations**: Confirm the existence and correct placement of the following modules/files:
  - `lib/db/src/schema/project_integrations.ts`
  - `artifacts/api-server/src/lib/slack-teams-client.ts`
  - `routes/integrations.ts`
  - `generate.ts`
  - `ingest.ts`
  - `projectIntegrationsTable`
  - `pages/integrations.tsx`

### Functional & Logic Requirements

- [ ] **Verify 'fire-and-forget hooks in'**: Check that the business rules, data transformations, and edge cases for this entity are fully handled. Ensure the functionality behaves exactly as specified in the requirements.
- [ ] **Verify '(Drizzle'**: Check that the business rules, data transformations, and edge cases for this entity are fully handled. Ensure the functionality behaves exactly as specified in the requirements.
- [ ] **Verify 'migration)'**: Check that the business rules, data transformations, and edge cases for this entity are fully handled. Ensure the functionality behaves exactly as specified in the requirements.
- [ ] **Verify 'OpenAPI 5 paths'**: Check that the business rules, data transformations, and edge cases for this entity are fully handled. Ensure the functionality behaves exactly as specified in the requirements.
- [ ] **Verify '3 schemas'**: Check that the business rules, data transformations, and edge cases for this entity are fully handled. Ensure the functionality behaves exactly as specified in the requirements.
- [ ] **Verify 'Orval codegen'**: Check that the business rules, data transformations, and edge cases for this entity are fully handled. Ensure the functionality behaves exactly as specified in the requirements.
- [ ] **Verify '(project selector'**: Check that the business rules, data transformations, and edge cases for this entity are fully handled. Ensure the functionality behaves exactly as specified in the requirements.
- [ ] **Verify 'CRUD'**: Check that the business rules, data transformations, and edge cases for this entity are fully handled. Ensure the functionality behaves exactly as specified in the requirements.
- [ ] **Verify 'test button'**: Check that the business rules, data transformations, and edge cases for this entity are fully handled. Ensure the functionality behaves exactly as specified in the requirements.
- [ ] **Verify 'enabled toggle)'**: Check that the business rules, data transformations, and edge cases for this entity are fully handled. Ensure the functionality behaves exactly as specified in the requirements.
- [ ] **Verify 'nav item'**: Check that the business rules, data transformations, and edge cases for this entity are fully handled. Ensure the functionality behaves exactly as specified in the requirements.

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
  - `lib/db/src/schema/project_integrations.ts`
  - `artifacts/api-server/src/lib/slack-teams-client.ts`
  - `routes/integrations.ts`
  - `generate.ts`
  - `ingest.ts`
  - `projectIntegrationsTable`
  - `pages/integrations.tsx`
  - **Validation Goal**: Read the file contents to verify that exported functions, interfaces, schemas, and variables precisely match the defined architecture and do not contain stubbed/mocked implementations.

### Logic Deep-Dive

- [ ] **Trigger `Requirement Analyzer` & `Task Verifier`** to perform semantic checks on the logic:
  - **fire-and-forget hooks in**: Trace the implementation from data ingestion/input down to the database or output response. Confirm that all required properties, valid types, and state transitions are explicitly coded.
  - **(Drizzle**: Trace the implementation from data ingestion/input down to the database or output response. Confirm that all required properties, valid types, and state transitions are explicitly coded.
  - **migration)**: Trace the implementation from data ingestion/input down to the database or output response. Confirm that all required properties, valid types, and state transitions are explicitly coded.
  - **OpenAPI 5 paths**: Trace the implementation from data ingestion/input down to the database or output response. Confirm that all required properties, valid types, and state transitions are explicitly coded.
  - **3 schemas**: Trace the implementation from data ingestion/input down to the database or output response. Confirm that all required properties, valid types, and state transitions are explicitly coded.
  - **Orval codegen**: Trace the implementation from data ingestion/input down to the database or output response. Confirm that all required properties, valid types, and state transitions are explicitly coded.
  - **(project selector**: Trace the implementation from data ingestion/input down to the database or output response. Confirm that all required properties, valid types, and state transitions are explicitly coded.
  - **CRUD**: Trace the implementation from data ingestion/input down to the database or output response. Confirm that all required properties, valid types, and state transitions are explicitly coded.
  - **test button**: Trace the implementation from data ingestion/input down to the database or output response. Confirm that all required properties, valid types, and state transitions are explicitly coded.
  - **enabled toggle)**: Trace the implementation from data ingestion/input down to the database or output response. Confirm that all required properties, valid types, and state transitions are explicitly coded.
  - **nav item**: Trace the implementation from data ingestion/input down to the database or output response. Confirm that all required properties, valid types, and state transitions are explicitly coded.
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
