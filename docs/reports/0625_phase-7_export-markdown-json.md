# Verification Report: 6.5.2 — Markdown Export
- **Date**: 2026-06-25
- **Phase & Item**: Phase 7 - Export Markdown Json
- **Target File**: Unknown (Derived from audit)
- **Status Update Required**: ❌ ERROR / ⚠️ WARN

### Description of Failure
1. **🔴 Hardcoded fallback userId.** `export.ts:18`: `const userId = (req as any).user?.id 


2. **🟡 No Zod validation on path parameter.** The endpoint uses raw `Number(req.params.id)` without a Zod validator. While `NaN` produces a 404 (no project found with NaN ID), this bypasses the project's standard validation pattern. The OpenAPI spec defines the `id` parameter as `type: integer`, but no generated Zod validator is applied in the route handler.


3. **🟡 No error handling during stream.** The streaming loop (export.ts:143-175) has no `try/catch`. If a database error occurs mid-stream, the client receives a truncated file. The `res.on('error')` event is not handled.


4. **🟡 N+1 query pattern.** For each L2 node in the batch, a separate query fetches its L3 nodes (export.ts:160-163). For projects with many L2 nodes, this produces N+1 queries per batch.

### Recommended Fix
Review the warnings and implement fixes in the corresponding source files.
