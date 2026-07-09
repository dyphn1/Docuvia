# Database Test Coverage

- **Status**: 🔲 TODO
- **Phase**: Phase 1: Core API & Database (The Metabolism Engine)
- **Evidence / Verification Target**: `lib/db/src/*.test.ts`

## Implementation Details

[`lib/db/src/index.unit.test.ts`](../../../../lib/db/src/index.unit.test.ts) and [`lib/db/src/migrate.unit.test.ts`](../../../../lib/db/src/migrate.unit.test.ts) are both trivial (one test each, mocking migration) — the cascade/unique/vector-op gap called out below is real for these two files.

However, [`lib/db/src/schema/sqlite/sqlite-schema.unit.test.ts`](../../../../lib/db/src/schema/sqlite/sqlite-schema.unit.test.ts) (not previously listed as evidence) already contains real cascade-delete tests (`projects → l2_nodes → l3_nodes → l3_node_source_commits`) and unique-constraint tests — that part of the gap is partially closed on the SQLite side. No pgvector/embedding-specific test exists anywhere in `lib/db` (consistent with the schema gap noted in [pgvector Migration](pgvector-migration.md)) — the vector-operations gap is still fully open.

### Component Description

- **Core Logic**: Cascade/unique coverage exists for SQLite (`sqlite-schema.unit.test.ts`) but not for the Postgres schema (`index.unit.test.ts`/`migrate.unit.test.ts` are still trivial). Vector-operation tests don't exist for either.
- **State Management**: Persists or queries state directly via the defined interfaces.

## Testing & Verification

- Run `pnpm test` in the relevant workspace.
- Validate the behavior locally using `docuvia` CLI or the VS Code Extension.
- Check the [Regression & Parity Testing](../../guidelines/regression-and-parity-testing.md) guidelines.
