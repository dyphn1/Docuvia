# Verification Report: Server-Side Metabolism (OOMs and Scaling)
- **Date**: 2026-06-25
- **Phase & Item**: Phase 1 - Server-Side Metabolism
- **Target File**: artifacts/api-server/src/routes/metabolism.ts
- **Status Update Required**: ❌ ERROR

### Description of Failure
The metabolism route (`metabolism.ts`) contains multiple fatal scaling and security flaws:
*   **Unbounded Memory Exhaustion (OOM):** The query fetching `pendingL3Nodes` has **NO `.limit()`** and NO pagination. It fetches every pending L3 node older than 24 hours directly into Node.js memory. If the system accumulates a backlog, this single tick will pull millions of rows, immediately crashing the Node.js process via Out of Memory (OOM).
*   **Postgres Parameter Limit Crash:** The code pushes all valid IDs into `validL3Ids` and executes an `inArray(l3NodesTable.id, validL3Ids)` update. Postgres has a strict limit of 65,535 parameters per query. Passing an unbounded array will crash the database driver. 
*   **Synchronous Outer Loop Bottleneck & Rate Limiting:** The loop iterates over `nodesByProject` and sequentially awaits GitHub API calls with no batching or parallelism. There is no defense against `429 Too Many Requests`, guaranteeing the `GITHUB_TOKEN` will be blacklisted by GitHub upon the first large backlog ingestion.
*   **Leaking Admin Tokens:** The `/admin/metabolism-tick` endpoint explicitly accepts the secret via `req.query.admin_token`. Query parameters are logged in plaintext by Nginx and Express access logs. This compromises the admin secret.

### Recommended Fix
Refactor `metabolism.ts` to implement strict pagination (`.limit()` / offsets) for all DB queries, chunk database updates (e.g., using a helper to split arrays into chunks of 1000), add concurrency control (e.g., `p-limit`) for GitHub API calls with backoff logic, and remove support for `admin_token` query parameters in favor of strict `Authorization` headers.
