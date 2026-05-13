# Implementation Plan: Incremental Update (Delta-Only Indexing)

**Created**: 2026-05-13  
**Priority**: High — Top remaining gap in Phase 7  
**Status**: Not started

---

## 1. Implementation Goals

Enable Docuvia to detect and ingest only **new commits / documents** since the last successful ingestion run, without reprocessing already-indexed data. This replaces the current "always fetch up to N commits and skip by hash" pattern with a persistent **checkpoint/cursor** mechanism that makes subsequent calls faster and cheaper (fewer GitHub API requests, fewer LLM tokens).

### Success Criteria

- `POST /projects/:id/ingest/git` with `{ "mode": "incremental" }` fetches only commits newer than the stored cursor.
- `POST /projects/:id/ingest/svn` with `{ "mode": "incremental" }` fetches only revisions > the stored max revision.
- `POST /projects/:id/generate` in incremental mode processes only commits NOT yet linked to an L2 node (i.e., `l2NodeId IS NULL`).
- A new `GET /projects/:id/ingest/status` endpoint exposes the current checkpoint state to the frontend.
- The frontend Project detail page shows a "Last ingested" timestamp and a "Sync (incremental)" button.

---

## 2. Current Codebase Analysis

### 2.1 Why Incremental Does Not Exist Yet

The roadmap checklist confirms: `"No event listener or delta tracking found"`.

Current flow:
1. `POST /projects/:id/ingest/git` — fetches up to `limit` commits from GitHub API (paginated). Skips commits whose SHA already exists in `commitsTable`. **No timestamp/cursor stored**.
2. `POST /projects/:id/ingest/svn` — fetches revisions between `startRevision` and `endRevision` (caller must supply range). No stored upper-bound.
3. `POST /projects/:id/generate` — queries all `valid=true` commits for the project, ordered by `createdAt desc`, limited to `maxCommits`. **No tracking of which commits have already been processed** (the `l2NodeId` column exists on `commitsTable` but is not used as a filter in the generate route).

### 2.2 Existing Schema Gaps

| Table | Missing Column |
|---|---|
| `projectsTable` | `lastGitIngestedAt` (timestamp) — last successful Git ingest cursor |
| `projectsTable` | `lastSvnRevision` (integer) — highest SVN revision successfully ingested |
| `commitsTable` | `processedAt` (timestamp, nullable) — set when commit is consumed by the generate pipeline |

No dedicated `ingest_checkpoints` table exists, but it is not needed — augmenting `projectsTable` is sufficient and keeps queries simple.

### 2.3 Existing Logic That Already Helps

- `commitsTable.hash` uniqueness check in Git ingest prevents duplicate rows.
- `commitsTable.l2NodeId` column exists and is set when a commit is linked to a generated L2 node — this is the natural "processed" marker.
- `generate.ts` already filters `valid = true`; we can add `l2NodeId IS NULL` to limit scope.

---

## 3. Architecture Diagram

```
POST /ingest/git?mode=incremental
         │
         ▼
  Read project.lastGitIngestedAt (cursor)
         │
         ▼
  GitHub API: GET commits?since=<cursor>&sha=<branch>
         │
         ▼
  Insert new commits (skip if hash exists)
         │
         ▼
  Update project.lastGitIngestedAt = now()
         │
         ▼
  Return { commitsIngested, commitsSkipped, cursor }

POST /generate (always incremental by default)
         │
         ▼
  SELECT commits WHERE valid=true AND l2NodeId IS NULL
  LIMIT maxCommits ORDER BY createdAt ASC   ← oldest-first for causal ordering
         │
         ▼
  Run L1 → L2 → L3 pipeline
         │
         ▼
  UPDATE commits SET l2NodeId=<id>, processedAt=now()
  for each commit consumed in this run
```

---

## 4. Detailed Implementation Steps

### Step 1 — DB Schema Changes (`lib/db/`)

**File: `lib/db/src/schema/projects.ts`**

Add two nullable columns to `projectsTable`:

```typescript
lastGitIngestedAt: timestamp("last_git_ingested_at"),   // Git cursor
lastSvnRevision: integer("last_svn_revision"),           // SVN high-water mark
```

**File: `lib/db/src/schema/commits.ts`**

Add one nullable column to `commitsTable`:

```typescript
processedAt: timestamp("processed_at"),  // set when consumed by generate pipeline
```

**File: `lib/db/drizzle.config.ts`** — No change needed; Drizzle push will pick up new columns.

**Drizzle migration command** (to be run after schema changes):

```bash
pnpm --filter @workspace/db db:push
```

> Note: Since this project uses `drizzle-kit push` (not migrations), no migration file is generated; the command alters the live DB directly.

