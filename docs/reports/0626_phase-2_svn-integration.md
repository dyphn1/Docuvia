# Verification Report: Item 1.2.2/1.2.5 — SVN Integration
- **Date**: 2026-06-26
- **Phase & Item**: Phase 2 - SVN Integration
- **Target File**: `artifacts/api-server/src/lib/svn-client.ts`
- **Status Update Required**: ⚠️ WARN

### Description of Failure
1. **🟡 MEDIUM — Diff concatenated into `message` field (architecture drift)**: `ingestion-pipeline.ts` line 145 constructs `fullMessage = c.diff ? \`${c.message}\n\n${c.diff}\` : c.message`, storing the combined blob in `commitsTable.message` (truncated to 4000 chars). This violates ADR-014 (Database-as-IPC): diffs should be separately indexed, not blob-concatenated.

2. **🟡 MEDIUM — No `diff` column in `commitsTable`**: Both SVN and Git lose diff context when message exceeds 4KB. The schema has no dedicated `diff` column.

3. **🟡 MEDIUM — URL validation regex excludes `svn+ssh://`**: Route handler validates `/^https?:\/\/|^svn:\/\//` but the OpenAPI schema advertises `svn+ssh://` as a valid example.

4. **🟡 MEDIUM — No transactional safety for SVN commits**: The Git path wraps its batch in `db.transaction()`. The SVN path processes each revision individually without any transaction wrapper.

5. **🟡 MEDIUM — No auth on SVN ingestion route**: Any client can trigger SVN ingestion for any project. SVN credentials are forwarded as plaintext in the request body.

6. **🟡 MEDIUM — No dedicated SVN test coverage**: Zero unit or integration tests for SVN ingestion.

7. **🟢 LOW — Password visible in process arguments**: Password passed as CLI argument to `svn` via `spawn`, visible via `ps` or `/proc`.

8. **🟢 LOW — SVN ingestion uses per-row INSERT without transaction batching**: Git uses batched transactions; SVN creates N individual INSERT statements.

### Recommended Fix
1. Add a dedicated `diff` column to `commitsTable` and store diffs separately from messages.
2. Update URL validation regex to include `svn+ssh://`.
3. Wrap SVN batch processing in `db.transaction()`.
4. Add authentication middleware to the SVN ingestion route.
5. Add unit tests for `getSvnLog` and `getSvnDiff` with mock SVN CLI fixtures.
6. Use `--password-file` or environment variables instead of CLI arguments for credentials.
