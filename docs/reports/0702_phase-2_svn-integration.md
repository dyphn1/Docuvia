# Verification Report: SVN integration
- **Date**: 2026-07-02
- **Phase & Item**: Phase 2 - SVN integration
- **Target File**: lib/core/src/services/ingestion-pipeline.ts
- **Status Update Required**: ⚠️ WARN

### Description of Failure
The SVN ingestion pipeline stores the diff content in the `message` column of the `commits` table instead of the dedicated `diff` column. The `c.diff` property is never populated from the SVN log (as the `getSvnLog` function in `svn-client.ts` does not fetch diffs), so only the commit message is stored, and the diff is completely omitted. This results in loss of diff information for SVN commits.

### Recommended Fix
Modify the SVN ingestion logic to store the diff in a dedicated `diff` column. Specifically:
1. Ensure the `commits` table has a `diff` column (it does).
2. In the SVN processing block, use the `c.diff` field and store it in the `diff` column.
3. Update the `SvnCommitItem` interface to ensure the `diff` field is populated by the `getSvnLog` function or by calling `getSvnDiff` for each revision.
4. Adjust the database insert to include the `diff` field.

### Changes Since Last Verification
| Change | Impact |
|--------|--------|
| No code changes since last verification (commit hashes identical) | None |

**Net change:** No code changes since 2026-07-02. All findings are carried forward.

---
## Findings Summary
| # | Severity | Category | Finding | Status |
|---|----------|----------|---------|--------|
| 1 | 🟡 | Logic | SVN diff not stored in dedicated column | Unchanged |
|   |   |   |   |   |
---
## Overall Verdict
**⚠️ WARN**
The SVN ingestion still does not store diffs in the dedicated `diff` column, leading to loss of diff data for SVN commits.