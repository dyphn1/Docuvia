# GitHub PR Integration — AI Implementation Plan

> **Feature**: GitHub Pull Request Integration  
> **Priority**: Highest (Phase 7 remaining)  
> **Status**: Not started  
> **Created**: 2026-05-13  
> **Target packages**: `lib/db`, `lib/api-spec`, `artifacts/api-server`, `artifacts/kg-engine`

---

## 1. Implementation Goals

Build an end-to-end GitHub PR Integration that:

1. **Receives GitHub webhook events** for pull requests (opened, synchronized, merged)
2. **Ingests PR commits** into the existing knowledge graph pipeline automatically
3. **Runs the L1→L2→L3 generation pipeline** triggered by each PR event
4. **Generates an AI impact summary** of which L2 modules and L3 decisions the PR touches
5. **Posts the summary back to the PR** as a GitHub comment on merge
6. **Exposes a PR management API** and frontend page to browse all PRs and their knowledge graph impact

---

## 2. Approach / Methodology

### 2.1 Webhook-First Design

GitHub sends push-based webhook events. The API server registers a `POST /webhooks/github/:projectId` endpoint that:

- Validates the `X-Hub-Signature-256` HMAC-SHA256 signature **before any other processing** (using `crypto.timingSafeEqual` to prevent timing attacks)
- Parses the event type from `X-GitHub-Event` header
- Dispatches to an internal handler based on event type

### 2.2 Reuse of Existing Infrastructure

| Existing component | How it is reused |
|--------------------|-----------------|
| `POST /projects/:id/ingest/git` logic | Extracted into a shared function `ingestGitCommits()` called both by the route and the webhook handler |
| `POST /projects/:id/generate` logic | Extracted into a shared function `runGeneratePipeline()` called automatically after PR commit ingestion |
| `notificationsTable` | PR events fire `new_pr_opened`, `pr_merged` notification types for the cross-team subscription system |
| `githubToken` from `process.env.GITHUB_TOKEN` | Reused for PR API calls (fetching commits/diff, posting comments) |

### 2.3 Pull Request Lifecycle

```
GitHub PR opened
     │
     ▼
POST /webhooks/github/:projectId
     │ (HMAC validated)
     ▼
Insert/update pull_requests record
     │
     ├─ Fetch PR commits via GitHub API
     ├─ Run scoreCommit() filter
     ├─ Insert into commits table (dedup by hash)
     │
     ▼
Run generate pipeline (L1→L2→L3) for new commits
     │
     ▼
Compute PR knowledge impact:
  - Which L2 nodes were touched
  - Which L3 nodes were created
  - Aggregate AI summary via LLM
     │
     ▼ (on PR merge)
POST /repos/:owner/:repo/issues/:pr_number/comments
  with the AI-generated knowledge impact summary
```

---

## 3. Detailed Implementation Steps

### Step 1 — DB Schema: `pull_requests` table

**File to create**: `lib/db/src/schema/pull_requests.ts`

```typescript
import { pgTable, text, serial, integer, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { projectsTable } from "./projects";

export const prStateEnum = pgEnum("pr_state", ["open", "closed", "merged"]);
export const prAnalysisStatusEnum = pgEnum("pr_analysis_status", [
  "pending", "in_progress", "completed", "failed"
]);

export const pullRequestsTable = pgTable("pull_requests", {
  id: serial("id").primaryKey(),
  projectId: integer("project_id")
    .notNull()
    .references(() => projectsTable.id, { onDelete: "cascade" }),
  githubPrNumber: integer("github_pr_number").notNull(),
  title: text("title").notNull(),
  body: text("body"),
  headSha: text("head_sha").notNull(),
  baseSha: text("base_sha").notNull(),
  author: text("author").notNull(),
  state: prStateEnum("state").notNull().default("open"),
  url: text("url").notNull(),
  analysisStatus: prAnalysisStatusEnum("analysis_status").notNull().default("pending"),
  aiSummary: text("ai_summary"),
  mergedAt: timestamp("merged_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertPullRequestSchema = createInsertSchema(pullRequestsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPullRequest = z.infer<typeof insertPullRequestSchema>;
export type PullRequest = typeof pullRequestsTable.$inferSelect;
```

