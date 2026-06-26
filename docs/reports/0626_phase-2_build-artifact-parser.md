# Verification Report: Item 1.2.4 — Build Artifact Parser
- **Date**: 2026-06-26
- **Phase & Item**: Phase 2 - Build Artifact Parser
- **Target File**: `artifacts/api-server/src/middlewares/upload.ts`
- **Status Update Required**: ❌ ERROR

### Description of Failure
1. **🔴 CRITICAL — `req.file.path` undefined with `memoryStorage()`**: Both `/projects/:id/ingest/build-artifact` (`ingest.ts:421`) and `/documents` POST (`documents.ts:106`) access `req.file.path` after `multer.memoryStorage()`. Since memoryStorage provides `buffer` not `path`, both endpoints crash at runtime on every request.

2. **🔴 CRITICAL — `contentHash` not computed on working `/document/upload` path**: ADR-12 requires `contentHash` (SHA-256) at ingestion time for deduplication. The working upload endpoint skips this entirely.

3. **🟡 MEDIUM — No magic byte validation**: The `fileFilter` only checks MIME type and extension — it does not validate file signature bytes. A malicious file with a `.pdf` extension but non-PDF content would pass.

4. **🟡 MEDIUM — Zero test coverage**: No test files for upload, build-artifact parsing, or ingest artifact flow.

5. **🟡 MEDIUM — Project name hardcoded**: `ingest.ts:429` uses `Project ${projectId}` as a hardcoded name.

6. **🟡 MEDIUM — Inconsistent processing between endpoints**: The `/build-artifact` endpoint strips ANSI codes and computes hashes that `/document/upload` does not, leading to inconsistent indexing.

### Recommended Fix
1. Switch to `multer.diskStorage()` or use `req.file.buffer` directly in all route handlers.
2. Compute `contentHash` on all upload paths for ADR-12 deduplication compliance.
3. Add magic byte validation for PDF (`%PDF-`) and ZIP-based Office formats (`PK\x03\x04`).
4. Add integration tests for build-artifact upload flow.
5. Fetch actual project name from DB instead of hardcoding.