---

### Step 2 — Backend Route: Git Incremental Ingest (`artifacts/api-server/`)

**File: `artifacts/api-server/src/routes/ingest.ts`**

#### 2a. Extend `GitIngestSchema`

```typescript
const GitIngestSchema = z.object({
  repoUrl: z.string().optional(),
  branch: z.string().optional().default("main"),
  limit: z.number().optional().default(100),
  githubToken: z.string().optional(),
  mode: z.enum(["full", "incremental"]).optional().default("full"),
});
```

#### 2b. Modify `POST /projects/:id/ingest/git` handler

After parsing the body, check `body.mode`:

- **`"incremental"`**: Pass the stored `project.lastGitIngestedAt` as the `since` query parameter to the GitHub API (`GET /repos/{owner}/{repo}/commits?since=<ISO8601>`). This makes GitHub return only commits after that timestamp. Still perform the SHA-exists guard as a safety net.
- **`"full"`** (default): Existing behavior, no change.

After successful insert loop, update cursor:

```typescript
await db
  .update(projectsTable)
  .set({ lastGitIngestedAt: new Date(), updatedAt: new Date() })
  .where(eq(projectsTable.id, projectId));
```

Return the cursor in the response:

```typescript
return res.json({
  commitsIngested: ingested,
  commitsSkipped: skipped,
  totalFetched: allCommits.length,
  cursor: new Date().toISOString(),  // new field
  mode: body.mode,
});
```

---

### Step 3 — Backend Route: SVN Incremental Ingest (`artifacts/api-server/`)

**File: `artifacts/api-server/src/routes/ingest.ts`**

#### 3a. Extend `IngestSvnBody` (in `lib/api-zod/`)

Add an optional `mode` field: `z.enum(["full", "incremental"]).optional().default("full")`.

Since `IngestSvnBody` is generated by Orval from OpenAPI, the change must be made in `lib/api-spec/openapi.yaml` first (see Step 5), then regenerated.

#### 3b. Modify `POST /projects/:id/ingest/svn` handler

- **`"incremental"`**: Set `startRevision = (project.lastSvnRevision ?? 0) + 1`. Ignore any `startRevision` from the request body.
- **`"full"`**: Existing behavior (caller supplies range).

After successful ingest, update the high-water mark:

```typescript
const maxRevision = Math.max(...revisions.map(r => r.revision));
await db
  .update(projectsTable)
  .set({ lastSvnRevision: maxRevision, updatedAt: new Date() })
  .where(eq(projectsTable.id, projectId));
```

Return in response:

```typescript
return res.json({
  commitsIngested: ingested,
  commitsSkipped: skipped,
  lastRevision: maxRevision,   // new field
  mode: body.mode,
});
```

---

### Step 4 — Incremental Generate Pipeline (`artifacts/api-server/`)

**File: `artifacts/api-server/src/routes/generate.ts`**

#### 4a. Extend `GenerateInputSchema`

```typescript
const GenerateInputSchema = z.object({
  model: z.string().optional(),
  maxCommits: z.number().optional().default(50),
  mode: z.enum(["full", "incremental"]).optional().default("incremental"),
});
```

#### 4b. Modify the commit fetch query in `POST /projects/:id/generate`

**Current** (Step 1 of pipeline):
```typescript
const validCommits = await db
  .select()
  .from(commitsTable)
  .where(and(eq(commitsTable.projectId, projectId), eq(commitsTable.valid, true)))
  .orderBy(sql`${commitsTable.createdAt} desc`)
  .limit(maxCommits);
```

**New** (with incremental mode):
```typescript
const isIncremental = body.mode === "incremental";
const validCommits = await db
  .select()
  .from(commitsTable)
  .where(
    and(
      eq(commitsTable.projectId, projectId),
      eq(commitsTable.valid, true),
      isIncremental ? isNull(commitsTable.processedAt) : undefined,
    )
  )
  .orderBy(sql`${commitsTable.createdAt} asc`)   // oldest first for causal ordering
  .limit(maxCommits);
```

> **Note on ordering change**: Switched from `desc` to `asc` in incremental mode to process oldest unprocessed commits first, preserving causal dependency ordering. In `"full"` mode, keep `desc` to match current behavior.

#### 4c. Mark commits as processed after pipeline completes

At the end of the generate pipeline (after L3 nodes are persisted and before returning), add:

```typescript
// Mark all consumed commits as processed
const processedHashes = validCommits.map(c => c.hash);
for (const hash of processedHashes) {
  await db
    .update(commitsTable)
    .set({ processedAt: new Date() })
    .where(and(
      eq(commitsTable.projectId, projectId),
      eq(commitsTable.hash, hash),
    ));
}
```

