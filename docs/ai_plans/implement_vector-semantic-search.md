# Implementation Plan: Vector Embedding + Semantic Search

> **Author**: Requirement Analyzer Agent  
> **Date**: 2026-05-12  
> **Priority**: HIGH — Highest-value gap in the entire codebase  
> **Feature**: `vector-semantic-search`

---

## 1. Audit Findings & Context

### 1.1 Corrected Status vs. Roadmap Checklist

The following items were **mis-categorized** in `docs/roadmap-checklist.md` and have been corrected based on actual file inspection:

| Item                           | Old Status | Actual Status  | Evidence                                                                                                             |
| ------------------------------ | ---------- | -------------- | -------------------------------------------------------------------------------------------------------------------- |
| Generate pipeline (L1→L2→L3)   | ⚠️ Partial | ✅ Done        | `routes/generate.ts` fully implements 6-step pipeline with LLM, deduplication, review task creation, commit backfill |
| Commit filter logic            | ⚠️ Partial | ✅ Done        | `routes/ingest.ts` `scoreCommit()` with regex-based signal/noise detection                                           |
| Vector index (semantic search) | ⚠️ Partial | ❌ NOT STARTED | `routes/search.ts` uses SQL `LIKE` only; MCP `search_knowledge` also uses SQL `LIKE` — zero vector DB code exists    |
| Review UI (frontend)           | ⚠️ Partial | ✅ Done        | `artifacts/kg-engine/src/pages/review.tsx` is comprehensive with TaskCard, approve/reject/defer, correction editing  |
| Impact analysis impl           | ⚠️ Partial | ✅ Basic Done  | `routes/mcp.ts` has real one-hop graph traversal via `nodeLinksTable`                                                |

### 1.2 Verified Critical Gap

**All search in the system currently uses SQL `LIKE` text matching:**

```typescript
// routes/search.ts — current implementation (simplified)
const pattern = `%${query}%`;
const l2Rows = await db.select().from(l2NodesTable)
  .where(or(like(l2NodesTable.name, pattern), like(...description...)));
```

```typescript
// routes/mcp.ts — search_knowledge (current implementation)
const pattern = `%${query}%`;
const l2Rows = await db.select().from(l2NodesTable)
  .where(or(like(l2NodesTable.name, pattern), ...));
```

**Impact:**

- A query like `"authentication module"` will NOT find an L2 node named `"JWT handler"` — even if semantically identical
- MCP tool `search_knowledge` — the primary AI-agent interface — is effectively broken for natural language
- Blocks: Phase 4.1 Vector Index, Phase 5.1 Agentic RAG

**No embedding code exists anywhere in the codebase** (confirmed via full-codebase grep for `embed`, `vector`, `pgvector`, `qdrant`, `chroma`).

---

## 2. Implementation Goals

1. Add `pgvector` support to the existing PostgreSQL database (no new service required)
2. Add `embedding` vector columns to `l2_nodes` and `l3_nodes` tables
3. Create an embedding generation service reusing the existing OpenAI client
4. Augment the generate pipeline (`routes/generate.ts`) to store embeddings at node creation time
5. Replace SQL `LIKE` with vector cosine similarity in `routes/search.ts`
6. Replace SQL `LIKE` with vector cosine similarity in `routes/mcp.ts` `search_knowledge`
7. Add a `POST /api/admin/reindex-embeddings` backfill endpoint for existing nodes

---

## 3. Acceptance Criteria

- [ ] `pgvector` extension is enabled in the PostgreSQL DB
- [ ] `l2_nodes.embedding` and `l3_nodes.embedding` columns exist as `vector(1536)` (OpenAI `text-embedding-3-small` dimension)
- [ ] The generate pipeline stores embeddings for every newly created or updated L2/L3 node
- [ ] `POST /api/search` returns results ordered by cosine similarity, not SQL LIKE score
- [ ] `GET /api/mcp/search_knowledge` returns semantically ranked results
- [ ] A backfill endpoint exists to generate embeddings for nodes created before this feature
- [ ] Graceful fallback to SQL LIKE if embedding is null or OpenAI embedding API fails
- [ ] No regression in existing route behavior (still returns the same response shape)

---

## 4. Architecture Overview

```
User Query: "authentication token refresh"
         │
         ▼
POST /api/search or GET /api/mcp/search_knowledge
         │
         ├─► Embed query → OpenAI text-embedding-3-small → float[1536]
         │
         ├─► pgvector cosine similarity search on l2_nodes.embedding
         │   SELECT *, 1 - (embedding <=> $query_vec) AS score
         │   ORDER BY score DESC LIMIT 20
         │
         ├─► pgvector cosine similarity search on l3_nodes.embedding
         │
         └─► Return merged + ranked results
```

```
POST /api/projects/:id/generate  (existing pipeline)
         │
         ├─► [Existing] L1 tags → LLM → DB insert
         │
         ├─► [Existing] L2/L3 nodes → LLM → DB insert
         │
         └─► [NEW] For each L2 node: generateEmbedding(name + description)
                   For each L3 node: generateEmbedding(title + content)
                   → UPDATE l2_nodes SET embedding = $vec WHERE id = $id
                   → UPDATE l3_nodes SET embedding = $vec WHERE id = $id
```

