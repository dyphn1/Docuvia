# AI Implementation Plan: v2 Core Architecture Refactor

> Generated from architecture review session — 2026-06-01  
> Scope: Schema changes, new components, and pipeline modifications required to implement the decisions recorded in ADR-008 through ADR-012.

---

## Overview

This plan covers the foundational changes required to implement the v2 architecture decisions. All changes are breaking — they alter existing schemas and replace core pipeline logic.

**Recommended implementation order:** Schema → Pipeline → Sync → VS Code Extension

---

## 1. Schema Changes (Database)

### 1.1 `commits` table — Modify

| Change | Column | Type | Notes |
|---|---|---|---|
| ADD | `branchName` | `text` | Branch the commit was pushed from |
| ADD | `validityStatus` | `text` (enum: `pending\|valid\|orphaned`) | Default: `pending` |
| DEPRECATE | `l2NodeId` | — | Replaced by `commit_l2_links`. Set to nullable, stop writing. Remove in v3. |

### 1.2 `commit_l2_links` — New table

```sql
CREATE TABLE commit_l2_links (
  id          SERIAL PRIMARY KEY,
  commit_id   INTEGER NOT NULL REFERENCES commits(id) ON DELETE CASCADE,
  l2_node_id  INTEGER NOT NULL REFERENCES l2_nodes(id) ON DELETE CASCADE,
  diff_paths  JSONB,          -- array of file paths that triggered this link
  created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(commit_id, l2_node_id)
);
CREATE INDEX idx_commit_l2_links_commit ON commit_l2_links(commit_id);
CREATE INDEX idx_commit_l2_links_l2 ON commit_l2_links(l2_node_id);
```

### 1.3 `l3_nodes` table — Modify

| Change | Column | Type | Notes |
|---|---|---|---|
| ADD | `occurrenceCount` | `integer` | Default: 1 |
| ADD | `sourceCommits` | `jsonb` | Array of commit hashes, e.g. `["abc123", "def456"]` |
| ADD | `validityStatus` | `text` | Enum: `pending\|valid\|orphaned`. Default: `pending` |
| ADD | `source` | `text` | Enum: `commit\|document`. Default: `commit` |
| MODIFY | `commitHash` | `text` | Keep but deprecate — superseded by `sourceCommits[0]` |

Add DB index for reverse lookup:
```sql
CREATE INDEX idx_l3_source_commits ON l3_nodes USING GIN (source_commits);
```

### 1.4 `l2_nodes` table — Modify

| Change | Column | Type | Notes |
|---|---|---|---|
| ADD | `pathPatterns` | `jsonb` | Array of glob strings. Null = still in AI-discovery mode |
| ADD | `reindexRequired` | `boolean` | Default: false. Set true on bootstrap confirmation |
| ADD | `isBootstrapConfirmed` | `boolean` | Default: false. True after human confirms module map |

### 1.5 `documents` table — Modify

| Change | Column | Type | Notes |
|---|---|---|---|
| MODIFY | `projectId` | `integer nullable` | Remove NOT NULL constraint |
| ADD | `contentHash` | `text` | SHA-256 of raw content |
| ADD | `affiliatedAt` | `timestamp` | When document was associated with a project |
| ADD | `status` | `text` | Enum: `unaffiliated\|affiliated`. Default: `unaffiliated` |

### 1.6 `llm_configs` table — Modify

| Change | Column | Type | Notes |
|---|---|---|---|
| ADD | `similarityThreshold` | `real` | Default: 0.85. Per-project L3 dedup threshold |
| ADD | `condensationThreshold` | `integer` | Default: 30. occurrenceCount trigger for AI condensation |
| ADD | `condensationReviewRequired` | `boolean` | Default: false |
| ADD | `autoGenerate` | `boolean` | Default: false. Whether git hook triggers pipeline automatically |
| ADD | `maxCommitsPerRun` | `integer` | Default: 50. Cost guard for auto-generate |
| ADD | `cooldownMinutes` | `integer` | Default: 60. Min interval between auto-generate runs |

---

## 2. Generate Pipeline Changes (`routes/generate.ts`)

