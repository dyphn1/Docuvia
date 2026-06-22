# Feedback Loop — Corrections to Prompts

## Overview

Capture human corrections to AI-generated nodes as examples that feed back into prompt improvement.

## Implementation

`lib/db/src/schema/correction_examples.ts` stores correction examples.

### Key Files

- `lib/db/src/schema/correction_examples.ts`

## Status

**✅ Done**

## Verification Checklist

### Code Structure & Paths

- [ ] **Validate Code Locations**: Confirm the existence and correct placement of the following modules/files:
  - `lib/db/src/schema/correction_examples.ts`
  - `review_tasks.ts`
  - `getRecentCorrections()`
  - `generate.ts`

### Functional & Logic Requirements

- [ ] **Verify 'writeback in stores corrections'**: Check that the business rules, data transformations, and edge cases for this entity are fully handled. Ensure the functionality behaves exactly as specified in the requirements.
- [ ] **Verify 'in injects last 5 corrections as few-shot examples'**: Check that the business rules, data transformations, and edge cases for this entity are fully handled. Ensure the functionality behaves exactly as specified in the requirements.

### Database Integrity

- [ ] **Schema Definitions**: Ensure the table schemas map correctly to TypeScript types, foreign key constraints are strictly enforced, and database migrations can be generated without conflicts.

### API Contract & Routing

- [ ] **Endpoint Correctness**: Verify that the endpoints are defined with correct path parameters, query parameters, request body schemas (via Zod), and return accurate JSON responses.

### Compilation & Type Safety

- [ ] **Type Check**: Execute `pnpm run typecheck` across the workspace to ensure strict TypeScript compliance.
- [ ] **Build Process**: Execute `pnpm run build` to ensure the artifacts compile successfully without runtime resolution errors.

---

## 🤖 Agent Sub-Tasks

### Automated Source Code Inspection

- [ ] **Trigger `Explore` or `Task Verifier`** to analyze the following paths:
  - `lib/db/src/schema/correction_examples.ts`
  - `review_tasks.ts`
  - `getRecentCorrections()`
  - `generate.ts`
  - **Validation Goal**: Read the file contents to verify that exported functions, interfaces, schemas, and variables precisely match the defined architecture and do not contain stubbed/mocked implementations.

### Logic Deep-Dive

- [ ] **Trigger `Requirement Analyzer` & `Task Verifier`** to perform semantic checks on the logic:
  - **writeback in stores corrections**: Trace the implementation from data ingestion/input down to the database or output response. Confirm that all required properties, valid types, and state transitions are explicitly coded.
  - **in injects last 5 corrections as few-shot examples**: Trace the implementation from data ingestion/input down to the database or output response. Confirm that all required properties, valid types, and state transitions are explicitly coded.
  - **Validation Goal**: Output a strict pass/fail criteria matching the exact specification details instead of a generic 'looks good' response.

### Database Schema Validation

- [ ] **Trigger `Database Schema Expert`**:
  - Inspect the Drizzle schema definitions for correct column types, indexes, and relations.
  - **Validation Goal**: Ensure that `drizzle-kit generate` produces valid SQL without errors and that the data model perfectly aligns with application requirements.

### API Endpoint Validation

- [ ] **Trigger `API Architect` & `Backend Developer`**:
  - Review the route handlers and OpenAPI specifications.
  - **Validation Goal**: Ensure all edge cases (e.g., 404 Not Found, 400 Bad Request) are handled properly and that the generated client hooks match the backend signatures.

### Project Build & Type Verification

- [ ] **Trigger `Task Verifier`**:
  - Run the terminal commands: `pnpm run typecheck` and `pnpm run build`.
  - **Validation Goal**: Prove the stability of the implementation by ensuring zero TypeScript compilation errors and successful artifact generation.
