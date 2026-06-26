# Verification Report: Item 1.2.3 — Document Upload and Parsing
- **Date**: 2026-06-26
- **Phase & Item**: Phase 2 - Document Upload
- **Target File**: `artifacts/api-server/src/middlewares/upload.ts`
- **Status Update Required**: ⚠️ WARN

### Description of Failure
1. **🔴 HIGH — `multer.memoryStorage()` with disk-based reads causes runtime crash**: `upload.ts` uses `multer.memoryStorage()` (stores file in `req.file.buffer`), but `routes/documents.ts` and `ingest.ts` access `req.file.path` (undefined with memoryStorage). This causes `ENOENT` or `TypeError` at runtime on every upload request.

2. **🟡 MEDIUM — Binary content stored as document text for PDF/DOCX/PPTX**: The upload route reads all file types as `utf-8` text. For binary formats, this produces garbled output. The `extractText()` function exists but is never called.

3. **🟡 MEDIUM — Hardcoded fallback user ID**: `routes/documents.ts` line 91: `const uploadedBy = (req as any).user?.id || 1` — unauthenticated uploads are silently attributed to user 1.

4. **🟡 MEDIUM — `POST /documents` missing from OpenAPI spec**: The endpoint exists in the route handler but is not documented in `openapi.yaml`, violating the API-First principle.

5. **🟡 MEDIUM — No tests for document upload or parsing**: Zero test coverage for upload, type detection, text extraction, or magic byte validation.

6. **🟢 LOW — `application/octet-stream` in allowed MIME types**: Generic binary MIME type could allow unexpected file types through if the extension check passes.

### Recommended Fix
1. Switch to `multer.diskStorage({ dest: os.tmpdir() })` or use `req.file.buffer` directly in route handlers.
2. Call `extractText()` for binary formats (PDF/DOCX/PPTX) during upload.
3. Remove hardcoded user ID fallback — reject unauthenticated requests or use `null`.
4. Add `POST /documents` to `openapi.yaml` and run codegen.
5. Add integration tests for document upload and parsing.
