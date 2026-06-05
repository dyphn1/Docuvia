# Cross-Project Dynamic Linking

## Overview
Detect and link shared knowledge nodes across different projects, enabling cross-project knowledge traversal.

## Implementation
`detectCrossProjectLinks()` in `artifacts/api-server/src/routes/generate.ts` — runs automatically at the end of each generation pipeline run. Compares embeddings of newly generated L2 nodes against all L2 nodes in other projects using cosine similarity. Threshold ≥ 0.85 triggers a `merge`-type `review_task` with a similarity score and the candidate cross-link target ID.

> ⚠️ **Doc was wrong** — `project_integrations.ts` and `routes/integrations.ts` are for **Slack/Teams webhook configuration**, not cross-project linking. The actual implementation lives entirely in `generate.ts`.

### Key Files
- `artifacts/api-server/src/routes/generate.ts` — `detectCrossProjectLinks()` function
- `lib/db/src/schema/review_tasks.ts` — `taskType: 'merge'` review task created on detection
- `artifacts/api-server/src/lib/embedding.ts` — `cosineSimilarity()` used for threshold check

## Status
**✅ Done (Detection + Review Task creation)** — Human-confirmation UI for activating confirmed cross-links is not yet implemented.

## Verification Checklist

### Cross-Link Detection Logic

- [ ] **Confirm `detectCrossProjectLinks(projectId, newL2Nodes)` exists in `generate.ts`** and is called at the end of the generation pipeline.
- [ ] **Confirm cosine similarity threshold is ≥ 0.85** — verify the numeric constant in the function body.
- [ ] **Confirm it compares newly generated L2 node embeddings** against all L2 nodes in *other* projects (not the current project).
- [ ] **Confirm it creates a `review_task` with `taskType: 'merge'`** including a payload with similarity score and the target L2 node ID.

### Review Task Integration

- [ ] **Confirm `review_tasks` table accepts `taskType: 'merge'`** — verify `taskTypeEnum` in `lib/db/src/schema/review_tasks.ts`.
- [ ] **Confirm the review task `entityType` and `entityId`** correctly point to the source L2 node.

### Known Limitation

- [ ] **No human-confirmation UI**: Once a `merge`-type review task is approved, there is no code path that creates an actual bi-directional cross-project node link. This is a known gap — future work should wire the `resolve` endpoint to activate the link.

### Compilation & Type Safety

- [ ] **Type Check**: `pnpm run typecheck` must pass with zero errors.
- [ ] **Build Process**: `pnpm run build` must complete successfully.

---

## 🤖 Agent Sub-Tasks

### Detection Function Inspection

- [ ] **Trigger `Explore`** to read `artifacts/api-server/src/routes/generate.ts`, specifically the `detectCrossProjectLinks()` function.
  - **Validation Goal**: Confirm the function: (1) queries all L2 nodes from other projects with non-null embeddings, (2) uses `cosineSimilarity()` with a threshold constant of 0.85, (3) creates a `review_task` row with `taskType: 'merge'` for each candidate pair, (4) does NOT create a direct `node_links` row (that requires human approval).

### Schema Validation

- [ ] **Trigger `Database Schema Expert`** to inspect `lib/db/src/schema/review_tasks.ts`.
  - **Validation Goal**: Confirm the `taskTypeEnum` includes `'merge'`, and that `correctedValue` or a separate payload column can store the target node ID and similarity score.

### Gap Documentation

- [ ] **Trigger `Requirement Analyzer`** to compare against `docs/implementation-roadmap.md` Phase 4.3.
  - **Validation Goal**: Confirm the gap — "Human-confirmed cross-project dynamic links" (bidirectional activation after review approval) is not yet implemented — and propose the backend change needed to wire approval to `node_links` creation.

### Project Build & Type Verification

- [ ] **Trigger `Task Verifier`** to run `pnpm run typecheck && pnpm run build`.
  - **Validation Goal**: Zero TypeScript errors, successful build.

### Compilation & Type Safety

- [ ] **Type Check**: Execute `pnpm run typecheck` across the workspace to ensure strict TypeScript compliance.
- [ ] **Build Process**: Execute `pnpm run build` to ensure the artifacts compile successfully without runtime resolution errors.

---

## 🤖 Agent Sub-Tasks

### Automated Source Code Inspection

- [ ] **Trigger `Explore` or `Task Verifier`** to analyze the following paths:
  - `detectCrossProjectLinks()`
  - `generate.ts`
  - **Validation Goal**: Read the file contents to verify that exported functions, interfaces, schemas, and variables precisely match the defined architecture and do not contain stubbed/mocked implementations.


### Logic Deep-Dive

- [ ] **Trigger `Requirement Analyzer` & `Task Verifier`** to perform semantic checks on the logic:
  - **cosine similarity ≥ 0.85 triggers review task with "merge" type suggesting cross-project link**: Trace the implementation from data ingestion/input down to the database or output response. Confirm that all required properties, valid types, and state transitions are explicitly coded.
  - **Validation Goal**: Output a strict pass/fail criteria matching the exact specification details instead of a generic 'looks good' response.


### Project Build & Type Verification

- [ ] **Trigger `Task Verifier`**:
  - Run the terminal commands: `pnpm run typecheck` and `pnpm run build`.
  - **Validation Goal**: Prove the stability of the implementation by ensuring zero TypeScript compilation errors and successful artifact generation.