### 2.1 L1 Semantic Dedup (before insert)
Before creating a new L1 tag:
1. Load all existing L1 tag embeddings.
2. Compute cosine similarity between candidate and all existing tags.
3. If max similarity ≥ `similarityThreshold`: reuse existing tag, skip insert.
4. Only if all similarity < threshold: insert new tag as `isAnchored: false`, create `anchor` review task.

### 2.2 L2 Commit Assignment — Path Rules
After bootstrap confirmation (`isBootstrapConfirmed = true` on all L2 nodes):
- Do NOT call LLM for L2 assignment.
- Parse commit diff paths from GitHub API response.
- Match each path against `l2_nodes.pathPatterns` glob patterns.
- Insert into `commit_l2_links` for all matching modules.

During bootstrap (no confirmed modules):
- Continue using LLM for L2 discovery.
- Include previous batch's L2 list in system prompt for self-correction.
- Batch size: 20 commits per LLM call.

### 2.3 L3 Semantic Dedup (before insert)
For each candidate L3 node:
1. Generate embedding.
2. Load all existing L3 embeddings for the same `l2NodeId`.
3. Find max cosine similarity.
4. If ≥ `similarityThreshold`:
   - Increment `occurrenceCount` on matching node.
   - Append current commit hash to `sourceCommits`.
   - If `occurrenceCount` reaches `condensationThreshold`: trigger AI condensation (re-synthesize `content` from all `sourceCommits`; create review task if `condensationReviewRequired = true`).
   - Do NOT insert new L3 node.
5. If < threshold: insert new L3 node with `occurrenceCount = 1`, `sourceCommits = [commitHash]`.

### 2.4 Validity Status
- All newly generated L3 nodes start as `validityStatus = 'pending'`.
- Validity promotion to `valid` happens in the sync pipeline (section 3), not in generate.

---

## 3. New Component: `docuvia sync` Pipeline

This is a new server-side endpoint and client-side CLI command.

### 3.1 Server Endpoint: `POST /sync`
Input:
```json
{
  "projectId": 123,
  "pushedBranch": "feature/payments",
  "pushedCommits": ["abc123", "def456"],
  "configYaml": "..."
}
```

Actions:
1. Store/update `config.yaml` content in `llm_configs` table (parse and upsert fields).
2. For each commit: set `commits.branchName = pushedBranch`.
3. Check if branch is main/default: if yes, set `commits.validityStatus = 'valid'` and cascade to associated `l3_nodes.validityStatus = 'valid'`.
4. If auto-generate is enabled in config and cooldown has passed: enqueue generate pipeline run.
5. Write updated knowledge to `docuvia-knowledge` orphan branch.

### 3.2 Orphan Branch Writer
New service: `artifacts/api-server/src/lib/orphan-branch-writer.ts`

Responsibilities:
- Given a project's current L2/L3 knowledge, generate YAML/Markdown files.
- Commit files to `docuvia-knowledge` orphan branch via git CLI (`git commit --allow-empty-message`).
- Files structure:
  ```
  docuvia-knowledge/
    {projectId}/
      l1_tags.yaml
      l2_modules/
        {module-name}.yaml
      l3_decisions/
        {module-name}/
          {id}-{slug}.md    ← status: valid|pending in frontmatter
  ```

### 3.3 Client CLI: `docuvia sync`
New binary or VS Code command that:
1. Reads `.docuvia/config.yaml` and `.docuvia/.snapshot-ref`.
2. Calls `POST /sync` with pushed branch info and config.
3. After server responds, runs `git fetch origin docuvia-knowledge` to update local snapshot ref.

### 3.4 Git Hook Template
New file: `artifacts/api-server/src/lib/githook-template.sh`
```bash
#!/bin/sh
# Docuvia post-push hook
# Install: git config core.hooksPath .githooks
BRANCH=$(git rev-parse --abbrev-ref HEAD)
COMMITS=$(git log @{u}..HEAD --format=%H | tr '\n' ',')
docuvia sync --branch "$BRANCH" --commits "$COMMITS"
```

---

## 4. VS Code Extension Changes (`artifacts/vscode-client/`)