---

## 5. Affected Packages

| Package                | Change Type                                                               |
| ---------------------- | ------------------------------------------------------------------------- |
| `lib/db`               | Schema migration — add `vector` columns, enable `pgvector`                |
| `artifacts/api-server` | New embedding service, update search/mcp routes, update generate pipeline |

No changes to `lib/api-spec`, `lib/api-zod`, `lib/api-client-react`, or `artifacts/kg-engine` (frontend) are required — the API response shape is preserved.

---

## 6. Detailed Implementation Steps

### Step 1: Enable pgvector in the DB schema (`lib/db`)

**File: `lib/db/src/schema/l2_nodes.ts`**

Add a vector column using Drizzle's `customType` for pgvector:

```typescript
import { customType } from "drizzle-orm/pg-core";

// Define a custom pgvector column type
export const vector = customType<{ data: number[]; driverData: string }>({
  dataType(config) {
    return `vector(${(config as any)?.dimensions ?? 1536})`;
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: string): number[] {
    return value.slice(1, -1).split(",").map(Number);
  },
});
```

Add to `l2NodesTable`:

```typescript
embedding: vector("embedding", { dimensions: 1536 }),
```

**File: `lib/db/src/schema/l3_nodes.ts`**

Add to `l3NodesTable`:

```typescript
embedding: vector("embedding", { dimensions: 1536 }),
```

**File: `lib/db/drizzle.config.ts`** (no change needed, existing push script will detect schema diff)

**Migration approach**: Use `pnpm --filter @workspace/db push` (existing `drizzle-kit push` workflow).

**Important**: Before pushing, the `pgvector` extension must be enabled:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

This should be done via a Drizzle migration SQL file, or documented as a prerequisite.

### Step 2: Create Embedding Service (`artifacts/api-server/src/lib/embedding.ts`)

```typescript
import { openai } from "@workspace/integrations-openai-ai-server";

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;

/**
 * Generate a normalized text embedding vector using OpenAI.
 * Returns null on failure (allows graceful fallback).
 */
export async function generateEmbedding(text: string): Promise<number[] | null> {
  if (!text?.trim()) return null;
  try {
    const response = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: text.slice(0, 8192), // token limit safety
      dimensions: EMBEDDING_DIMENSIONS,
    });
    return response.data[0]?.embedding ?? null;
  } catch (err) {
    console.warn("[embedding] Failed to generate embedding:", err);
    return null;
  }
}
```

### Step 3: Update Generate Pipeline (`artifacts/api-server/src/routes/generate.ts`)

After the L2 node is upserted and L3 nodes are inserted, add embedding generation:

After the L2 insert/update block:

```typescript
// Generate and store embedding for the L2 node
const l2Text = `${l2data.name} ${l2data.description ?? ""}`.trim();
const l2Embedding = await generateEmbedding(l2Text);
if (l2Embedding) {
  await db
    .update(l2NodesTable)
    .set({ embedding: l2Embedding })
    .where(eq(l2NodesTable.id, l2node.id));
}
```

After each L3 insert:

```typescript
// Generate and store embedding for the L3 node
const l3Text = `${l3data.title} ${l3data.content ?? ""}`.trim();
const l3Embedding = await generateEmbedding(l3Text);
if (l3Embedding) {
  await db
    .update(l3NodesTable)
    .set({ embedding: l3Embedding })
    .where(eq(l3NodesTable.id, l3node.id));
}
```

### Step 4: Update Search Route (`artifacts/api-server/src/routes/search.ts`)

Replace the SQL LIKE approach with a hybrid strategy:

- If embedding generation succeeds: use `<=>` cosine distance operator (pgvector)
- If it fails: fall back to SQL LIKE

```typescript
import { generateEmbedding } from "../lib/embedding.js";
import { sql as sqlTemplate } from "drizzle-orm";

router.post("/search", async (req, res) => {
  const body = SearchSchema.parse(req.body);
  const { query, projectId, limit } = body;

  const queryEmbedding = await generateEmbedding(query);
  const results = [];

  if (queryEmbedding) {
    // Semantic vector search
    const embeddingLiteral = `[${queryEmbedding.join(",")}]`;

    const l2Rows = await db.execute(sqlTemplate`
      SELECT *, 1 - (embedding <=> ${embeddingLiteral}::vector) AS score
      FROM l2_nodes
      WHERE embedding IS NOT NULL
      ${projectId ? sqlTemplate`AND project_id = ${projectId}` : sqlTemplate``}
      ORDER BY embedding <=> ${embeddingLiteral}::vector
      LIMIT ${limit}
    `);
    // ... map rows to result shape

    const l3Rows = await db.execute(sqlTemplate`
      SELECT l3.*, 1 - (l3.embedding <=> ${embeddingLiteral}::vector) AS score
      FROM l3_nodes l3
      WHERE l3.embedding IS NOT NULL
      ORDER BY l3.embedding <=> ${embeddingLiteral}::vector
      LIMIT ${limit}
    `);
    // ... map rows to result shape
  } else {
    // Fallback: existing SQL LIKE behavior
    // ... (keep existing code as-is for fallback)
  }

  results.sort((a, b) => b.score - a.score);
  res.json({ results: results.slice(0, limit), total: results.length });
});
```

