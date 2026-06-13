# Architecture Review Fixes (Items 1.1.2, 1.2.2, 5.3.1, 6.5.2)

## 1. Implementation Goals
- **Goal 1 (Item 1.1.2)**: Eliminate schema drift warnings by ensuring `lib/db/package.json` contains a single source of truth for the `migrate` script. Enhance `migrate.ts` with Postgres Advisory Locks to prevent split-brain execution in distributed deployments, and ensure it runs as compiled JS in production.
- **Goal 2 (Item 1.2.2)**: Prevent SVN ingestion OOM and zombie processes by implementing a true SAX-based XML stream parser in `svn-client.ts`, adding `AbortController` timeouts, passing `--non-interactive`, and using strict database batching logic. 
- **Goal 3 (Item 5.3.1)**: Fix compilation/syntax errors in `generate.ts`. Reinforce Prompt Injection defense by shifting from arbitrary `<SYSTEM_CONSTRAINT>` wrappers to native LLM `system` role isolation and implementing robust `try/catch` blocks with circuit breakers.
- **Goal 4 (Item 6.5.2)**: Comply with the API-First strategy by defining `GET /projects/{id}/export/md` in `openapi.yaml`. Ensure the route correctly utilizes Chunked Streaming (`res.write`) and enforces explicit Auth/RBAC checks to prevent IDOR vulnerabilities.

## 2. Approach / Methodology

After a rigorous team debate (including SRE/Max's critical challenges), we settled on the following approaches:
- **Database Scripts**: Remove the duplicated `migrate` script. Refactor `migrate.ts` to include a PostgreSQL Advisory Lock to avoid race conditions (split-brain) when multiple pods start. Update `docs/design/07-deployment.md` to document that migrations should run via compiled JS (`node dist/migrate.js`) in production, avoiding `tsx` runtime overhead.
- **SVN Streaming**: We will replace `execFileAsync` + `RegExp` with a `spawn` call. Max explicitly rejected `readline` string patching, so we must use a true Node.js streaming SAX XML parser. We will add `--non-interactive` to prevent SVN from hanging on stdin, and use `AbortController` with `finally` kill blocks to prevent zombie processes. DB insertions will be strictly batched.
- **Backend Fixes**: Restore correct syntax block around `condenseL3Node` inside `generate.ts` and add robust LLM error handling. Instead of relying purely on `<SYSTEM_CONSTRAINT>` tags (which Max noted as "security theater"), ensure the LLM interface uses explicit `role: "system"` segregation and proper input sanitization.
- **API Codegen & Export**: Add `GET /projects/{id}/export/md` to the OpenAPI spec and trigger codegen. Max mandated that we ensure the route maintains chunked streaming and strictly verifies user ownership of the project via Auth/RBAC middleware to prevent IDOR.

## 3. Detailed Implementation Steps

### 3.1 Item 1.1.2: DB package.json & Schema Drift
1. Open `lib/db/package.json`.
2. Locate the shadowed `"migrate": "drizzle-kit migrate --config ./drizzle.config.cjs"` entry (line 12) and remove it, retaining `"migrate": "tsx src/migrate.ts"`.
3. Open `lib/db/src/migrate.ts` and add a PostgreSQL Advisory Lock mechanism before running migrations to prevent split-brain issues.
4. Open `docs/design/07-deployment.md` and explicitly document that migrations should be run using compiled JS in production (`node dist/migrate.js`) and that the script handles both Drizzle migrations AND seeding the initial `prompt_templates`.
5. Address the 16 to 18 tables drift by updating `schema.ts` to match the exact DB export.

### 3.2 Item 1.2.2: SVN Ingestion Streaming
1. Edit `artifacts/api-server/src/lib/svn-client.ts`.
2. Replace `execFileAsync` with `spawn("svn", ["log", "--xml", "--non-interactive", ...])`. Provide an `AbortController` signal to the process.
3. Remove custom `RegExp` and `readline` logic. Integrate a native streaming SAX parser (e.g., `sax` or `xml-stream` if available, or lightweight custom chunk parser if strictly restricted from new deps) to emit `<logentry>` events securely.
4. Ensure the `spawn` process is explicitly killed in a `finally` block if the pipeline crashes, preventing zombie processes.
5. In `artifacts/api-server/src/routes/ingest.ts`, implement logic to consume the stream and insert into DB in batches (e.g., 50-100 items) to prevent memory exhaustion.

### 3.3 Item 5.3.1: generate.ts fixes
1. Open `artifacts/api-server/src/routes/generate.ts`.
2. Add the missing import: `import { desc } from "drizzle-orm";`
3. Around line 191, remove the orphaned `} catch { return null; }`. Wrap the LLM chunk generation logic in a proper `try/catch` with fallback/circuit breaker logic.
4. Modify prompt construction. Eliminate reliance on pseudo-XML tags for system rules. Pass the system prompt directly as `{ role: "system", content: systemPrompt }` to the OpenAI client payload, ensuring strict separation from user/RAG context.

### 3.4 Item 6.5.2: Markdown export
1. Open `lib/api-spec/openapi.yaml`.
2. Find the `/projects/{id}/export` block. Add a new path underneath it: `/projects/{id}/export/md`.
3. Set `operationId: exportProjectMarkdown`, with `produces: text/markdown` or equivalent response type.
4. Open `artifacts/api-server/src/routes/export.ts`. Ensure `GET /projects/:id/export/md` uses `res.write` (Chunked Streaming) and includes authorization middleware to verify project ownership (IDOR prevention).
5. Run `pnpm --filter @workspace/api-spec run codegen`.

## 4. Implementation Details
- **Files Modified**: 
  - `lib/db/package.json`
  - `docs/design/07-deployment.md`
  - `artifacts/api-server/src/lib/svn-client.ts`
  - `artifacts/api-server/src/routes/generate.ts`
  - `lib/api-spec/openapi.yaml`
- **Workspaces Affected**: `@workspace/db`, `@workspace/api-server`, `@workspace/api-spec`, `@workspace/kg-engine`.

## 5. Next Steps
The Orchestrator should dispatch the **Backend Developer** agent first to resolve Items 1.2.2 and 5.3.1. 
Then, the Orchestrator should dispatch the **API Architect** to handle 6.5.2.
Finally, the **Database Schema Expert** can fix 1.1.2.