### 4.1 `KnowledgeStore.ts` — Rewrite read source
- Remove: direct filesystem reads of `.docuvia/l1_tags.yaml`, `.docuvia/l2_modules.yaml`, `.docuvia/l3_decisions/`.
- Add: read from server API (primary) or from `git show docuvia-knowledge:{projectId}/...` (offline fallback).
- `.docuvia/manifest.yaml` only stores: module names + file path patterns (for offline CodeLens).
- `.docuvia/.snapshot-ref` stores the last synced orphan branch commit hash.

### 4.2 `parser.ts` — Fix `parseTags` bug (known issue)
`parseTags` currently calls `.map()` on the parse result without checking if it's an object (not an array). When `l1_tags.yaml` uses `{ project_name: "...", tags: [...] }` format, this throws silently. Fix: check if parsed result is object with `tags` property and use that array.

### 4.3 `CentralServerClient.ts` — Add push methods
- Add `sync(branch: string, commits: string[]): Promise<void>` method.
- Add `pullSnapshot(projectId: number): Promise<KnowledgeSnapshot>` method.

### 4.4 Offline CodeLens
When server is unreachable, `DocuviaCodeLensProvider` falls back to:
- Reading `modules` from `.docuvia/manifest.yaml` (path patterns only).
- Matching current file path against patterns.
- Showing module name without L3 details ("auth module — connect to server for decisions").

---

## 5. Document Misc Pool (Web UI + Backend)

### 5.1 Backend
- Modify `POST /projects/:id/ingest/document/upload` to accept `projectId = null`.
- Add `GET /documents/misc` — list all unaffiliated documents.
- Add `POST /documents/:id/affiliate` — body: `{ projectId: number }`. Sets `projectId`, `affiliatedAt`, `status = 'affiliated'`. Uses `contentHash` to skip reprocessing if already processed for this project.

### 5.2 Frontend
- New page or tab: `Documents / Misc Pool`.
- Shows unaffiliated documents with "Associate with Project" action.
- Upload form: make project selection optional.

---

## 6. MCP Query Changes (`routes/mcp.ts`)

All search endpoints (`/mcp/search_knowledge`, `/mcp/query`) must add validity filter:
```ts
// Default: only valid
.where(eq(l3NodesTable.validityStatus, 'valid'))

// With include_pending=true
.where(or(
  eq(l3NodesTable.validityStatus, 'valid'),
  eq(l3NodesTable.validityStatus, 'pending')
))
```

---

## 7. Known Errors to Fix in Design Documents

| File | Error | Fix |
|---|---|---|
| `docs/design/08-crosscutting-concepts.md` | ER diagram shows `l1_tags.projectId FK → projects` | Remove this relationship — L1 tags have no projectId (confirmed by actual schema) |
| `docs/design/12-glossary.md` | Node Link defined as "L2 or L3 nodes" | Change to "L2 nodes only" (see Task A Fix 1) |
| `docs/roadmap-checklist.md` | Phase 7 VS Code extension listed as ✅ Done | Add note: KnowledgeStore rewrite required for v2 orphan-branch architecture |

---

## 8. Deferred Items

| Item | Reason deferred | Notes |
|---|---|---|
| SVN support (two-phase validity) | SVN repo structure identification problem is complex | SVN commits to trunk = directly valid (simpler model). Design separately. |
| User auth / multi-tenant | Core indexing pipeline must be solid first | `subscriptions` table (Project→Project) is temporary; future: User→KnowledgeSubset |
| Subscription per-user filtering | Blocked by user auth | |
| Force-overwrite dialog in `initProject` | Low priority UX gap | Currently skips existing files silently |
| `KnowledgeStore` debounce + incremental update | Scheduled for Round 2 | Currently full reload on every file change |

---

## References

- [ADR-008](../design/09-architectural-decisions.md#adr-008-orphan-branch-as-knowledge-store)
- [ADR-009](../design/09-architectural-decisions.md#adr-009-l3-semantic-deduplication-via-occurrence-count)
- [ADR-010](../design/09-architectural-decisions.md#adr-010-l2-bootstrap-ai-discovery-to-path-rules)
- [ADR-011](../design/09-architectural-decisions.md#adr-011-two-phase-knowledge-validity)
- [ADR-012](../design/09-architectural-decisions.md#adr-012-document-misc-pool-for-unaffiliated-documents)
