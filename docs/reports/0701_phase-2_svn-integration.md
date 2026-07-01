# Verification Report: SVN integration
- **Date**: 2026-07-01
- **Phase & Item**: Phase 2 - SVN integration
- **Target File**: lib/core/src/services/ingestion-pipeline.ts
- **Status Update Required**: ⚠️ WARN

### Description of Failure
The SVN ingestion pipeline stores the diff content in the `message` column of the `commits` table instead of the dedicated `diff` column. The `c.diff` property is never populated from the SVN log (as the `getSvnLog` function in `svn-client.ts` does not fetch diffs), so only the commit message is stored, and the diff is completely omitted. This results in loss of diff information for SVN commits.

### Recommended Fix
Modify the SVN ingestion logic to store the diff in a dedicated `diff` column. Specifically:
1. Ensure the `commits` table has a `diff` column (if not already present).
2. In the SVN processing block, split the `c.diff` from the commit message and store it in the `diff` column.
3. Update the `SvnCommitItem` interface to ensure the `diff` field is populated by the `getSvnLog` function or by calling `getSvnDiff` for each revision.
4. Adjust the database insert to include the `diff` field.