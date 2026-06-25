# Verification Report: Item 3.4.1 — Orphan Branch Writer (Centralized w/ Advisory Locks)
- **Date**: 2026-06-25
- **Phase & Item**: Phase 7 - Orphan Branch Protocol
- **Target File**: Unknown (Derived from audit)
- **Status Update Required**: ❌ ERROR / ⚠️ WARN

### Description of Failure
5. **⚠️ L1 tags are always empty:** `buildL1TagsYaml([])` is called with an empty array on line 103. The function never queries the `l1_tags` table. The `l1_tags.yaml` file will always contain `tags: []`. This is a gap between the design (which specifies L1 tags should be written) and the implementation.


6. **⚠️ No 3-way merge support:** ADR-004 states: "the API Server performs a standard Git 3-way merge on the orphan branch. If conflicts occur, it returns 409 Conflict." The current implementation uses `git fast-import` with `deleteall`, which **overwrites** the entire tree. It does not perform a 3-way merge and cannot detect or report conflicts. This is a significant gap for concurrent client pushes.


7. **⚠️ Double advisory lock acquisition:** The `sync.ts` route acquires `pg_try_advisory_xact_lock` on lines 29-36, then calls `writeKnowledgeToOrphanBranch()` which also acquires the same lock on lines 73-81. Since `pg_try_advisory_xact_lock` is transaction-scoped and the same transaction is used (the `db.transaction()` call in sync.ts), the second lock attempt within the same transaction will succeed (Postgres advisory locks are reentrant within the same session). However, this is redundant a...


8. **⚠️ `generate.ts` does NOT call orphan branch writer:** The `POST /projects/:id/generate` endpoint creates L1/L2/L3 nodes in PostgreSQL but does NOT call `writeKnowledgeToOrphanBranch()`. This means the orphan branch is only updated when `POST /sync/push` is called, not when the generate pipeline runs. The generate pipeline is the primary way knowledge is created, so the orphan branch will be stale unless sync is explicitly called.

---

## Round 2 — Code Quality & Security Review

### Secur...


1. **🔴 Command injection risk in `buildFastImportData`:** The `fastImportData` string is constructed from user-controlled data (L2 node names, L3 titles/content, commit hashes) and passed to `git fast-import` via `printf '%s' ${JSON.stringify(fastImportData)}`. While `JSON.stringify` provides some escaping, the `filePath` in the fast-import stream is not escaped — it's derived from `slugify()` which restricts to `[a-z0-9-]`, so file paths are safe. However, the **content** of the files is embedd...


2. **⚠️ No input sanitization on L2/L3 content:** The `buildL2ModuleYaml` and `buildL3DecisionMd` functions escape double quotes (`\"`) but do not sanitize against YAML injection (e.g., `description: "!!python/object/apply:os.system ['rm -rf /']`). Since the output is YAML frontmatter in Markdown files, this is low-risk, but proper YAML serialization (using a library like `js-yaml`) would be safer than string concatenation.


3. **⚠️ `buildL1TagsYaml` is a no-op:** The function is always called with an empty array. Either the L1 tags should be queried from the database, or the function should be removed.


4. **⚠️ `slugify` is duplicated:** The `slugify` function is defined locally in `orphan-branch-writer.ts`. If other modules need slugification, this should be a shared utility.


5. **⚠️ No unit tests for `orphan-branch-writer.ts`:** There are zero tests for this module. The ADR-004 "Verifiability" section requires: "Outbox Sync Guarantee: API server integration tests MUST use `withRollback(...)` to insert a pending Git synchronization event into the Outbox table. A worker tick MUST assert the `git` command execution (via mocked `child_process` or equivalent) and the subsequent deletion/status-update of the Outbox row." No such test exists.


6. **⚠️ No integration test for `POST /sync/push`:** The sync route has no integration tests. The only integration test for the sync/generate pipeline is `generate.test.ts` which tests the generate endpoint, not the sync endpoint.


7. **⚠️ `sync.ts` has incomplete event handlers:** Line 51 says `// ... (other handlers omitted for brevity)` — the `DELETE_L3`, `CREATE_L2`, and `UPDATE_L2` event types defined in the schema (line 14) are not implemented. Only `CREATE_L3` and `UPDATE_L3` have handlers.

---

### Recommended Fix
Review the warnings and implement fixes in the corresponding source files.
