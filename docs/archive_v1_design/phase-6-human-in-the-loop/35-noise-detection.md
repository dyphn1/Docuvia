# Noise Detection — Inconsistent Tagging

## Overview

Automatically detect when the same concept is tagged inconsistently across commits or projects and flag it for human review.

## Implementation

`runNoiseDetection(projectId)` in `artifacts/api-server/src/routes/generate.ts` — called automatically at the end of each generation pipeline run. Two detection strategies:

1. **Low-usage tags**: flags `l1_tags` with `usageCount ≤ 1` as `anchor`-type review tasks.
2. **Near-duplicate names**: iterates all tag pairs, normalizes names (strip punctuation, lowercase), and creates `merge`-type review tasks for pairs with distance ≤ 2 (or similar string-distance threshold).

> ⚠️ **Doc was stale** — previously recorded as "Unclear" but `runNoiseDetection()` is fully implemented in `generate.ts`.

### Key Files

- `artifacts/api-server/src/routes/generate.ts` — `runNoiseDetection()` function
- `lib/db/src/schema/l1_tags.ts` — `usageCount` column used for low-usage detection
- `lib/db/src/schema/review_tasks.ts` — `anchor` and `merge` task types created

## Status

**✅ Done**

## Verification Checklist

### Low-Usage Tag Detection

- [ ] **Confirm `runNoiseDetection()` queries `l1_tags` by `projectId`** and filters for `usageCount <= 1`.
- [ ] **Confirm it creates a `review_task` with `taskType: 'anchor'`** for each low-usage tag, including the tag name and usage count in the payload.
- [ ] **Confirm it does NOT duplicate**: if an `anchor`-type review task already exists for the same tag (and is unresolved), it should not create a second one.

### Near-Duplicate Name Detection

- [ ] **Confirm it compares all tag name pairs** (O(n²) or equivalent) using string normalization (lowercase, strip punctuation).
- [ ] **Confirm the similarity threshold** used (e.g., edit distance ≤ 2, or starts-with match) and document it in code.
- [ ] **Confirm it creates a `review_task` with `taskType: 'merge'`** for each near-duplicate pair, including both tag names in the payload.

### Trigger Timing

- [ ] **Confirm `runNoiseDetection()` is called at the end of `POST /projects/:id/generate`**, after L1/L2/L3 generation is complete.

### Compilation & Type Safety

- [ ] **Type Check**: `pnpm run typecheck` must pass with zero errors.
- [ ] **Build Process**: `pnpm run build` must succeed.

---

## 🤖 Agent Sub-Tasks

### Function Inspection

- [ ] **Trigger `Explore`** to read `runNoiseDetection()` in `artifacts/api-server/src/routes/generate.ts`.
  - **Validation Goal**: Confirm: (1) it queries `l1_tagsTable` filtered by `projectId`, (2) creates `anchor` tasks for `usageCount <= 1`, (3) loops tag pairs for string normalization + distance check, (4) creates `merge` tasks for near-duplicates, (5) is called at the end of the generate handler. Report the exact threshold value and whether deduplication of existing tasks is handled.

### Schema Verification

- [ ] **Trigger `Database Schema Expert`** to check `lib/db/src/schema/l1_tags.ts`.
  - **Validation Goal**: Confirm `usageCount` column is defined as `integer` with a default of `0`, and that it is incremented correctly whenever a tag is applied to a commit (trace the upsert logic in `generate.ts`).

### Project Build & Type Verification

- [ ] **Trigger `Task Verifier`** to run `pnpm run typecheck && pnpm run build`.
  - **Validation Goal**: Zero TypeScript errors, successful build.

## Verification Checklist

### Code Structure & Paths

- [ ] **Validate Code Locations**: Confirm the existence and correct placement of the following modules/files:
  - `runNoiseDetection()`
  - `generate.ts`
  - `anchor`
  - `merge`

### Functional & Logic Requirements

- [ ] **Verify 'flags low-usage tags (≤1 use) and near-duplicate tag names'**: Check that the business rules, data transformations, and edge cases for this entity are fully handled. Ensure the functionality behaves exactly as specified in the requirements.
- [ ] **Verify 'creates / review tasks automatically'**: Check that the business rules, data transformations, and edge cases for this entity are fully handled. Ensure the functionality behaves exactly as specified in the requirements.

### Compilation & Type Safety

- [ ] **Type Check**: Execute `pnpm run typecheck` across the workspace to ensure strict TypeScript compliance.
- [ ] **Build Process**: Execute `pnpm run build` to ensure the artifacts compile successfully without runtime resolution errors.

---

## 🤖 Agent Sub-Tasks

### Automated Source Code Inspection

- [ ] **Trigger `Explore` or `Task Verifier`** to analyze the following paths:
  - `runNoiseDetection()`
  - `generate.ts`
  - `anchor`
  - `merge`
  - **Validation Goal**: Read the file contents to verify that exported functions, interfaces, schemas, and variables precisely match the defined architecture and do not contain stubbed/mocked implementations.

### Logic Deep-Dive

- [ ] **Trigger `Requirement Analyzer` & `Task Verifier`** to perform semantic checks on the logic:
  - **flags low-usage tags (≤1 use) and near-duplicate tag names**: Trace the implementation from data ingestion/input down to the database or output response. Confirm that all required properties, valid types, and state transitions are explicitly coded.
  - **creates / review tasks automatically**: Trace the implementation from data ingestion/input down to the database or output response. Confirm that all required properties, valid types, and state transitions are explicitly coded.
  - **Validation Goal**: Output a strict pass/fail criteria matching the exact specification details instead of a generic 'looks good' response.

### Project Build & Type Verification

- [ ] **Trigger `Task Verifier`**:
  - Run the terminal commands: `pnpm run typecheck` and `pnpm run build`.
  - **Validation Goal**: Prove the stability of the implementation by ensuring zero TypeScript compilation errors and successful artifact generation.
