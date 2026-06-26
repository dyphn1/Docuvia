# Verification Report: Item 9.1.6 — Input Sanitization on Document Upload
- **Date**: 2026-06-26
- **Phase & Item**: Phase 2 - Input Sanitization
- **Target File**: `artifacts/api-server/src/middlewares/upload.ts`
- **Status Update Required**: ⚠️ WARN

### Description of Failure
1. **🔴 HIGH — `req.file.path` is undefined with `memoryStorage()`**: `documents.ts:108` and `ingest.ts:385` access `req.file.path` after `multer.memoryStorage()`. This causes `TypeError: path must be a string` at runtime, breaking magic byte validation, content hash computation, and file reading.

2. **🔴 HIGH — `application/octet-stream` bypasses MIME allowlist**: The OR logic (`ALLOWED_MIMETYPES.has(file.mimetype) || ALLOWED_EXTENSIONS.has(ext)`) means this generic MIME type passes regardless of extension, weakening the allowlist's intent.

3. **🟡 MEDIUM — No filename sanitization**: `originalname` is stored directly in the database without sanitization. No length limit, no stripping of path separators or control characters.

4. **🟡 MEDIUM — Inconsistent magic byte validation**: The `/documents` endpoint validates magic bytes for PDF and DOCX/PPTX, but `/projects/:id/ingest/document/upload` does not.

5. **🟡 MEDIUM — No extracted content size limit**: After parsing, the extracted text is stored in the database without size limits. A crafted document could extract megabytes of text.

6. **🟢 LOW — Error message leaks internal info**: The upload error message includes both `file.mimetype` and the parsed extension.

### Recommended Fix
1. Switch to `multer.diskStorage()` or use `req.file.buffer` directly.
2. Remove `application/octet-stream` from the MIME allowlist or change the OR logic to AND.
3. Add filename sanitization (length limit, strip path separators, normalize Unicode).
4. Apply magic byte validation consistently across all upload paths.
5. Add a size limit on extracted text content.
