# Agentic RAG — Intent-Driven Routing Layer

**Feature**: Agentic RAG (Retrieval-Augmented Generation) with Intent-Driven Routing  
**Priority**: 🔴 High — Phase 5 / Query Layer & MCP Tools  
**Audited**: 2026-05-12  
**Author**: Requirement Analyzer

---

## 1. Implementation Goals

Introduce a single natural-language entry point (`POST /mcp/query`) that:

1. **Classifies** the caller's intent (via LLM structured output) into one of four routing strategies.
2. **Routes** to the appropriate existing MCP handler logic (vector search, graph traversal, or both).
3. **Merges and re-ranks** results from multiple strategies when using `hybrid`.
4. **Returns a uniform response** with a `routingStrategy` field so the caller knows how the answer was derived.

No new database schemas are required. No frontend changes are required in Phase 1.

---

## 2. Routing Strategies

| Strategy          | Trigger examples                                                               | Internal handlers called                           |
| ----------------- | ------------------------------------------------------------------------------ | --------------------------------------------------- |
| `vector_search`   | "What modules handle auth?", "Find docs about caching", "similar to X"        | `search_knowledge` logic (cosine similarity)        |
| `graph_traversal` | "What depends on AuthModule?", "Impact of changing PaymentService", "deps of X" | `get_dependencies` + `impact_analysis` logic       |
| `direct_lookup`   | "Get commit abc123 decisions", "Show decision record for hash def456"          | `get_decision_record` logic                        |
| `hybrid`          | "All security modules and their dependencies", "auth-related decisions + deps" | `vector_search` first, then `graph_traversal` on top results |

---

## 3. Architecture

```
POST /mcp/query  { q, project_id?, limit? }
        │
        ▼
┌─────────────────────────┐
│   IntentClassifier      │  ← LLM structured-output call (OpenAI)
│   lib/intent-router.ts  │    returns { strategy, entities }
└─────────────────────────┘
        │
        ├── "vector_search"  ──► vectorSearchHandler()   ─► results[]
        │
        ├── "graph_traversal" ─► graphTraversalHandler() ─► results[]
        │
        ├── "direct_lookup"  ──► directLookupHandler()   ─► results[]
        │
        └── "hybrid"         ──► vectorSearchHandler()
                                 + graphTraversalHandler() on top-k hits
                                 + ResultAggregator (merge + dedupe + re-rank)
                                 ─► results[]
        │
        ▼
POST /mcp/query response:
  { query, routingStrategy, entities, results[], metadata }
```

---

## 4. Detailed Implementation Steps

### Step 1 — Create `artifacts/api-server/src/lib/intent-router.ts`

This file owns all routing logic and is **the core deliverable**. It exports:

#### 4.1 `IntentClassification` type

```ts
export type RoutingStrategy = "vector_search" | "graph_traversal" | "direct_lookup" | "hybrid";

export interface IntentClassification {
  strategy: RoutingStrategy;
  entities: {
    moduleName?: string;       // for graph_traversal / direct_lookup
    commitHash?: string;       // for direct_lookup
    searchQuery?: string;      // for vector_search / hybrid (refined query)
  };
  confidence: number;          // 0–1 from LLM
  reasoning: string;           // brief explanation (for debugging/logging)
}
```

#### 4.2 `classifyIntent(query: string): Promise<IntentClassification>`

- Call `openai.chat.completions.create()` with `response_format: { type: "json_object" }` (already available via `lib/integrations-openai-ai-server`).
- Use a tightly-scoped system prompt (see Section 5).
- Parse and validate the JSON response; fall back to `vector_search` on failure.

#### 4.3 Handler functions (extracted from mcp.ts logic)

Extract the core query logic from `mcp.ts` into three internal handler functions (these are NOT Express routes — they are plain async functions that return typed data):

```ts
export async function vectorSearchHandler(
  query: string,
  projectId?: number,
  limit?: number
): Promise<AgenticSearchResult[]>

export async function graphTraversalHandler(
  moduleName: string,
  projectId?: number
): Promise<AgenticSearchResult[]>

export async function directLookupHandler(
  commitHash: string
): Promise<AgenticSearchResult[]>
```

Each returns `AgenticSearchResult[]`:

```ts
export interface AgenticSearchResult {
  source: "vector" | "graph" | "direct";
  nodeLayer: "l1" | "l2" | "l3" | "commit";
  id: number | string;
  title: string;
  content: string | null;
  projectId: number | null;
  projectName: string | null;
  score: number;            // cosine score for vector; 1.0 for graph/direct
  createdAt: string;
}
```