**File to modify**: `lib/db/src/schema/index.ts`  
- Export `pullRequestsTable`, `insertPullRequestSchema`, `prStateEnum`, `prAnalysisStatusEnum`, `PullRequest`, `InsertPullRequest` from the new schema file.

**Drizzle migration**:  
- Run `pnpm --filter @workspace/db run generate` then `pnpm --filter @workspace/db run migrate` to generate and apply the migration.

---

### Step 2 — GitHub Client Helper

**File to create**: `artifacts/api-server/src/lib/github-client.ts`

Export the following functions (all use native `fetch`; no new npm dependencies):

```typescript
// Fetch all commits on a PR (handles pagination, max 250)
export async function fetchPrCommits(
  owner: string, repo: string, prNumber: number, token?: string
): Promise<Array<{ sha: string; commit: { message: string; author: { name: string } } }>>

// Fetch the unified diff of a PR (returns raw text)
export async function fetchPrDiff(
  owner: string, repo: string, prNumber: number, token?: string
): Promise<string>

// Post a comment on a PR issue thread
export async function postPrComment(
  owner: string, repo: string, prNumber: number, body: string, token: string
): Promise<void>

// Parse "owner/repo" from a GitHub URL
export function parseGithubRepo(repoUrl: string): { owner: string; repo: string } | null
```

**Security note**: All GitHub API calls MUST:
- Use `Authorization: Bearer <token>` only when a token is available
- Never log the raw token value
- Use the existing `GITHUB_TOKEN` env var as fallback

---

### Step 3 — Webhook Route

**File to create**: `artifacts/api-server/src/routes/github_webhooks.ts`

#### Route: `POST /webhooks/github/:projectId`

**Critical**: The Express app currently applies `express.json()` globally. The webhook signature validation requires the **raw body bytes**. Solution:

In `artifacts/api-server/src/app.ts`, mount the webhook route **before** `express.json()` with `express.raw({ type: 'application/json' })` on that specific path:

```typescript
// In app.ts — add BEFORE the global express.json() middleware
app.use(
  "/api/webhooks/github",
  express.raw({ type: "application/json" }),
  webhookRouter
);
```

#### Signature Validation Function

