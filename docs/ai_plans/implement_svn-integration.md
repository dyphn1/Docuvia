# AI Implementation Plan: SVN Integration

**Feature**: SVN Commit + Diff Ingestion  
**Phase**: Phase 2 — Input Layer  
**Priority**: Highest (only remaining Phase 2 gap alongside build artifact parser)  
**Date**: 2026-05-12  
**Status**: Ready for implementation

---

## 1. Overview

Docuvia currently ingests commits exclusively via the GitHub REST API
(`POST /projects/:id/ingest/git`). Many enterprise engineering teams use
**Subversion (SVN)** as their primary VCS. This feature adds a parallel ingest
pathway that:

1. Connects to any SVN repository URL via the `svn` CLI.
2. Fetches revision log entries (`svn log --xml`).
3. Optionally fetches per-revision diffs (`svn diff`).
4. Stores revisions into the existing `commits` table with a `vcsType`
   discriminator so the downstream L1→L2→L3 generate pipeline consumes them
   unchanged.

---

## 2. Architecture

```
POST /projects/:id/ingest/svn
        │
        ▼
  SvnIngestSchema (zod)
        │
        ▼
  svn-client.ts
  ┌─────────────────────────────────┐
  │  execFile("svn", ["log","--xml",│
  │   "--limit", n, repoUrl, ...])  │
  │  → parse XML → SvnLogEntry[]    │
  └─────────────────────────────────┘
        │
        ▼
  scoreCommit()   ← reuse existing
        │
        ▼
  db.insert(commitsTable)
  { hash: "svn:R<rev>", vcsType: "svn", revision: <int>, ... }
        │
        ▼
  activityLogTable  +  projectsTable.updatedAt
```

### Integration with existing pipeline

The `generate.ts` pipeline reads `commitsTable` filtered by `projectId` and
`valid = true`. It sends `commit.message` to the LLM. Because SVN revisions are
stored in the same table with the same columns, the generate pipeline requires
**zero changes**.

The `hash` field stores `"svn:R<revision>"` (e.g. `"svn:R4821"`) to guarantee
uniqueness within the table and to avoid collision with 40-char Git SHAs.

---

## 3. Files to Create

| File | Purpose |
|------|---------|
| `artifacts/api-server/src/lib/svn-client.ts` | Typed wrapper around `svn` CLI — `svnLog()`, `svnInfo()`, `svnDiff()` |

---

## 4. Files to Modify

| File | Change |
|------|--------|
| `lib/db/src/schema/projects.ts` | Add `vcsTypeEnum` pgEnum + `vcsType` column (default `"git"`) |
| `lib/db/src/schema/commits.ts` | Add `revision` column (nullable `integer`) + `vcsType` column |
| `lib/db/src/schema/index.ts` | Export new enum `vcsTypeEnum` (auto-covered if in `projects.ts`) |
| `artifacts/api-server/src/routes/ingest.ts` | Add `POST /projects/:id/ingest/svn` route handler + `SvnIngestSchema` |
| `lib/api-spec/openapi.yaml` | Add `/projects/{id}/ingest/svn` path + `SvnIngestInput` + `SvnIngestResult` schemas |

---

## 5. Schema Changes (Drizzle ORM)

### 5.1 `lib/db/src/schema/projects.ts`

Add a `vcsTypeEnum` and a `vcsType` column:

```typescript
// NEW enum — add before projectsTable definition
export const vcsTypeEnum = pgEnum("vcs_type", ["git", "svn"]);

// MODIFIED table — add new column
export const projectsTable = pgTable("projects", {
  // ...existing columns...
  vcsType: vcsTypeEnum("vcs_type").notNull().default("git"),
  // ...
});
```

**Rationale**: Allows the frontend to conditionally show SVN-specific ingest
options and allows future query filters by VCS type.

### 5.2 `lib/db/src/schema/commits.ts`

Add two nullable columns:

```typescript
export const commitsTable = pgTable("commits", {
  // ...existing columns...
  revision:  integer("revision"),          // SVN revision number; null for Git
  vcsType:   vcsTypeEnum("vcs_type").notNull().default("git"),
});
```

**Rationale**: `revision` preserves the original SVN integer for display and
deduplication; `vcsType` enables downstream filtering if needed.

### 5.3 Migration

Generate a new Drizzle migration file:

```bash
pnpm --filter @workspace/db run db:generate
# then apply:
pnpm --filter @workspace/db run db:migrate
```

---

## 6. New File: `artifacts/api-server/src/lib/svn-client.ts`

