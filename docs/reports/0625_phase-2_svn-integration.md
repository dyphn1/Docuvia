# Design Verification Report — Item 1.2.2
- **Date**: 2026-06-25
- **Phase & Item**: Phase 2 - Svn Integration
- **Target File**: Unknown (Derived from audit)
- **Status Update Required**: ❌ ERROR / ⚠️ WARN

### Description of Failure
1. **❌ Missing `VcsIngestAdapter` interface and `SvnIngestAdapter` class.** The design (08-cutting-concepts.md §8.3 POP) explicitly defines a `VcsIngestAdapter` interface:

   ```
   interface VcsIngestAdapter {
     ingest(input: IngestInput): Promise<IngestResult>;
   }
   ```

   Neither this interface nor a `SvnIngestAdapter` implementation exists anywhere in the codebase. The SVN ingestion logic is embedded directly in the `ingest.ts` route handler rather than being abstracted behind the ad...


2. **⚠️ URL validation regex excludes `svn+ssh://`.** The route handler (line 117) validates:

   ```typescript
   if (!/^http?:\/\/|^svn:\/\//.test(svnUrl))
   ```

   This allows `http://`, `https://`, and `svn://` but **rejects `svn+ssh://`**, which is explicitly listed as a valid example in the OpenAPI schema description: "SVN repository URL (e.g. svn+ssh://... or https://...)". This is a spec-implementation mismatch.


3. **⚠️ `processIngestion` for SVN stores `diff` concatenated into `message`.** At line 136-141:
   ```typescript
   const fullMessage = c.diff ? `${c.message}\n\n${c.diff}` : c.message;
   // ...
   message: fullMessage.slice(0, 4000),
   ```
   Git ingestion stores only `c.message` in the message field (line 93). SVN conflates the commit message with the full diff, which means:
   - The actual commit message is lost after 4000 chars when diff is large.
   - Query results will show diffs instea...


1. **⚠️ No transactional safety for SVN commits (unlike Git).** The Git path in `processIngestion` (line 72) wraps its batch in `db.transaction()`. The SVN path (line 118) processes each revision individually without any transaction wrapper. If the process crashes mid-batch, some revisions will be inserted and others won't, with no rollback. The route-level `flushBatch` does batch commits into `processIngestion`, but `processIngestion` itself does not wrap the loop body for SVN type in a transac...


2. **⚠️ `password` visible in process arguments.** The password is passed as a command-line argument to `svn` via both `spawn` and `execFile`. While this avoids shell injection, on some systems command-line arguments are visible to all users via `ps` or `/proc`. Consider using SVN's `--password-file` option or environment variables if supported.


3. **⚠️ OpenAPI response codes incomplete.** The route can return:
   - `200` — documented ✅
   - `400` (validation error) — **not documented** in OpenAPI spec
   - `404` — documented ✅
   - `502` (SVN log failure) — **not documented** in OpenAPI spec
   - `500` (from `processIngestion` errors) — **not documented** in OpenAPI spec


4. **⚠️ Redundant Zod parsing.** Line 108 uses `IngestSvnBody.parse(req.body)` for the full body, but line 113 then parses `mode` again separately with `SvnModeSchema.parse(req.body)`. The `mode` is already part of `SvnIngestInput` and validated by `IngestSvnBody`. This is redundant.


5. **⚠️ No error response standardization for Zod failures.** Lines 109-111 return the raw Zod error object as `details` in the 400 response. This leaks internal validation details that could reveal schema structure.


6. **⚠️ `response` object is not typed.** The route handler parameter `res` is not typed as `express.Response`, losing type safety for response methods.

---

### Recommended Fix
Review the warnings and implement fixes in the corresponding source files.
