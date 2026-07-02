# Verification Report: Cross-project linking

- **Date**: 2026-07-02
- **Phase & Item**: Phase 3 - Cross-project linking
- **Target File**: generate.ts
- **Status Update Required**: ⚠️ WARN

### Description of Failure
The checklist evidence points to `generate.ts` (specifically `extractSieveDecisions` function) as the implementation target for cross-project linking. However, examination of this file reveals no logic for linking entities across different projects. The function only processes decisions within the current project's context, using local L2/L3 nodes. There is no mechanism to create or resolve links between nodes belonging to distinct projects, violating the expected cross-project linking capability.

### Recommended Fix
Implement cross-project linking by:
1. Extending the `extractSieveDecisions` function to accept a project context parameter or retrieve the current project ID from the request.
2. When creating L2/L3 nodes, include a `projectId` field to associate nodes with their originating project.
3. Modify the link resolution logic to query nodes across projects when resolving references (e.g., imports, dependencies) that may point to external projects.
4. Ensure the database schema supports cross-project links (e.g., `node_links` table should allow `sourceProjectId` and `targetProjectId` fields, or use a global node ID space).
5. Update the API endpoint that invokes this function to pass the appropriate project context.