#### 4.4 `hybridSearch(query, classification, projectId?, limit?)`

1. Run `vectorSearchHandler` → top-k results (k = limit).
2. Extract unique L2 node names from those results.
3. For each unique L2 node, call `graphTraversalHandler` to pull its direct dependents/dependencies.
4. Merge all results, deduplicate by `(nodeLayer, id)`, and re-rank: vector results keep cosine score; graph results get a base score of `0.7`.
5. Return sorted slice of `limit` results.

#### 4.5 `routeQuery(...)` — top-level orchestrator

```ts
export async function routeQuery(
  query: string,
  projectId?: number,
  limit?: number
): Promise<{
  routingStrategy: RoutingStrategy;
  entities: IntentClassification["entities"];
  results: AgenticSearchResult[];
  metadata: { classificationConfidence: number; reasoning: string; durationMs: number };
}>
```

---

### Step 2 — Add `POST /mcp/query` route to `artifacts/api-server/src/routes/mcp.ts`

```
POST /mcp/query
Body (JSON):
  { q: string, project_id?: number, limit?: number }

Response 200:
  {
    query: string,
    routingStrategy: "vector_search" | "graph_traversal" | "direct_lookup" | "hybrid",
    entities: { moduleName?, commitHash?, searchQuery? },
    results: AgenticSearchResult[],
    metadata: { classificationConfidence, reasoning, durationMs }
  }

Response 400: { error: "q parameter required" }
Response 500: { error: string }
```

Input validation: use `zod` to parse the request body. The `q` field must be a non-empty string with max length 2000. `limit` must be between 1 and 50, defaulting to 10.

---

### Step 3 — Update `lib/api-spec/openapi.yaml`

Add the new `POST /mcp/query` endpoint with:
- Request body schema: `McpQueryInput`
- Response schema: `McpQueryResult` (includes `routingStrategy`, `entities`, `results[]`, `metadata`)
- `AgenticSearchResult` as a reusable `#/components/schemas` entry

---

### Step 4 — Regenerate Zod validators and React Query hooks (Orval)

Run `pnpm --filter @workspace/api-spec codegen` to regenerate:
- `lib/api-zod/src/generated/` — Zod schemas for `McpQueryInput`, `McpQueryResult`
- `lib/api-client-react/src/generated/` — `useMcpQuery` hook (POST, `useMutation`)

---

## 5. LLM System Prompt for Intent Classification

```
You are an intent classifier for a software knowledge graph query system.

Given a natural language query, classify the user's intent into exactly one of these strategies:
- "vector_search": The user wants to find conceptually related modules, documents, or decisions by topic/similarity.
- "graph_traversal": The user wants to know dependencies, dependents, or impact of a specific named module/component.
- "direct_lookup": The user is looking for a specific commit hash or decision record by exact identifier.
- "hybrid": The user wants both semantic discovery AND structural relationships (e.g., "find auth modules AND their dependencies").

Also extract:
- moduleName: if the query references a specific named module/component
- commitHash: if the query references a commit hash (hex string 4-40 chars)
- searchQuery: a cleaned-up search phrase for semantic search (omit filler words)

Return ONLY valid JSON with this exact shape:
{
  "strategy": "<strategy>",
  "entities": {
    "moduleName": "<string or null>",
    "commitHash": "<string or null>",
    "searchQuery": "<string or null>"
  },
  "confidence": <0.0–1.0>,
  "reasoning": "<one sentence>"
}
```

Use `model: "gpt-4o-mini"` (low cost, fast) via the existing `openai` client from `@workspace/integrations-openai-ai-server`.

---

## 6. Files to Create / Modify

| Action   | File                                                              | Notes                                                     |
| -------- | ----------------------------------------------------------------- | --------------------------------------------------------- |
| **Create** | `artifacts/api-server/src/lib/intent-router.ts`                 | Core module: classifier + handlers + orchestrator         |
| **Modify** | `artifacts/api-server/src/routes/mcp.ts`                        | Add `POST /mcp/query` route, import `routeQuery`          |
| **Modify** | `lib/api-spec/openapi.yaml`                                     | Add `McpQueryInput`, `McpQueryResult`, `AgenticSearchResult` schemas + POST /mcp/query path |
| Regenerate | `lib/api-zod/src/generated/`                                    | Auto-generated by Orval after openapi.yaml update         |
| Regenerate | `lib/api-client-react/src/generated/`                           | Auto-generated by Orval after openapi.yaml update         |