> This can be batched using `inArray(commitsTable.hash, processedHashes)` for efficiency.

#### 4d. Update generate response to include processed count

Add `commitsProcessed` (already in response) is already correct; also add:

```typescript
mode: body.mode,
unprocessedRemaining: isIncremental
  ? await db.$count(commitsTable, and(eq(commitsTable.projectId, projectId), eq(commitsTable.valid, true), isNull(commitsTable.processedAt)))
  : 0,
```

---

### Step 5 — New Status Endpoint (`artifacts/api-server/`)

**File: `artifacts/api-server/src/routes/ingest.ts`** (add new route)

```
GET /projects/:id/ingest/status
```

Response payload:

```json
{
  "projectId": 1,
  "gitCursor": "2026-05-10T12:00:00.000Z",
  "lastSvnRevision": 1453,
  "unprocessedCommits": 12,
  "totalCommits": 340,
  "lastGeneratedAt": "2026-05-12T08:30:00.000Z"
}
```

Implementation: Single DB query joining `projectsTable` with a count of `commitsTable WHERE valid=true AND processedAt IS NULL`.

---

### Step 6 — OpenAPI Spec Changes (`lib/api-spec/`)

**File: `lib/api-spec/openapi.yaml`**

#### 6a. Extend `GitIngestInput` schema

```yaml
GitIngestInput:
  type: object
  properties:
    repoUrl:
      type: string
    branch:
      type: string
      default: main
    limit:
      type: integer
      default: 100
    githubToken:
      type: string
    mode:
      type: string
      enum: [full, incremental]
      default: full
      description: "full = fetch all (up to limit); incremental = fetch only since last cursor"
```

#### 6b. Extend `GitIngestResult` schema

```yaml
GitIngestResult:
  type: object
  required: [commitsIngested, commitsSkipped, totalFetched]
  properties:
    commitsIngested:
      type: integer
    commitsSkipped:
      type: integer
    totalFetched:
      type: integer
    cursor:
      type: string
      format: date-time
      description: ISO8601 timestamp of this ingest run (new cursor for next incremental call)
    mode:
      type: string
      enum: [full, incremental]
```

#### 6c. Extend `SvnIngestInput` schema

```yaml
SvnIngestInput:
  type: object
  required: [svnUrl]
  properties:
    svnUrl:
      type: string
    startRevision:
      type: integer
    endRevision:
      oneOf:
        - type: integer
        - type: string
          enum: [HEAD]
    username:
      type: string
    password:
      type: string
    mode:
      type: string
      enum: [full, incremental]
      default: full
```

#### 6d. Extend `SvnIngestResult` schema

Add `lastRevision: integer` and `mode: string` fields.

#### 6e. Extend `GenerateInput` schema

```yaml
GenerateInput:
  type: object
  properties:
    model:
      type: string
    maxCommits:
      type: integer
      default: 50
    mode:
      type: string
      enum: [full, incremental]
      default: incremental
```

#### 6f. Extend `GenerateResult` schema

Add `mode: string` and `unprocessedRemaining: integer` fields.

#### 6g. Add new `GET /projects/{id}/ingest/status` path

```yaml
/projects/{id}/ingest/status:
  get:
    operationId: getIngestStatus
    tags: [ingest]
    summary: Get the current ingestion checkpoint and delta state for a project
    parameters:
      - name: id
        in: path
        required: true
        schema:
          type: integer
    responses:
      "200":
        description: Ingestion status
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/IngestStatus"
      "404":
        description: Project not found

IngestStatus:
  type: object
  required: [projectId, unprocessedCommits, totalCommits]
  properties:
    projectId:
      type: integer
    gitCursor:
      type: string
      format: date-time
      nullable: true
    lastSvnRevision:
      type: integer
      nullable: true
    unprocessedCommits:
      type: integer
    totalCommits:
      type: integer
    lastGeneratedAt:
      type: string
      format: date-time
      nullable: true
```

---

### Step 7 — Orval Codegen (after OpenAPI changes)

**File: `lib/api-spec/orval.config.ts`** — no change needed.

Run codegen from the workspace root:

```bash
pnpm --filter @workspace/api-spec codegen
```

This regenerates:
- `lib/api-zod/src/generated/` — Zod validators (including `IngestStatus`, updated input/result types)
- `lib/api-client-react/src/generated/` — React Query hooks (`useGetIngestStatus`, updated mutation hooks)

---

### Step 8 — Frontend UI Changes (`artifacts/kg-engine/`)

**Target page**: `artifacts/kg-engine/src/pages/projects/[id].tsx` (Project detail page)

#### 8a. Add "Ingest Status" card to the project overview tab

