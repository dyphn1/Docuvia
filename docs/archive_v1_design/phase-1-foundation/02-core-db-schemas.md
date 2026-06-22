# Core DB Schemas

## Overview

Define all database tables used across the system using Drizzle ORM.

## Implementation

`lib/db/src/schema/` — projects, commits, documents, l1_tags, l2_nodes, l3_nodes, llm_configs, node_links, review_tasks, activity_log, correction_examples, notifications, project_integrations, prompt_templates, pull_requests, subscriptions.

### Key Files

- `lib/db/src/schema/projects.ts`
- `lib/db/src/schema/commits.ts`
- `lib/db/src/schema/l1_tags.ts`
- `lib/db/src/schema/l2_nodes.ts`
- `lib/db/src/schema/l3_nodes.ts`
- `lib/db/src/schema/review_tasks.ts`

## Status

**✅ Done**

## Verification Checklist

### Code Structure & Paths

- [ ] **Validate Code Locations**: Confirm the existence and correct placement of the following modules/files:
  - `lib/db/src/schema/`

### Functional & Logic Requirements

- [ ] **Verify 'projects'**: Check that the business rules, data transformations, and edge cases for this entity are fully handled. Ensure the functionality behaves exactly as specified in the requirements.
- [ ] **Verify 'commits'**: Check that the business rules, data transformations, and edge cases for this entity are fully handled. Ensure the functionality behaves exactly as specified in the requirements.
- [ ] **Verify 'documents'**: Check that the business rules, data transformations, and edge cases for this entity are fully handled. Ensure the functionality behaves exactly as specified in the requirements.
- [ ] **Verify 'llm_configs'**: Check that the business rules, data transformations, and edge cases for this entity are fully handled. Ensure the functionality behaves exactly as specified in the requirements.
- [ ] **Verify 'activity_log'**: Check that the business rules, data transformations, and edge cases for this entity are fully handled. Ensure the functionality behaves exactly as specified in the requirements.

### Database Integrity

- [ ] **Schema Definitions**: Ensure the table schemas map correctly to TypeScript types, foreign key constraints are strictly enforced, and database migrations can be generated without conflicts.

### Compilation & Type Safety

- [ ] **Type Check**: Execute `pnpm run typecheck` across the workspace to ensure strict TypeScript compliance.
- [ ] **Build Process**: Execute `pnpm run build` to ensure the artifacts compile successfully without runtime resolution errors.

---

## 🤖 Agent Sub-Tasks

### Automated Source Code Inspection

- [ ] **Trigger `Explore` or `Task Verifier`** to analyze the following paths:
  - `lib/db/src/schema/`
  - **Validation Goal**: Read the file contents to verify that exported functions, interfaces, schemas, and variables precisely match the defined architecture and do not contain stubbed/mocked implementations.

### Logic Deep-Dive

- [ ] **Trigger `Requirement Analyzer` & `Task Verifier`** to perform semantic checks on the logic:
  - **projects**: Trace the implementation from data ingestion/input down to the database or output response. Confirm that all required properties, valid types, and state transitions are explicitly coded.
  - **commits**: Trace the implementation from data ingestion/input down to the database or output response. Confirm that all required properties, valid types, and state transitions are explicitly coded.
  - **documents**: Trace the implementation from data ingestion/input down to the database or output response. Confirm that all required properties, valid types, and state transitions are explicitly coded.
  - **llm_configs**: Trace the implementation from data ingestion/input down to the database or output response. Confirm that all required properties, valid types, and state transitions are explicitly coded.
  - **activity_log**: Trace the implementation from data ingestion/input down to the database or output response. Confirm that all required properties, valid types, and state transitions are explicitly coded.
  - **Validation Goal**: Output a strict pass/fail criteria matching the exact specification details instead of a generic 'looks good' response.

### Database Schema Validation

- [ ] **Trigger `Database Schema Expert`**:
  - Inspect the Drizzle schema definitions for correct column types, indexes, and relations.
  - **Validation Goal**: Ensure that `drizzle-kit generate` produces valid SQL without errors and that the data model perfectly aligns with application requirements.

### Project Build & Type Verification

- [ ] **Trigger `Task Verifier`**:
  - Run the terminal commands: `pnpm run typecheck` and `pnpm run build`.
  - **Validation Goal**: Prove the stability of the implementation by ensuring zero TypeScript compilation errors and successful artifact generation.