```typescript
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface SvnLogEntry {
  revision: number;
  author: string;
  date: string;
  message: string;
}

export interface SvnInfo {
  headRevision: number;
  repositoryRoot: string;
  lastChangedRev: number;
}

/**
 * Build shared SVN auth args.
 * Credentials are passed as separate args to execFile to prevent
 * shell injection.
 */
function authArgs(username?: string, password?: string): string[] {
  const args: string[] = ["--no-auth-cache", "--non-interactive"];
  if (username) args.push("--username", username);
  if (password) args.push("--password", password);
  return args;
}

/**
 * Fetch SVN log as structured entries.
 *
 * @param repoUrl  Full SVN repository URL (svn://, svn+ssh://, https://)
 * @param limit    Maximum number of revisions to fetch (capped at 500)
 * @param username Optional SVN username
 * @param password Optional SVN password
 */
export async function svnLog(
  repoUrl: string,
  limit: number,
  username?: string,
  password?: string,
): Promise<SvnLogEntry[]> {
  const { stdout } = await execFileAsync("svn", [
    "log",
    "--xml",
    "--limit",
    String(limit),
    ...authArgs(username, password),
    "--",   // end of options — prevents URL from being interpreted as a flag
    repoUrl,
  ]);

  return parseSvnLogXml(stdout);
}

/**
 * Fetch SVN repository info (HEAD revision, root URL).
 */
export async function svnInfo(
  repoUrl: string,
  username?: string,
  password?: string,
): Promise<SvnInfo> {
  const { stdout } = await execFileAsync("svn", [
    "info",
    "--xml",
    ...authArgs(username, password),
    "--",
    repoUrl,
  ]);

  return parseSvnInfoXml(stdout);
}

/**
 * Fetch unified diff for a single revision.
 * Returns empty string if diff is unavailable (e.g. revision 1 with no parent).
 */
export async function svnDiff(
  repoUrl: string,
  revision: number,
  username?: string,
  password?: string,
): Promise<string> {
  if (revision <= 1) return "";
  try {
    const { stdout } = await execFileAsync("svn", [
      "diff",
      "--change",
      String(revision),
      ...authArgs(username, password),
      "--",
      repoUrl,
    ]);
    return stdout;
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// XML parsers (no external dependency — use regex on controlled SVN output)
// ---------------------------------------------------------------------------

function parseSvnLogXml(xml: string): SvnLogEntry[] {
  const entries: SvnLogEntry[] = [];
  const entryRe = /<logentry\s+revision="(\d+)">([\s\S]*?)<\/logentry>/g;
  let m: RegExpExecArray | null;
  while ((m = entryRe.exec(xml)) !== null) {
    const revision = parseInt(m[1], 10);
    const inner = m[2];
    const author = (/<author>([\s\S]*?)<\/author>/.exec(inner)?.[1] ?? "Unknown").trim();
    const date   = (/<date>([\s\S]*?)<\/date>/.exec(inner)?.[1] ?? "").trim();
    const msg    = (/<msg>([\s\S]*?)<\/msg>/.exec(inner)?.[1] ?? "").trim();
    entries.push({ revision, author, date, message: msg });
  }
  return entries;
}

function parseSvnInfoXml(xml: string): SvnInfo {
  const root      = /<root>([\s\S]*?)<\/root>/.exec(xml)?.[1]?.trim() ?? "";
  const headRev   = parseInt(/<entry[^>]+revision="(\d+)"/.exec(xml)?.[1] ?? "0", 10);
  const lastRev   = parseInt(/<commit[^>]+revision="(\d+)"/.exec(xml)?.[1] ?? "0", 10);
  return { repositoryRoot: root, headRevision: headRev, lastChangedRev: lastRev };
}
```

**Security notes**:
- `execFile` is used (not `exec`) — arguments are never shell-interpolated.
- `--no-auth-cache` prevents SVN from persisting credentials to `.subversion/auth`.
- `--non-interactive` ensures the process never hangs waiting for interactive password prompts.
- `--` separates options from the URL operand to prevent the URL from being treated as a CLI flag.
- The `repoUrl` is validated against an allowlist regex in the route handler before reaching this function.

---

## 7. Route Changes: `artifacts/api-server/src/routes/ingest.ts`

### 7.1 New Zod validation schema

```typescript
const SVN_URL_RE = /^(svn(\+ssh)?|https?):\/\/.+/i;

const SvnIngestSchema = z.object({
  repoUrl:  z.string().regex(SVN_URL_RE, "Must be a valid SVN URL (svn://, svn+ssh://, https://)").optional(),
  limit:    z.number().int().min(1).max(500).optional().default(100),
  username: z.string().optional(),
  password: z.string().optional(),
});
```

### 7.2 New route handler

