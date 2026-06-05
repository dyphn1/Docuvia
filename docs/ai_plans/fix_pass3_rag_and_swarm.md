# Fix Pass 3: RAG Routing Arbitrator & Swarm Intelligence Distillation

## Objective
Eliminate the LLM arbitration tax for predictable queries and implement the background distillation job to turn human corrections into global prompt templates.

## Implementation Steps

### 1. Database Schema Update
- Edit `lib/db/src/schema/correction_examples.ts`.
- Add `processedAt: timestamp("processed_at")` to track which human corrections have been distilled.

### 2. O(1) Routing Funnel (`artifacts/api-server/src/lib/intent-router.ts`)
- Refactor `routeQuery` to implement a Fast Arbitration pipeline **before** calling `classifyIntent(query)`:
  - **Direct Filter**: Use regex to check for `#attach` or specific file path patterns (e.g., `src/`, `.ts`, `.md`). If found, return `{ strategy: "direct_lookup", entities: { searchQuery: query } }`.
  - **Graph Filter**: Fetch all L1 tags and L2 node names for the project. If `query` contains any of these known architectural terms, return `{ strategy: "graph_traversal", entities: { moduleName: matchedName } }`.
  - **Fallback**: Only if the above fail, `await classifyIntent(query)`.

### 3. Swarm Distillation Job (`artifacts/api-server/src/routes/metabolism.ts`)
- In the `GET /metabolism-tick` (or a dedicated distillation function called within it):
  - Fetch up to 10 rows from `correction_examplesTable` where `processedAt IS NULL`.
  - Use the LLM to summarize the `originalContent` vs `correctedContent` into a concise architectural guardrail.
  - Insert the resulting guardrail into `prompt_templatesTable` (creating global/project rules).
  - Update the fetched `correction_examples` rows, setting `processedAt` to `new Date()`.

## Verification
Ensure the `metabolism` tick properly compiles and updates rows, and the `intent-router` avoids LLM calls when `#attach` is present in the query string.