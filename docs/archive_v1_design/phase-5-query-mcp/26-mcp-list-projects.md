# MCP: list_projects

## Overview

Return all registered projects available in the knowledge base.

## Implementation

`mcpProjectList.ts`, `mcpProjectListProjectsItem.ts`.

### Key Files

- `lib/api-zod/src/generated/types/mcpProjectList.ts`
- `lib/api-zod/src/generated/types/mcpProjectListProjectsItem.ts`

## Status

**✅ Done**

## Verification Checklist

### Code Structure & Paths

- [ ] **Validate Code Locations**: Confirm the existence and correct placement of the following modules/files:
  - `mcpProjectList.ts`
  - `mcpProjectListProjectsItem.ts`

### Compilation & Type Safety

- [ ] **Type Check**: Execute `pnpm run typecheck` across the workspace to ensure strict TypeScript compliance.
- [ ] **Build Process**: Execute `pnpm run build` to ensure the artifacts compile successfully without runtime resolution errors.

---

## 🤖 Agent Sub-Tasks

### Automated Source Code Inspection

- [ ] **Trigger `Explore` or `Task Verifier`** to analyze the following paths:
  - `mcpProjectList.ts`
  - `mcpProjectListProjectsItem.ts`
  - **Validation Goal**: Read the file contents to verify that exported functions, interfaces, schemas, and variables precisely match the defined architecture and do not contain stubbed/mocked implementations.

### Project Build & Type Verification

- [ ] **Trigger `Task Verifier`**:
  - Run the terminal commands: `pnpm run typecheck` and `pnpm run build`.
  - **Validation Goal**: Prove the stability of the implementation by ensuring zero TypeScript compilation errors and successful artifact generation.
