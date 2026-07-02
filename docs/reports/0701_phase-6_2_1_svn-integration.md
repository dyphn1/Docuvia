# Verification Report: SVN Integration
- **Date**: 2026-07-02
- **Phase & Item**: Phase 6 - SVN Integration
- **Target File**: ingest.ts
- **Status Update Required**: ⚠️ WARN

### Description of Failure
The SVN integration in `ingest.ts` stores the diff in the commit message field instead of the dedicated `diff` column in the `commits` table. Specifically, in the `processIngestion` function in `lib/core/src/services/ingestion-pipeline.ts`, the SVN commit item's `diff` is concatenated with the commit message and stored in the `message` column, leaving the `diff` column unused. This causes truncation of the combined message/diff to 4000 characters and prevents efficient querying of diffs.

### Recommended Fix
Modify the SVN insertion logic in `lib/core/src/services/ingestion-pipeline.ts` to store the commit message in the `message` column and the diff in the `diff` column, both truncated to 4000 characters if necessary. Similarly, update the Git insertion logic to store the diff in the `diff` column for consistency. The changes should be:
1. For SVN: 
   - `message: c.message.slice(0, 4000)`
   - `diff: c.diff ? c.diff.slice(0, 4000) : null`
2. For Git:
   - `message: c.message.slice(0, 4000)`
   - `diff: c.diff ? c.diff.slice(0, 4000) : null`
Additionally, ensure the `commits` table schema retains the `diff` column as nullable text.