# Verification Report: SVN integration
- **Date**: 2026-07-01
- **Phase & Item**: Phase 2 - SVN integration
- **Target File**: lib/core/src/services/ingestion-pipeline.ts
- **Status Update Required**: WARN

### Description of Failure
The SVN ingestion pipeline incorrectly stores the diff content in the `message` column of the `commits` table instead of the dedicated `diff` column. Specifically, in `ingestion-pipeline.ts` line 152, the code constructs `fullMessage = c.diff ? "${c.message}\n\n${c.diff}" : c.message` and stores this in the `message` field, leaving the `diff` column unused. This violates the database schema design where `message` should contain only the commit message and `diff` should contain the diff content.

### Recommended Fix
Modify the SVN ingestion block in `lib/core/src/services/ingestion-pipeline.ts` (lines 154-162) to:
1. Store the commit message in the `message` column (truncated to 4000 chars if needed)
2. Store the diff in the `diff` column (truncated to 4000 chars if needed)
3. Remove the concatenation of diff into message
Example fix:
```diff
-      const fullMessage = c.diff ? "${c.message}\n\n${c.diff}" : c.message;
-
-      await txParams.insert(commitsTable).values({
-        projectId,
-        hash: `svn:R${c.revision}`,
-        message: fullMessage.slice(0, 4000),
-        author: c.author,
-        valid,
-        revision: c.revision,
-        vcsType: "svn",
-      });
+      await txParams.insert(commitsTable).values({
+        projectId,
+        hash: `svn:R${c.revision}`,
+        message: c.message ? c.message.slice(0, 4000) : "",
+        author: c.author,
+        valid,
+        revision: c.revision,
+        diff: c.diff ? c.diff.slice(0, 4000) : null,
+        vcsType: "svn",
+      });
```