```typescript
router.post("/projects/:id/ingest/svn", async (req, res) => {
  const projectId = Number(req.params.id);
  const [project] = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId));
  if (!project) return res.status(404).json({ error: "Project not found" });

  const body = SvnIngestSchema.parse(req.body);
  const repoUrl = body.repoUrl ?? project.repoUrl;
  const limit   = Math.min(body.limit ?? 100, 500);

  // Validate URL format (redundant with zod but provides clear error when
  // falling back to project.repoUrl)
  if (!SVN_URL_RE.test(repoUrl)) {
    return res.status(400).json({
      error: "Project repoUrl is not a valid SVN URL. Provide repoUrl in request body.",
    });
  }

  let logEntries: SvnLogEntry[];
  try {
    logEntries = await svnLog(repoUrl, limit, body.username, body.password);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(502).json({ error: `SVN command failed: ${msg}` });
  }

  const existingHashes = new Set(
    (
      await db
        .select({ hash: commitsTable.hash })
        .from(commitsTable)
        .where(eq(commitsTable.projectId, projectId))
    ).map((r) => r.hash),
  );

  let ingested = 0;
  let skipped  = 0;

  for (const entry of logEntries) {
    const svnHash = `svn:R${entry.revision}`;
    if (existingHashes.has(svnHash)) { skipped++; continue; }

    const score = scoreCommit(entry.message);
    await db.insert(commitsTable).values({
      projectId,
      hash:     svnHash,
      message:  entry.message.split("\n")[0].trim() || `SVN r${entry.revision}`,
      author:   entry.author,
      valid:    score >= 0.4,
      revision: entry.revision,
      vcsType:  "svn",
    });
    ingested++;
  }

  if (ingested > 0) {
    await db.insert(activityLogTable).values({
      type:        "commit",
      description: `Ingested ${ingested} SVN revisions from ${repoUrl}`,
      projectId,
    });
    await db
      .update(projectsTable)
      .set({ updatedAt: new Date() })
      .where(eq(projectsTable.id, projectId));
  }

  return res.json({
    revisionsIngested: ingested,
    revisionsSkipped:  skipped,
    totalFetched:      logEntries.length,
  });
});
```

### 7.3 Import additions at the top of `ingest.ts`

```typescript
import { svnLog, type SvnLogEntry } from "../lib/svn-client.js";
```

---

## 8. OpenAPI Spec Changes: `lib/api-spec/openapi.yaml`

### 8.1 New path (insert after `/projects/{id}/ingest/git`)

```yaml
  /projects/{id}/ingest/svn:
    post:
      operationId: ingestSvn
      tags: [ingest]
      summary: Ingest revisions from an SVN repository
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/SvnIngestInput"
      responses:
        "200":
          description: SVN ingest result
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/SvnIngestResult"
        "400":
          description: Invalid SVN URL
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"
        "502":
          description: SVN command execution failed (SVN not installed or unreachable)
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/ErrorResponse"
```

### 8.2 New schemas (insert in `components/schemas` section)

```yaml
    SvnIngestInput:
      type: object
      properties:
        repoUrl:
          type: string
          description: "Full SVN repository URL (svn://, svn+ssh://, https://)"
        limit:
          type: integer
          default: 100
          minimum: 1
          maximum: 500
        username:
          type: string
          description: SVN username (optional)
        password:
          type: string
          description: SVN password (optional, transmitted over HTTPS only)

    SvnIngestResult:
      type: object
      required: [revisionsIngested, revisionsSkipped, totalFetched]
      properties:
        revisionsIngested:
          type: integer
        revisionsSkipped:
          type: integer
        totalFetched:
          type: integer
```

---

## 9. Affected pnpm Workspace Packages

| Package | Change |
|---------|--------|
| `@workspace/db` (`lib/db/`) | Schema: add `vcsTypeEnum`, `vcsType` column in `projects`, `revision` + `vcsType` columns in `commits`; generate + apply migration |
| `@workspace/api-server` (`artifacts/api-server/`) | New `svn-client.ts`; extend `ingest.ts` with SVN route |
| `@workspace/api-spec` (`lib/api-spec/`) | Add SVN endpoint + schemas to `openapi.yaml` |
| `@workspace/api-zod` (`lib/api-zod/`) | Regenerate via Orval after spec change |
| `@workspace/api-client-react` (`lib/api-client-react/`) | Regenerate via Orval after spec change |

---

## 10. Ordered Implementation Steps

> **Execute in strict order** — later steps depend on earlier ones.

### Step 1 — DB Schema (Database Schema Expert)

1. In `lib/db/src/schema/projects.ts`:
   - Add `export const vcsTypeEnum = pgEnum("vcs_type", ["git", "svn"]);`
   - Add column `vcsType: vcsTypeEnum("vcs_type").notNull().default("git")` to `projectsTable`
   - Add `vcsType` to `updateProjectSchema` (optional field)

