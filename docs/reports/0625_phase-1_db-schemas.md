# Verification Report: DB Schemas (Unindexed Cascades)
- **Date**: 2026-06-25
- **Phase & Item**: Phase 1 - Core DB Schemas
- **Target File**: lib/db/src/schema/*.ts
- **Status Update Required**: ❌ ERROR

### Description of Failure
While `ON DELETE CASCADE` is used extensively (e.g., on `projectId` and `l2NodeId`), the schema definitions omit foreign key indexes. In Drizzle ORM, `.references(() => parentTable.id, { onDelete: "cascade" })` creates the foreign key constraint, but it **does not** automatically create an index on the column. You have to explicitly declare indexes in the third argument of `pgTable` (e.g., `(table) => ({ idx: index("...").on(table.projectId) })`).

Aside from `contentHashIdx` in `documents.ts`, the foreign keys are entirely unindexed. If a user deletes a project in `projectsTable`, Postgres must perform a **full table scan** on `commits`, `l2_nodes`, `l3_nodes`, and `documents` to find the child records to cascade delete. This will cause massive database locks, CPU spikes, and deadlocks in production.

### Recommended Fix
Inject `index()` declarations into all schema files (`commits.ts`, `l2_nodes.ts`, `l3_nodes.ts`, etc.) for every foreign key column to optimize `ON DELETE CASCADE` queries.
