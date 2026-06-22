# Impact Analysis Traversal

## Overview

Given a module or node, traverse the graph to identify all downstream nodes that would be affected by a change.

## Implementation

`GET /mcp/impact_analysis?nodeId=<id>` in `artifacts/api-server/src/routes/mcp.ts` — performs a **one-hop** graph traversal via `nodeLinksTable`, returning all directly linked nodes (both upstream and downstream). Response serialized as `mcpImpactResult`.

> ⚠️ **Known Limitation**: Only **one-hop traversal** is implemented. Multi-hop BFS/DFS (e.g., "what transitively depends on this module?") is not yet implemented. `docs/implementation-roadmap.md` Phase 4.2 specifies "impact traversal" without depth limit, which implies multi-hop support is the intended target.

### Key Files

- `artifacts/api-server/src/routes/mcp.ts` — `GET /mcp/impact_analysis` handler
- `lib/db/src/schema/node_links.ts` — `nodeLinksTable` edge table (directed: `sourceNodeId` → `targetNodeId`)
- `lib/api-zod/src/generated/types/mcpImpactAnalysisParams.ts` — query params type
- `lib/api-zod/src/generated/types/mcpImpactResult.ts` — response type

## Status

**✅ Done (one-hop only)** — Multi-hop traversal is a known gap.

## Verification Checklist

### Route Structure

- [ ] **Confirm `GET /mcp/impact_analysis` is registered** in `routes/mcp.ts`.
- [ ] **Confirm it accepts `nodeId` as a required query parameter** (integer).
- [ ] **Confirm it queries `nodeLinksTable`** for rows where `sourceNodeId = nodeId` (downstream links) OR `targetNodeId = nodeId` (upstream links).

### Traversal Depth

- [ ] **Confirm traversal is one-hop only** — the query does NOT recursively follow links.
- [ ] **Document the one-hop limitation** in the OpenAPI spec description for this endpoint (check `lib/api-spec/openapi.yaml`).

### Response Shape

- [ ] **Confirm response matches `mcpImpactResult` shape**: list of affected nodes with `id`, `name`, `layer`, `linkType`, and `direction` (upstream/downstream).

### Known Gap

- [ ] **Multi-hop traversal not implemented**: BFS/DFS that follows dependency chains transitively (e.g., A → B → C when querying A) is required for the full impact analysis specification.

### Compilation & Type Safety

- [ ] **Type Check**: `pnpm run typecheck` must pass.
- [ ] **Build Process**: `pnpm run build` must succeed.

---

## 🤖 Agent Sub-Tasks

### Route Inspection

- [ ] **Trigger `Explore`** to read the `impact_analysis` handler in `artifacts/api-server/src/routes/mcp.ts`.
  - **Validation Goal**: Confirm: (1) `nodeId` query param is validated (Zod or manual check), (2) query fetches from `nodeLinksTable` for both source and target directions, (3) result is mapped to `mcpImpactResult` schema, (4) traversal depth is exactly one hop (no recursive/iterative BFS). Report if any multi-hop logic exists.

### Schema Validation

- [ ] **Trigger `Database Schema Expert`** to inspect `lib/db/src/schema/node_links.ts`.
  - **Validation Goal**: Confirm `node_links` table has `sourceNodeId`, `targetNodeId`, `linkType` columns with correct foreign key references to the appropriate node table. Confirm an index exists on at least `sourceNodeId` for query performance.

### Gap Report for Multi-Hop

- [ ] **Trigger `Requirement Analyzer`** to compare the one-hop implementation against `docs/implementation-roadmap.md` Phase 4.2.
  - **Validation Goal**: Produce a concrete proposal for adding multi-hop BFS traversal: specify the query strategy (recursive CTE in PostgreSQL, or application-level BFS), the maximum depth limit to avoid infinite loops, and the API changes needed (e.g., `depth` query parameter).

### Project Build & Type Verification

- [ ] **Trigger `Task Verifier`** to run `pnpm run typecheck && pnpm run build`.
  - **Validation Goal**: Zero TypeScript errors, successful build.

### Database Integrity

- [ ] **Schema Definitions**: Ensure the table schemas map correctly to TypeScript types, foreign key constraints are strictly enforced, and database migrations can be generated without conflicts.

### Compilation & Type Safety

- [ ] **Type Check**: Execute `pnpm run typecheck` across the workspace to ensure strict TypeScript compliance.
- [ ] **Build Process**: Execute `pnpm run build` to ensure the artifacts compile successfully without runtime resolution errors.

---

## 🤖 Agent Sub-Tasks

### Automated Source Code Inspection

- [ ] **Trigger `Explore` or `Task Verifier`** to analyze the following paths:
  - `nodeLinksTable`
  - `mcpImpactResult.ts`
  - **Validation Goal**: Read the file contents to verify that exported functions, interfaces, schemas, and variables precisely match the defined architecture and do not contain stubbed/mocked implementations.

### Logic Deep-Dive

- [ ] **Trigger `Requirement Analyzer` & `Task Verifier`** to perform semantic checks on the logic:
  - **One-hop graph traversal via**: Trace the implementation from data ingestion/input down to the database or output response. Confirm that all required properties, valid types, and state transitions are explicitly coded.
  - **Validation Goal**: Output a strict pass/fail criteria matching the exact specification details instead of a generic 'looks good' response.

### Database Schema Validation

- [ ] **Trigger `Database Schema Expert`**:
  - Inspect the Drizzle schema definitions for correct column types, indexes, and relations.
  - **Validation Goal**: Ensure that `drizzle-kit generate` produces valid SQL without errors and that the data model perfectly aligns with application requirements.

### Project Build & Type Verification

- [ ] **Trigger `Task Verifier`**:
  - Run the terminal commands: `pnpm run typecheck` and `pnpm run build`.
  - **Validation Goal**: Prove the stability of the implementation by ensuring zero TypeScript compilation errors and successful artifact generation.