2. In `lib/db/src/schema/commits.ts`:
   - Import `vcsTypeEnum` from `./projects`
   - Add column `revision: integer("revision")` (nullable)
   - Add column `vcsType: vcsTypeEnum("vcs_type").notNull().default("git")`

3. Generate migration:
   ```bash
   pnpm --filter @workspace/db run db:generate
   ```

4. Apply migration:
   ```bash
   pnpm --filter @workspace/db run db:migrate
   ```

5. Verify TypeScript compiles:
   ```bash
   pnpm --filter @workspace/db run build
   ```

### Step 2 — OpenAPI Spec (API Architect)

1. Open `lib/api-spec/openapi.yaml`
2. After the `/projects/{id}/ingest/git` path block, insert the `/projects/{id}/ingest/svn` path block (see §8.1).
3. In `components/schemas`, after `GitIngestResult`, insert `SvnIngestInput` and `SvnIngestResult` schemas (see §8.2).
4. Run Orval codegen for both downstream packages:
   ```bash
   pnpm --filter @workspace/api-spec run generate
   ```
5. Verify generated types:
   ```bash
   pnpm --filter @workspace/api-zod run build
   pnpm --filter @workspace/api-client-react run build
   ```

### Step 3 — SVN Client Library (Backend Developer)

1. Create `artifacts/api-server/src/lib/svn-client.ts` with the exact content from §6.
2. Verify TypeScript compiles:
   ```bash
   pnpm --filter @workspace/api-server run build
   ```

### Step 4 — Ingest Route Extension (Backend Developer)

1. Open `artifacts/api-server/src/routes/ingest.ts`
2. Add import for `svnLog` and `SvnLogEntry` from `../lib/svn-client.js`
3. After the `GitIngestSchema` const, add `SvnIngestSchema` (see §7.1)
4. After the `router.post("/projects/:id/ingest/git", ...)` handler, add the SVN handler (see §7.2)
5. Verify TypeScript compiles:
   ```bash
   pnpm --filter @workspace/api-server run build
   ```

### Step 5 — Integration Verification

1. Full workspace build:
   ```bash
   pnpm run build
   ```
2. Type-check only (faster iteration):
   ```bash
   pnpm run typecheck
   ```
3. Manual smoke test (requires `svn` CLI installed on test host):
   ```bash
   curl -X POST http://localhost:5000/api/projects/1/ingest/svn \
     -H "Content-Type: application/json" \
     -d '{"repoUrl":"https://svn.example.com/repos/myproject","limit":10}'
   ```
   Expected response shape:
   ```json
   { "revisionsIngested": 10, "revisionsSkipped": 0, "totalFetched": 10 }
   ```

---

## 11. Edge Cases & Error Handling

| Scenario | Handling |
|----------|----------|
| `svn` CLI not installed | `execFile` throws `ENOENT`; caught and returned as `502` with message |
| Authentication failure | `svn` exits with non-zero; stderr included in 502 error message |
| Repository unreachable (network) | Same as above — `502` |
| Revision 1 with no parent for `svnDiff` | `svnDiff()` returns `""` when `revision <= 1` |
| Empty commit message | Fallback: `SVN r<revision>` |
| `scoreCommit` returns < 0.4 | Commit stored with `valid = false` — excluded from generate pipeline |
| Duplicate revisions on re-ingest | `svn:R<n>` hash deduplication — `skipped++`, no DB write |

---

## 12. Build Verification Commands

```bash
# 1. Schema package
pnpm --filter @workspace/db run build

# 2. API spec + Orval codegen
pnpm --filter @workspace/api-spec run generate
pnpm --filter @workspace/api-zod run build
pnpm --filter @workspace/api-client-react run build

# 3. Backend server
pnpm --filter @workspace/api-server run build

# 4. Full workspace (lint + typecheck)
pnpm run build
```

---

## 13. Security Checklist

- [x] `execFile` used — no shell interpolation of user-provided URL
- [x] `--no-auth-cache` — credentials never written to disk
- [x] `--non-interactive` — process never hangs on stdin
- [x] `--` option terminator — URL cannot be parsed as a CLI flag
- [x] URL validated against allowlist regex before reaching `svn-client.ts`
- [x] `limit` capped at 500 server-side (independent of client-provided value)
- [x] Password only accepted over HTTPS (documented in OpenAPI spec)
- [ ] **Recommendation**: Add HTTPS-only middleware check if passwords are present

---

## 14. No Changes Required

The following parts of the system require **zero modifications**:

- `routes/generate.ts` — reads `commitsTable` by `projectId`; VCS type is irrelevant
- `lib/embedding.ts` — operates on text content; VCS type is irrelevant  
- `routes/mcp.ts` — queries L2/L3 nodes; not commit-aware
- `intent-router.ts` — operates on natural language queries
- Any frontend components — ingest is a backend-only concern in the current UI