> **Do NOT modify** `lib/db/src/schema/` — no new database tables are needed.

---

## 7. Affected pnpm Workspace Packages

| Package                                    | Change type |
| ------------------------------------------ | ----------- |
| `artifacts/api-server`                     | Core implementation |
| `lib/api-spec`                             | OpenAPI schema update + Orval regeneration |
| `lib/api-zod`                              | Auto-regenerated (Orval) |
| `lib/api-client-react`                     | Auto-regenerated (Orval) |
| `lib/integrations-openai-ai-server`        | Read-only (consume existing `openai` client) |
| `lib/db`                                   | Read-only (no schema changes) |

---

## 8. Implementation Constraints & Notes

1. **No new DB tables**: All state lives in the existing `l2_nodes`, `l3_nodes`, `node_links`, `commits` tables.
2. **Graceful fallback**: If intent classification fails (LLM error / JSON parse error), fall back to `vector_search` automatically.
3. **Performance**: For `hybrid`, limit the secondary `graphTraversalHandler` calls to the top-3 vector results to avoid excessive DB round-trips.
4. **Security**: Zod-validate all request body fields at the boundary. The `q` field must be stripped/escaped before inclusion in LLM prompt to prevent prompt injection.
5. **ESM compliance**: All imports must use `.js` extension (TypeScript ESM monorepo convention).
6. **Error handling**: Wrap the entire `routeQuery` call in try/catch; return HTTP 500 with a sanitized error message — never expose raw LLM or DB error text to the client.
7. **Logging**: Use the existing `logger` from `artifacts/api-server/src/lib/logger.ts` to log `strategy`, `confidence`, and `durationMs` at `info` level for each request.

---

## 9. Architecture Diagram

```
                      ┌──────────────────────────────────────────────┐
                      │          POST /mcp/query                      │
                      │  { q, project_id?, limit? }                   │
                      └────────────────┬─────────────────────────────┘
                                       │
                      ┌────────────────▼─────────────────────────────┐
                      │         intent-router.ts                      │
                      │  classifyIntent(q)                            │
                      │  → { strategy, entities, confidence }         │
                      └────────────────┬─────────────────────────────┘
                                       │
               ┌───────────────────────┼───────────────────────┐
               │                       │                       │
    ┌──────────▼──────────┐ ┌──────────▼──────────┐ ┌─────────▼──────────┐
    │  vectorSearch       │ │  graphTraversal      │ │  directLookup      │
    │  Handler()          │ │  Handler()           │ │  Handler()         │
    │                     │ │                      │ │                    │
    │  generateEmbedding  │ │  nodeLinksTable      │ │  commitsTable      │
    │  cosineSimilarity   │ │  l2NodesTable        │ │  l3NodesTable      │
    │  l2+l3 tables       │ │  (deps + dependents) │ │  (by commitHash)   │
    └──────────┬──────────┘ └──────────┬──────────┘ └─────────┬──────────┘
               │                       │                       │
               └───────────────────────▼───────────────────────┘
                                       │
                      ┌────────────────▼─────────────────────────────┐
                      │   ResultAggregator (hybrid only)              │
                      │   merge + dedupe(nodeLayer, id) + re-rank     │
                      └────────────────┬─────────────────────────────┘
                                       │
                      ┌────────────────▼─────────────────────────────┐
                      │   Response: McpQueryResult                    │
                      │   { routingStrategy, entities,                │
                      │     results[], metadata }                     │
                      └──────────────────────────────────────────────┘
```

---

## 10. Acceptance Criteria

- [ ] `POST /mcp/query?q=...` returns 200 with `routingStrategy` field correctly reflecting the classified intent.
- [ ] `vector_search` queries return the same results as the existing `GET /mcp/search_knowledge` for the same input.
- [ ] `graph_traversal` queries for a known module name return non-empty `dependencies` or `dependents`.
- [ ] `direct_lookup` with a valid commit hash prefix returns the associated L3 decision nodes.
- [ ] `hybrid` results contain both vector and graph results, deduplicated.
- [ ] LLM classification failures fall back to `vector_search` without a 500 error.
- [ ] Request body with missing `q` returns HTTP 400.
- [ ] `q` field longer than 2000 characters returns HTTP 400.
- [ ] OpenAPI spec validates cleanly (`pnpm --filter @workspace/api-spec lint` or equivalent).
- [ ] TypeScript compiles without errors across all affected packages.
