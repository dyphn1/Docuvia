# Verification Report: Review Tasks (IDOR Vulnerability)
- **Date**: 2026-06-25
- **Phase & Item**: Phase 6 - Review resolution workflow
- **Target File**: artifacts/api-server/src/routes/review_tasks.ts
- **Status Update Required**: ❌ ERROR

### Description of Failure
The `PATCH /review-tasks/:id` endpoint blindly trusts the `id` provided in the URL parameter. It immediately runs an `UPDATE` query on `reviewTasksTable` using this ID. There is **zero authorization checking** to verify that the user resolving the task has the correct permissions, or even if the task belongs to a project the user has access to. 

An attacker can iterate over integer IDs (e.g., `/review-tasks/1`, `/review-tasks/2`) and send `{"status": "approved"}` to resolve or modify Review Tasks belonging to other users' projects, poisoning their knowledge graph.

### Recommended Fix
Inject a strict validation check inside the route to join the `reviewTasksTable` to the `projectsTable` and verify that `project.ownerId === req.user.id` before executing the `UPDATE`.