### Step 5: Update MCP `search_knowledge` (`artifacts/api-server/src/routes/mcp.ts`)

Same hybrid approach in the `GET /mcp/search_knowledge` handler:

- Generate query embedding
- Use pgvector `<=>` cosine distance if available
- Fall back to SQL LIKE if embedding fails

### Step 6: Backfill Endpoint (`artifacts/api-server/src/routes/generate.ts` or new admin route)

Add `POST /api/admin/reindex-embeddings` to backfill embeddings for all existing nodes without one:

```typescript
router.post("/admin/reindex-embeddings", async (req, res) => {
  const l2Nodes = await db.select().from(l2NodesTable).where(isNull(l2NodesTable.embedding));

  let l2Done = 0;
  for (const node of l2Nodes) {
    const text = `${node.name} ${node.description ?? ""}`.trim();
    const emb = await generateEmbedding(text);
    if (emb) {
      await db.update(l2NodesTable).set({ embedding: emb }).where(eq(l2NodesTable.id, node.id));
      l2Done++;
    }
  }

  const l3Nodes = await db.select().from(l3NodesTable).where(isNull(l3NodesTable.embedding));

  let l3Done = 0;
  for (const node of l3Nodes) {
    const text = `${node.title} ${node.content ?? ""}`.trim();
    const emb = await generateEmbedding(text);
    if (emb) {
      await db.update(l3NodesTable).set({ embedding: emb }).where(eq(l3NodesTable.id, node.id));
      l3Done++;
    }
  }

  res.json({ l2Reindexed: l2Done, l3Reindexed: l3Done });
});
```

---

## 7. File List for the Implementing Agent

### Files to Create (New)

| File                                        | Purpose                                   |
| ------------------------------------------- | ----------------------------------------- |
| `artifacts/api-server/src/lib/embedding.ts` | Embedding generation service using OpenAI |

### Files to Modify

| File                                          | Change                                                      |
| --------------------------------------------- | ----------------------------------------------------------- |
| `lib/db/src/schema/l2_nodes.ts`               | Add `vector` custom type + `embedding` column               |
| `lib/db/src/schema/l3_nodes.ts`               | Add `embedding` column                                      |
| `artifacts/api-server/src/routes/generate.ts` | Add embedding generation after L2/L3 inserts                |
| `artifacts/api-server/src/routes/search.ts`   | Replace SQL LIKE with semantic vector search + fallback     |
| `artifacts/api-server/src/routes/mcp.ts`      | Replace SQL LIKE in `search_knowledge` with semantic search |
| `artifacts/api-server/src/routes/generate.ts` | Add `POST /admin/reindex-embeddings` endpoint               |

---

## 8. Key Constraints & Notes

1. **No new services**: Use `pgvector` (PostgreSQL extension), not Qdrant/Chroma. The existing DB is already PostgreSQL (Drizzle config confirms `dialect: "postgresql"`).
2. **Graceful fallback**: If OpenAI embedding API fails (rate limit, no key), fall back to SQL LIKE search. Never hard-fail.
3. **`drizzle-orm` vector support**: Use `customType` from `drizzle-orm/pg-core` to define the `vector` column — Drizzle does not have a built-in vector type yet.
4. **Raw SQL for similarity queries**: Use `db.execute(sql`...`)` for the `<=>` operator — Drizzle's typed query builder does not support pgvector operators. This is acceptable.
5. **pgvector extension prerequisite**: The `CREATE EXTENSION IF NOT EXISTS vector;` must be run before `drizzle-kit push`. Add a comment/note in the schema or a migration file.
6. **Embedding dimensions**: `text-embedding-3-small` outputs 1536 dimensions. Hardcode this as a constant.
7. **Text budget**: Truncate combined text to 8192 characters before sending to embedding API (token limit safety).
8. **Rate limiting**: The backfill endpoint should be used carefully — add a small delay between batches if needed.
9. **Import paths**: All imports in `artifacts/api-server/` must use `.js` extensions (ESM project, see `"type": "module"` in package.json).

---

## 9. Dependencies Required

The `pgvector` npm package is **not needed** — we use raw SQL `<=>` operator directly via `db.execute()`. The only dependency needed is ensuring the PostgreSQL server has the `pgvector` extension installed.

No new npm packages are required.

---

## 10. Updated Roadmap Status (Post-Implementation)

After this feature is implemented, the following checklist items will change:

| Item                                | Before         | After        |
| ----------------------------------- | -------------- | ------------ |
| Vector index (semantic search)      | ❌ Not started | ✅ Done      |
| `search_knowledge` endpoint quality | ⚠️ SQL LIKE    | ✅ Semantic  |
| Phase 4 progress                    | 1.5 / 4        | 2.5 / 4      |
| Agentic RAG (unblocked)             | ❌ Blocked     | 🔓 Unblocked |

---

_Plan version: v1.0 — 2026-05-12_  
_Next recommended agent: Backend Developer_
