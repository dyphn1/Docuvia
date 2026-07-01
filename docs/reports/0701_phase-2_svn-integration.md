# Verification Report: SVN integration
- **Date**: 2026-07-01
- **Phase & Item**: Phase 2 - SVN integration
- **Target File**: lib/core/src/services/ingestion-pipeline.ts
- **Status Update Required**: ⚠️ WARN

### Description of Failure
The SVN ingestion pipeline incorrectly stores the diff content in the `message` column of the `commits` table instead of the dedicated `diff` column. Specifically, in `ingestion-pipeline.ts` line 152, the code constructs `fullMessage = c.diff ? "${c.message}\n\n${c.diff}" : c.message` and stores this in the `message` field, leaving the `diff` column unused. Additionally, the `c.diff` property is never populated from the SVN log, so only the commit message is stored in the `message` field, and the diff is completely omitted.

### Recommended Fix
Modify the SVN ingestion block in `lib/core/src/services/ingestion-pipeline.ts` to:
1. For each SVN commit, retrieve the diff using `svn diff -r <reversion>` (or equivalent) and store it in the `c.diff` property.
2. Then, insert the commit with:
   - `message`: truncated commit message (`c.message.slice(0, 4000)`)
   - `diff`: truncated diff content (`c.diff ? c.diff.slice(0, 4000) : null`)
3. Ensure the `diff` column is populated accordingly.