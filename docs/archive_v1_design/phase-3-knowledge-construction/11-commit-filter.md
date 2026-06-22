# Commit Filter

## Overview

Filter raw commits by quality signal using convention-based rules, targeting ~60% signal rate.

## Implementation

`generateInput.ts` includes `generateInputMode.ts` which controls filter strategy. `gitIngestInputMode.ts` drives incremental vs full.

### Key Files

- `lib/api-zod/src/generated/types/generateInput.ts`
- `lib/api-zod/src/generated/types/generateInputMode.ts`
- `lib/api-zod/src/generated/types/gitIngestInputMode.ts`

## Status

**✅ Done**

## Verification Checklist

### Code Structure & Paths

- [ ] **Validate Code Locations**: Confirm the existence and correct placement of the following modules/files:
  - `scoreCommit()`
  - `ingest.ts`

### Functional & Logic Requirements

- [ ] **Verify 'regex signal/noise patterns'**: Check that the business rules, data transformations, and edge cases for this entity are fully handled. Ensure the functionality behaves exactly as specified in the requirements.

### Compilation & Type Safety

- [ ] **Type Check**: Execute `pnpm run typecheck` across the workspace to ensure strict TypeScript compliance.
- [ ] **Build Process**: Execute `pnpm run build` to ensure the artifacts compile successfully without runtime resolution errors.

---

## 🤖 Agent Sub-Tasks

### Automated Source Code Inspection

- [ ] **Trigger `Explore` or `Task Verifier`** to analyze the following paths:
  - `scoreCommit()`
  - `ingest.ts`
  - **Validation Goal**: Read the file contents to verify that exported functions, interfaces, schemas, and variables precisely match the defined architecture and do not contain stubbed/mocked implementations.

### Logic Deep-Dive

- [ ] **Trigger `Requirement Analyzer` & `Task Verifier`** to perform semantic checks on the logic:
  - **regex signal/noise patterns**: Trace the implementation from data ingestion/input down to the database or output response. Confirm that all required properties, valid types, and state transitions are explicitly coded.
  - **Validation Goal**: Output a strict pass/fail criteria matching the exact specification details instead of a generic 'looks good' response.

### Project Build & Type Verification

- [ ] **Trigger `Task Verifier`**:
  - Run the terminal commands: `pnpm run typecheck` and `pnpm run build`.
  - **Validation Goal**: Prove the stability of the implementation by ensuring zero TypeScript compilation errors and successful artifact generation.