Display:
- **Git cursor**: "Last Git sync: May 10, 2026 12:00 UTC"
- **SVN last revision**: "Last SVN revision: r1453"
- **Delta backlog**: "12 unprocessed commits pending generation"

Use the generated `useGetIngestStatus(projectId)` hook.

#### 8b. Add "Sync (incremental)" button

Replace or augment the existing "Ingest" button with a dropdown:

```
[ Sync ▾ ]
  ├── Incremental sync (new commits only)  ← default
  └── Full re-ingest
```

On click, call `useIngestGit` mutation with `{ mode: "incremental" }` or `{ mode: "full" }`.

After success, invalidate `getIngestStatus` and `getProjectById` queries.

#### 8c. Add "Generate (delta)" button

Alongside or replacing existing "Generate" button, add `mode: "incremental"` as the default payload in `useGenerate` mutation calls. Show a badge with unprocessed commit count.

**New file to create**: `artifacts/kg-engine/src/components/IngestStatusCard.tsx`

Props:
```typescript
interface IngestStatusCardProps {
  projectId: number;
}
```

Renders the status card and action buttons described above using shadcn/ui `Card`, `Badge`, `Button`, and `DropdownMenu` components.

---

## 5. File List

### Files to Modify

| File | Change |
|---|---|
| `lib/db/src/schema/projects.ts` | Add `lastGitIngestedAt`, `lastSvnRevision` columns |
| `lib/db/src/schema/commits.ts` | Add `processedAt` column |
| `lib/api-spec/openapi.yaml` | Extend `GitIngestInput`, `GitIngestResult`, `SvnIngestInput`, `SvnIngestResult`, `GenerateInput`, `GenerateResult`; add `GET /projects/{id}/ingest/status` + `IngestStatus` schema |
| `artifacts/api-server/src/routes/ingest.ts` | Add `mode` to Git/SVN ingest logic, update cursor after ingest, add `GET /projects/:id/ingest/status` route |
| `artifacts/api-server/src/routes/generate.ts` | Add `mode` to schema, filter by `processedAt IS NULL` in incremental mode, mark commits `processedAt` after pipeline |
| `artifacts/kg-engine/src/pages/projects/[id].tsx` | Add `IngestStatusCard`, update ingest/generate buttons to pass `mode` |

### Files to Create

| File | Purpose |
|---|---|
| `artifacts/kg-engine/src/components/IngestStatusCard.tsx` | New UI component for ingestion status display and action buttons |

### Auto-Generated Files (do not edit manually)

| File | Regenerated by |
|---|---|
| `lib/api-zod/src/generated/` | `pnpm --filter @workspace/api-spec codegen` |
| `lib/api-client-react/src/generated/` | same codegen command |

---

## 6. Build Verification Commands

Run these in order after implementation:

```bash
# 1. Push schema changes to DB
pnpm --filter @workspace/db db:push

# 2. Regenerate Zod validators + React Query hooks from updated OpenAPI spec
pnpm --filter @workspace/api-spec codegen

# 3. Type-check all packages
pnpm typecheck

# 4. Build API server
pnpm --filter @workspace/api-server build

# 5. Build frontend
pnpm --filter @workspace/kg-engine build

# 6. Lint entire workspace
pnpm lint
```

---

## 7. Edge Cases & Constraints

| Scenario | Handling |
|---|---|
| First-ever incremental Git ingest (no cursor yet) | `project.lastGitIngestedAt` is `null`; omit `since=` param from GitHub API call → behaves like full ingest; set cursor on completion |
| First-ever incremental SVN ingest (no high-water mark) | `project.lastSvnRevision` is `null`; default `startRevision = 1` → full range; set high-water mark on completion |
| No new commits since last cursor | GitHub returns empty array; respond with `{ commitsIngested: 0, commitsSkipped: 0, totalFetched: 0 }` |
| Generate called when no unprocessed commits exist | Return early with zeros (same as current empty-commits early-exit) |
| Full re-ingest requested after incremental runs | Use `mode: "full"` which bypasses cursor; does NOT reset `processedAt` on existing commits (they remain processed); effectively adds only truly new commits |
| Concurrent ingest calls | Project `status: "indexing"` guard in generate already handles this; ingest route does not yet set `indexing` — consider adding a guard or document this as a known limitation |

---

## 8. Affected Workspace Packages

| Package | Change Type |
|---|---|
| `@workspace/db` | Schema change (new columns) |
| `@workspace/api-spec` | OpenAPI spec update |
| `@workspace/api-zod` | Auto-regenerated |
| `@workspace/api-client-react` | Auto-regenerated |
| `@workspace/api-server` | Route logic changes |
| `@workspace/kg-engine` | New UI component + page update |