```typescript
import crypto from "crypto";

function validateGitHubSignature(rawBody: Buffer, signature: string, secret: string): boolean {
  const expected = `sha256=${crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex")}`;
  // Use timingSafeEqual to prevent timing attacks
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
```

#### Event Handlers

**`pull_request.opened`**:
1. Look up project by `projectId` param
2. Upsert `pullRequestsTable` row (`githubPrNumber`, `title`, `body`, `headSha`, `baseSha`, `author`, `state: "open"`, `url`)
3. Call internal `ingestPrCommits(project, prNumber, token)`:
   - Call `fetchPrCommits(owner, repo, prNumber, token)`
   - Run `scoreCommit()` on each commit message
   - Bulk-insert non-duplicate commits into `commitsTable`
4. Call internal `runGenerateForProject(projectId)` (wraps existing generate pipeline logic, `mode: "incremental"`)
5. Insert `notifications` row: `type: "new_pr_opened"`, `payload: { prNumber, title, url }`
6. Return `202 Accepted`

**`pull_request.synchronize`** (new commits pushed to PR):
1. Update `pullRequestsTable.headSha` and `updatedAt`
2. Repeat steps 3–5 from `opened` handler

**`pull_request.closed`** (with `merged: true`):
1. Update `pullRequestsTable.state = "merged"`, `mergedAt`, `updatedAt`
2. Compute knowledge impact:
   - Query all `commitsTable` rows for this project whose `createdAt >= pr.createdAt`
   - Fetch their linked `l2_nodes` and `l3_nodes`
3. Generate AI summary via `openai.chat.completions.create()`:
   - System prompt: "You are a technical documentation assistant. Given a list of knowledge graph changes from a PR, write a concise Markdown impact summary."
   - User content: JSON list of L2 nodes + L3 decisions created
4. Update `pullRequestsTable.aiSummary` and `analysisStatus: "completed"`
5. If `GITHUB_TOKEN` is set, call `postPrComment(owner, repo, prNumber, formattedSummary, token)`
6. Insert `notifications` row: `type: "pr_merged"`, `payload: { prNumber, title, url }`
7. Return `202 Accepted`

**All other event types**: Return `200 OK` (no-op, acknowledge receipt).

---

### Step 4 — PR Management Routes

**File to create**: `artifacts/api-server/src/routes/pull_requests.ts`

#### `GET /projects/:id/pull-requests`
- Validate `id` param
- Query `pullRequestsTable` ordered by `createdAt DESC`
- Return array of PR records (serializing timestamps to ISO strings)

#### `GET /projects/:id/pull-requests/:prNumber`
- Fetch PR from DB
- Fetch commits since `pr.createdAt` for this project
- Fetch linked `l2_nodes` via `commitsTable.l2NodeId`
- Fetch `l3_nodes` linked to those L2 nodes
- Return `{ pr, commitsCount, l2Nodes: [...], l3Nodes: [...], aiSummary }`

#### `POST /projects/:id/pull-requests/:prNumber/analyze`
- Trigger the analysis pipeline manually (same logic as `pull_request.closed` handler)
- Useful when webhook was missed or for re-analysis

---

### Step 5 — Register Routes

**File to modify**: `artifacts/api-server/src/routes/index.ts`

```typescript
import pullRequestsRouter from "./pull_requests";
import githubWebhooksRouter from "./github_webhooks";

// Add to router.use() calls:
router.use(pullRequestsRouter);
router.use(githubWebhooksRouter);
```

**File to modify**: `artifacts/api-server/src/app.ts`

Mount the raw-body webhook handler before `express.json()`:
```typescript
import webhookRawRouter from "./routes/github_webhooks";
// BEFORE app.use(express.json()):
app.use("/api/webhooks/github", express.raw({ type: "application/json" }), webhookRawRouter);
```

---

### Step 6 — OpenAPI Spec

**File to modify**: `lib/api-spec/openapi.yaml`

#### Add tag:
```yaml
  - name: github-prs
    description: GitHub Pull Request integration
```

#### Add path entries:

```yaml
  /projects/{id}/pull-requests:
    get:
      operationId: listPullRequests
      tags: [github-prs]
      summary: List pull requests for a project
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
      responses:
        "200":
          description: List of pull requests
          content:
            application/json:
              schema:
                type: array
                items:
                  $ref: "#/components/schemas/PullRequest"

  /projects/{id}/pull-requests/{prNumber}:
    get:
      operationId: getPullRequestDetail
      tags: [github-prs]
      summary: Get PR details with knowledge graph impact
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
        - name: prNumber
          in: path
          required: true
          schema:
            type: integer
      responses:
        "200":
          description: PR with impact analysis
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/PullRequestDetail"
        "404":
          description: Not found

  /projects/{id}/pull-requests/{prNumber}/analyze:
    post:
      operationId: analyzePullRequest
      tags: [github-prs]
      summary: Manually trigger PR knowledge impact analysis
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
        - name: prNumber
          in: path
          required: true
          schema:
            type: integer
      responses:
        "202":
          description: Analysis triggered
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/PrAnalyzeResult"
        "404":
          description: PR not found

  /webhooks/github/{projectId}:
    post:
      operationId: githubWebhook
      tags: [github-prs]
      summary: GitHub webhook receiver for PR events
      parameters:
        - name: projectId
          in: path
          required: true
          schema:
            type: integer
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              description: GitHub webhook payload (varies by event type)
      responses:
        "202":
          description: Webhook accepted and queued for processing
        "400":
          description: Invalid signature or bad payload
        "404":
          description: Project not found
```

#### Add component schemas:

```yaml
    PullRequest:
      type: object
      required: [id, projectId, githubPrNumber, title, headSha, baseSha, author, state, url, analysisStatus, createdAt, updatedAt]
      properties:
        id:
          type: integer
        projectId:
          type: integer
        githubPrNumber:
          type: integer
        title:
          type: string
        body:
          type: string
          nullable: true
        headSha:
          type: string
        baseSha:
          type: string
        author:
          type: string
        state:
          type: string
          enum: [open, closed, merged]
        url:
          type: string
        analysisStatus:
          type: string
          enum: [pending, in_progress, completed, failed]
        aiSummary:
          type: string
          nullable: true
        mergedAt:
          type: string
          format: date-time
          nullable: true
        createdAt:
          type: string
          format: date-time
        updatedAt:
          type: string
          format: date-time

    PullRequestDetail:
      type: object
      required: [pr, commitsCount, l2Nodes, l3Nodes]
      properties:
        pr:
          $ref: "#/components/schemas/PullRequest"
        commitsCount:
          type: integer
        l2Nodes:
          type: array
          items:
            $ref: "#/components/schemas/L2Node"
        l3Nodes:
          type: array
          items:
            $ref: "#/components/schemas/L3Node"
        aiSummary:
          type: string
          nullable: true

    PrAnalyzeResult:
      type: object
      required: [status, message]
      properties:
        status:
          type: string
          enum: [triggered, already_completed]
        message:
          type: string
```

#### Run codegen after spec changes:
```bash
pnpm --filter @workspace/api-spec run generate
```

---

### Step 7 — Frontend: PR Management Page

**File to create**: `artifacts/kg-engine/src/pages/pull-requests.tsx`

This page uses the Orval-generated hooks after Step 6 codegen.

#### Layout:
```
┌─────────────────────────────────────────────────┐
│  GitHub PR Integration                           │
│  [Project Selector ▼]                            │
├─────────────────────────────────────────────────┤
│  Webhook Setup                                  │
│  ┌──────────────────────────────────────────┐  │
│  │ Endpoint: POST /api/webhooks/github/{id} │  │
│  │ Secret: set GITHUB_WEBHOOK_SECRET env    │  │
│  │ Events: pull_request                     │  │
│  └──────────────────────────────────────────┘  │
├─────────────────────────────────────────────────┤
│  PRs   [open ▼ filter]                          │
│  ┌──────────────────────────────────────────┐  │
│  │ #42 feat: add user auth module   [merged]│  │
│  │     by: alice  •  2 L2 nodes  •  3 L3s  │  │
│  │     [View Impact]                        │  │
│  ├──────────────────────────────────────────┤  │
│  │ #41 fix: memory leak in parser   [open]  │  │
│  │     by: bob  •  pending analysis         │  │
│  │     [Analyze Now]                        │  │
│  └──────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

#### Components:
- `PrCard` — compact PR row with state badge (`open`/`merged`/`closed`), commit/node counts, action button
- `PrDetailSheet` — slide-over panel showing full AI summary, L2 node list, L3 decision list
- `WebhookSetupCard` — static instruction card showing endpoint URL and required GitHub settings

#### Hooks used:
- `useListPullRequests(projectId)` — generated by Orval from `listPullRequests` operationId
- `useGetPullRequestDetail(projectId, prNumber)` — generated from `getPullRequestDetail`
- `useAnalyzePullRequest()` — generated from `analyzePullRequest`, triggers manual analysis
- `useListProjects()` — existing hook for project selector

#### State badge color mapping:
```
open   → blue   (Badge variant="outline")
merged → purple (Badge variant="default")
closed → gray   (Badge variant="secondary")
```

---

### Step 8 — Navigation

**File to modify**: `artifacts/kg-engine/src/App.tsx` (or the sidebar component in `src/components/`)

Add a "Pull Requests" nav item linking to `/pull-requests`, with `GitPullRequest` icon from `lucide-react`.

---

### Step 9 — Update Roadmap Checklist

**File to modify**: `docs/roadmap-checklist.md`

After implementation is complete, change:
```
| GitHub PR integration           | ❌ Not started | —  |
```
to:
```
| GitHub PR integration           | ✅ Done | `lib/db/src/schema/pull_requests.ts`, `routes/pull_requests.ts`, `routes/github_webhooks.ts`, `lib/github-client.ts`, `pages/pull-requests.tsx` |
```

---

## 4. Implementation Details Summary

### New Files

| File | Package | Purpose |
|------|---------|---------|
| `lib/db/src/schema/pull_requests.ts` | `@workspace/db` | Drizzle schema for `pull_requests` table |
| `artifacts/api-server/src/lib/github-client.ts` | `@workspace/api-server` | GitHub API client helpers |
| `artifacts/api-server/src/routes/github_webhooks.ts` | `@workspace/api-server` | Webhook receiver with HMAC validation |
| `artifacts/api-server/src/routes/pull_requests.ts` | `@workspace/api-server` | PR CRUD + impact detail routes |
| `artifacts/kg-engine/src/pages/pull-requests.tsx` | `@workspace/kg-engine` | PR management frontend page |

### Modified Files

| File | Change |
|------|--------|
| `lib/db/src/schema/index.ts` | Export new PR schema symbols |
| `artifacts/api-server/src/app.ts` | Mount raw-body middleware for webhook route before `express.json()` |
| `artifacts/api-server/src/routes/index.ts` | Register `pullRequestsRouter` and `githubWebhooksRouter` |
| `lib/api-spec/openapi.yaml` | Add `github-prs` tag, 4 new endpoints, 3 new schemas |
| `artifacts/kg-engine/src/App.tsx` | Add `/pull-requests` route and nav item |
| `docs/roadmap-checklist.md` | Mark feature as completed |

---

## 5. Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `GITHUB_WEBHOOK_SECRET` | **Required** for webhook validation | Shared secret set in GitHub repo settings |
| `GITHUB_TOKEN` | Optional (enables comment posting) | Personal access token or fine-grained token with `repo` scope |

---

## 6. Architecture Diagram

```
GitHub Repo
    │
    │  PR events (webhook)
    ▼
POST /api/webhooks/github/:projectId
    │
    │  HMAC-SHA256 validation
    ▼
github_webhooks.ts
    ├─ fetchPrCommits() ──────► GitHub API
    ├─ scoreCommit() + dedup
    ├─ INSERT commitsTable
    ├─ runGeneratePipeline() ──► L1→L2→L3 (existing)
    ├─ computeKnowledgeImpact()
    │      └─ LLM: aiSummary
    └─ postPrComment() ────────► GitHub PR comment
         (on merge only)

Frontend: /pull-requests
    │
    ├─ useListPullRequests()
    ├─ useGetPullRequestDetail()
    └─ useAnalyzePullRequest()
```

---

## 7. Affected pnpm Workspace Packages

| Package | Change Type |
|---------|------------|
| `@workspace/db` | New schema table + Drizzle migration |
| `@workspace/api-spec` | New endpoints + schemas in OpenAPI YAML |
| `@workspace/api-zod` | Regenerated Zod validators (Orval) |
| `@workspace/api-client-react` | Regenerated React Query hooks (Orval) |
| `@workspace/api-server` | New route files + github client lib + app.ts middleware order change |
| `@workspace/kg-engine` | New page + nav item |

---

## 8. Agent Dispatch Plan

| Phase | Agent | Scope |
|-------|-------|-------|
| 1 | **Database Schema Expert** | Create `pull_requests.ts` schema, update `index.ts`, run Drizzle migration |
| 2 | **API Architect** | Update `openapi.yaml` with new tag, endpoints, schemas; run Orval codegen |
| 3 | **Backend Developer** | Create `github-client.ts`, `github_webhooks.ts`, `pull_requests.ts` routes; update `app.ts` and `routes/index.ts` |
| 4 | **Frontend Developer** | Create `pull-requests.tsx` page using generated hooks; update `App.tsx` navigation |
| 5 | **Task Verifier** | Verify TypeScript compiles, routes respond correctly, webhook validation works, frontend renders |

> **Note**: Due to VS Code agent constraints, subagents cannot spawn further subagents. The Main Copilot Orchestrator should invoke agents sequentially in the order listed above.
