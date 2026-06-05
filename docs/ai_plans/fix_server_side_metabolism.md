# Implementation Plan: Fix Server-Side Metabolism & Temporal Decay

## 1. Implementation Goals

This plan addresses Phase 1 Critical Action Items 1.1 (Asynchronous Metabolism is Entirely Unimplemented) and 1.2 (Missing `last_verified_at` for Temporal Decay & Garbage Collection) from the design flaws audit.

**Verifiable Success Criteria:**
1.  **Schema Change**: `l2_nodes` and `l3_nodes` tables contain a `last_verified_at` column (with timezone). `drizzle-kit push` runs successfully.
2.  **Metabolism Endpoints**:
    *   `GET /api/metabolism-tick` (client heartbeat) and `GET /api/admin/metabolism-tick` (cron trigger) exist and return `200 OK`.
    *   A Mutex/lock mechanism prevents overlapping metabolism background jobs (Thundering Herd prevention).
3.  **Temporal Decay**: `intent-router.ts` calculates a decayed search score based on `lastVerifiedAt` before sorting results.
4.  **Feedback API**: `POST /api/search/feedback` accepts `{ nodeLayer, id }` and updates `last_verified_at` to `NOW()`.
5.  **VS Code Heartbeat**: The extension periodically polls `/api/metabolism-tick` with a configured jitter.

---

## 2. Approach / Methodology

- **Database First**: Update the Drizzle schemas to include `lastVerifiedAt`. Run DB migrations.
- **Server Routes**: Implement `artifacts/api-server/src/routes/metabolism.ts` and add it to the Express app. We will use a simple Mutex (or DB-backed lock) to ensure the metabolism logic (micro-batch jobs) does not run concurrently when multiple clients ping it.
- **Scoring Updates**: Apply an Exponential Decay formula in `artifacts/api-server/src/lib/intent-router.ts`.
  * Formula: `decayed_score = raw_score * exp(-λ * t)`, where `t` is the time elapsed since `lastVerifiedAt` (or `createdAt` if null) and `λ` is the decay constant.
- **Client Synchronization**: Establish a `setInterval`-based background heartbeat inside the VS Code client's `CentralServerClient`, combined with Math.random() jitter to spread out load.

---

## 3. Detailed Implementation Steps

### Step 3.1: Database Schema Layer (`@workspace/db`)

**Files**: 
- `lib/db/src/schema/l2_nodes.ts`
- `lib/db/src/schema/l3_nodes.ts`

**Changes**:
1.  Import `timestamp` from `drizzle-orm/pg-core` if not present.
2.  Add `lastVerifiedAt: timestamp("last_verified_at").defaultNow()` to both `l2NodesTable` and `l3NodesTable`.
3.  Update the corresponding Zod insert/update schemas to handle the new field if necessary.
4.  Verify schemas via pnpm workspace build.

### Step 3.2: API Server Layer (`@workspace/api-server`)

**File 1**: `artifacts/api-server/src/routes/metabolism.ts` (New File)
1.  Create an Express router.
2.  Implement `GET /api/metabolism-tick`:
    *   Add a local memory Mutex flag (e.g., `let isMetabolismRunning = false;`) or a Postgres advisory lock.
    *   If `isMetabolismRunning` is true, immediately return `202 Accepted` (or `409 Conflict`) to prevent Thundering Herd.
    *   If false, set to true, execute background maintenance tasks (conceptually: distillation, decay jobs), reset to false, and return `200 OK`.
3.  Implement `GET /api/admin/metabolism-tick` for forced/cron execution, utilizing the same Mutex.

**File 2**: `artifacts/api-server/src/index.ts` (or main app router)
1.  Mount the new `metabolism.ts` router under `/api`.

**File 3**: `artifacts/api-server/src/routes/search.ts` (or relevant search controller)
1.  Implement `POST /api/search/feedback`.
2.  Accept a payload specifying node IDs and their layers (`l2` or `l3`).
3.  Perform an `UPDATE` query on `l2_nodes` or `l3_nodes` setting `lastVerifiedAt = new Date()`.

**File 4**: `artifacts/api-server/src/lib/intent-router.ts`
1.  In `vectorSearchHandler`, fetch `lastVerifiedAt` along with other node data.
2.  Implement decay math before sorting:
    ```typescript
    const MS_PER_DAY = 1000 * 60 * 60 * 24;
    const HALF_LIFE_DAYS = 30; 
    const LAMBDA = Math.LN2 / HALF_LIFE_DAYS;
    
    // For each node:
    const referenceDate = node.lastVerifiedAt ?? node.createdAt;
    const daysSinceVerified = (Date.now() - referenceDate.getTime()) / MS_PER_DAY;
    const decayFactor = Math.exp(-LAMBDA * Math.max(0, daysSinceVerified));
    const finalScore = rawScore * decayFactor;
    ```
3.  Sort results by `finalScore` instead of `rawScore`.

### Step 3.3: VS Code Client Layer (`@workspace/vscode-client`)

**File 1**: `artifacts/vscode-client/src/CentralServerClient.ts`
1.  Add a `startHeartbeat()` method.
2.  Use `setInterval` combined with a randomized jitter (e.g., base delay 5 minutes ± 1 minute) to `fetch(serverUrl + '/api/metabolism-tick')`.
3.  Add a `sendFeedback(nodeId, nodeLayer)` method to trigger the `POST /api/search/feedback` endpoint.

**File 2**: VS Code UI/RAG handlers (Conceptual/Optional)
1.  After a successful generation/RAG response, extract the nodes used and call `client.sendFeedback()`.

---

## 4. Affected Packages

- `@workspace/db`: Schema migrations.
- `@workspace/api-server`: Core routing, Mutex logic, and decay algorithms.
- `@workspace/vscode-client`: Polling dispatcher and feedback triggers.