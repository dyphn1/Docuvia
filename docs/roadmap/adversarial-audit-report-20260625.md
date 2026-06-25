# Adversarial Documentation Audit & Remediation Plan (2026-06-25)

**Status:** CRITICAL FAILURE (Documentation vs. Implementation State)
**Auditors:** Sub-agents (PM, System Architect, Implementer, QA, SRE Challenger)

## 🚨 Executive Summary
The project's documentation and actual codebase have severely diverged, leading to an "operational hazard." The system suffers from a "Compliance Theater" where QA reports are generated but never acted upon, roadmaps contain "hallucinated" progress, and architectural decisions (ADRs) are either redundant, missing, or untracked.

## 💥 Core Vulnerabilities Discovered

### 1. Broken Feedback Loop (The QA Swamp)
- Over 80 QA reports exist in `docs/roadmap/reports/` containing critical vulnerabilities (e.g., IDOR in exports `0205_6.5.2`, bypassed commit scores `0214_1.2.5`, broken uploads, SVN architecture drift).
- **Issue:** These reports are "write-only." Known bugs and WARN states are **never** bubbled up to `action_plan_roadmap.md` or `master-roadmap.md`. 

### 2. Hallucinated Progress (Checklist Gaslighting)
- Items marked as `✅ Done` in `roadmap_checklist.md` are not actually completed.
- Examples: 
  - `3.4.3 docuvia sync CLI` (Missing client-side logic).
  - `1.4.2 Mutex` & `1.3.2 Vector Search` (Using temporary in-memory fallbacks, not `pgvector` or DB-level row locks).

### 3. Untracked Architectural Reality (The Milestone Cliff)
- `master-roadmap.md` arbitrarily truncates at **Milestone 4**.
- Codebase reality: Milestones 5, 6, and 7 (GitHub Webhooks, Slack/Teams bots, Markdown/JSON export, Review UI, VS Code Extension routes) are heavily implemented in the code but completely missing from the Master Roadmap.

### 4. ADR Chaos (Redundancy & Omissions)
- **Missing ADR Links in Roadmap:** ADR-011, 012, 016, 017, and 019 have no corresponding implementation tasks tracked in the roadmap.
- **Redundant AST ADRs:** ADRs `014`, `020`, `021`, and `022` all describe the AST architecture. `022` is the only one tracked, leaving massive ambiguity about the status of the others.
- **Missing Major ADRs:** Action plan mentions transitioning to `pgvector`, but no ADR governs this fundamental data-layer change.

---

## 🛠️ Remediation Action Plan (To Execute Sequentially)

### Phase 1: Drain the QA Swamp (✅ COMPLETED)
- **Action Taken:** Parsed all 80+ reports in `docs/roadmap/reports/`. Extracted 29 reports containing `WARN`, `ERROR`, or `MEDIUM/HIGH` severity bugs. These have been forcefully appended to the **Appendix** of this document to prevent them from rotting in isolation. They must be tracked and resolved.

### Phase 2: Purge ADR Chaos & Sync Master Roadmap
- **Goal:** 
  1. Consolidate AST ADRs (014, 020, 021, 022) into a single SSOT. Write the missing `pgvector` ADR.
  2. Extend `master-roadmap.md` to cover Milestones 5-7 based on the existing `artifacts/api-server` routing reality.

### Phase 3: Correct Checklist Integrity
- **Goal:** Revert false `✅ Done` items in `roadmap_checklist.md` back to `WIP` or `TODO` (e.g., Sync CLI, true DB Mutex, true Vector DB). Link orphaned items to their corresponding ADRs.

---
*Note: Do not proceed with new feature development until Phase 1-3 are completed. Documentation bankruptcy must be resolved to prevent AI hallucination loops.*
## 🗃️ Appendix: Exhaustive QA Swamp Extraction

The following is an exhaustive extraction of all `WARN`, `ERROR`, and `MEDIUM/HIGH` severity bugs found rotting inside the `docs/roadmap/reports/` directory. These must be migrated to `master-roadmap.md` or fixed immediately.

### Report: `0205_6.5.2.md` - Verification Report: 6.5.2 — Markdown Export

1. **🔴 Hardcoded fallback userId.** `export.ts:18`: `const userId = (req as any).user?.id || 1;` — When no authenticated user is present (no auth middleware sets `req.user`), the middleware defaults to `userId = 1`. This means unauthenticated requests will be treated as user ID 1, potentially granting access to projects owned by user 1. This is a security vulnerability if auth middleware is not yet deployed. The comment on line 17 acknowledges this: "Fake userId extracted from bearer token (impl...


2. **🟡 No Zod validation on path parameter.** The endpoint uses raw `Number(req.params.id)` without a Zod validator. While `NaN` produces a 404 (no project found with NaN ID), this bypasses the project's standard validation pattern. The OpenAPI spec defines the `id` parameter as `type: integer`, but no generated Zod validator is applied in the route handler.


3. **🟡 No error handling during stream.** The streaming loop (export.ts:143-175) has no `try/catch`. If a database error occurs mid-stream, the client receives a truncated file. The `res.on('error')` event is not handled.


4. **🟡 N+1 query pattern.** For each L2 node in the batch, a separate query fetches its L3 nodes (export.ts:160-163). For projects with many L2 nodes, this produces N+1 queries per batch.

### Report: `0210_1.2.1.md` - Verification Report: Item 1.2.1 — Git Ingestion via child_process.spawn Streaming

1. **🟡 Medium — Noise commits are ingested, not filtered:** `scoreCommit()` returns `{ valid: false }` for noise patterns (merge commits, version bumps, etc.), but `processIngestion` at ingestion-pipeline.ts line 90 still inserts the commit with `valid: false`. The design (arc42 section 4.2) describes `scoreCommit` as a "signal/noise filter," suggesting noise commits should be skipped entirely rather than stored with a `valid=false` flag. Currently, noise commits consume DB space and will need t...


2. **🟡 Medium — Silent diff failure:** `getDiff()` (git-client.ts lines 157-168) resolves with an empty string `""` on both non-zero exit codes and error events. While this prevents a single failed diff from aborting the entire ingestion, it means commits will be ingested with empty diffs without any warning logged at a visible level. The `logger.warn` calls are present but the ingestion pipeline has no way to know the diff was empty due to failure vs. genuinely empty.


1. **🟡 Medium — `repoUrl` passed directly to `git clone`:** The `repoUrl` from the request body (or project record) is passed directly to `execFileAsync("git", ["clone", ..., repoUrl])` without URL validation. While the route handler checks if `repoUrl` is truthy, it doesn't validate the URL format. A malicious or malformed URL could potentially exploit shell injection if the underlying `execFile` implementation is not properly escaping arguments. However, since `execFile` (not `exec`) is used, ...

### Report: `0211_1.2.2.md` - Design Verification Report — Item 1.2.2

1. **❌ Missing `VcsIngestAdapter` interface and `SvnIngestAdapter` class.** The design (08-cutting-concepts.md §8.3 POP) explicitly defines a `VcsIngestAdapter` interface:

   ```
   interface VcsIngestAdapter {
     ingest(input: IngestInput): Promise<IngestResult>;
   }
   ```

   Neither this interface nor a `SvnIngestAdapter` implementation exists anywhere in the codebase. The SVN ingestion logic is embedded directly in the `ingest.ts` route handler rather than being abstracted behind the ad...


2. **⚠️ URL validation regex excludes `svn+ssh://`.** The route handler (line 117) validates:

   ```typescript
   if (!/^http?:\/\/|^svn:\/\//.test(svnUrl))
   ```

   This allows `http://`, `https://`, and `svn://` but **rejects `svn+ssh://`**, which is explicitly listed as a valid example in the OpenAPI schema description: "SVN repository URL (e.g. svn+ssh://... or https://...)". This is a spec-implementation mismatch.


3. **⚠️ `processIngestion` for SVN stores `diff` concatenated into `message`.** At line 136-141:
   ```typescript
   const fullMessage = c.diff ? `${c.message}\n\n${c.diff}` : c.message;
   // ...
   message: fullMessage.slice(0, 4000),
   ```
   Git ingestion stores only `c.message` in the message field (line 93). SVN conflates the commit message with the full diff, which means:
   - The actual commit message is lost after 4000 chars when diff is large.
   - Query results will show diffs instea...


1. **⚠️ No transactional safety for SVN commits (unlike Git).** The Git path in `processIngestion` (line 72) wraps its batch in `db.transaction()`. The SVN path (line 118) processes each revision individually without any transaction wrapper. If the process crashes mid-batch, some revisions will be inserted and others won't, with no rollback. The route-level `flushBatch` does batch commits into `processIngestion`, but `processIngestion` itself does not wrap the loop body for SVN type in a transac...


2. **⚠️ `password` visible in process arguments.** The password is passed as a command-line argument to `svn` via both `spawn` and `execFile`. While this avoids shell injection, on some systems command-line arguments are visible to all users via `ps` or `/proc`. Consider using SVN's `--password-file` option or environment variables if supported.


3. **⚠️ OpenAPI response codes incomplete.** The route can return:
   - `200` — documented ✅
   - `400` (validation error) — **not documented** in OpenAPI spec
   - `404` — documented ✅
   - `502` (SVN log failure) — **not documented** in OpenAPI spec
   - `500` (from `processIngestion` errors) — **not documented** in OpenAPI spec


4. **⚠️ Redundant Zod parsing.** Line 108 uses `IngestSvnBody.parse(req.body)` for the full body, but line 113 then parses `mode` again separately with `SvnModeSchema.parse(req.body)`. The `mode` is already part of `SvnIngestInput` and validated by `IngestSvnBody`. This is redundant.


5. **⚠️ No error response standardization for Zod failures.** Lines 109-111 return the raw Zod error object as `details` in the 400 response. This leaks internal validation details that could reveal schema structure.


6. **⚠️ `response` object is not typed.** The route handler parameter `res` is not typed as `express.Response`, losing type safety for response methods.

---

## Round 3 — Integration & Completeness Review

### Integration Correctness


1. **❌ No tests for SVN ingestion.** The search for `*.test.ts` files containing "svn" returned zero results. No unit tests for `getSvnLog`, `getSvnDiff`, or the SVN ingest route exist. The Git ingestion also lacks integration tests.


2. **❌ No mock SVN CLI fixture.** For integration testing, there are no MSW fixtures or mock SVN binary fixtures that would allow testing the SVN ingest path without requiring a real SVN installation.


3. **⚠️ `svn+ssh://` URLs blocked.** As noted in Round 1, the URL validation regex prevents `svn+ssh://` URLs, which are common in enterprise environments. This is a functional gap.

---

## Findings Summary

| #   | Severity   | Category      | Finding                                                                                                               |
| --- | ---------- | ------------- | -------------------------------------------------------------------------------------------------...

### Report: `0214_1.2.5.md` - Verification Report: Item 1.2.5 — scoreCommit() Signal/Noise Filter

1. **🔴 Medium — `github_webhooks.ts` ignores scoreCommit result** (lines 56-64):
   The `score` return value from `scoreCommit()` is captured into a local variable and then completely discarded. The `valid` field is hardcoded to `true`. This means:
   - Merge commits from PRs, `dependabot` commits, and `chore:` commits enter the database as `valid: true`.
   - These commits will be processed by the generate pipeline, wasting LLM tokens and potentially polluting the knowledge graph.
   - The `sco...


2. **🟡 Medium — Noise commits inserted rather than skipped** (`ingestion-pipeline.ts` lines 84-100, 135-147):
   The `valid` result from `scoreCommit()` is only used to set the boolean flag, never to skip the INSERT. A simple `if (!valid) { skipped++; continue; }` guard would align the implementation with the design intent.


3. **🟡 Low — No unit tests for `scoreCommit()`**:
   A grep for `scoreCommit` or `commit-scorer` across all test files returns zero results. The scoring logic is sufficiently complex (10 noise patterns, 9 signal patterns, bonus arithmetic) to warrant dedicated unit tests covering:
   - Noise pattern matching (all 10+ patterns)
   - Signal pattern scoring accumulation
   - Edge cases: empty message, undefined message, long message
   - Diff bonus: TODO/FIXME detection, line counting
   - Score cl...

### Report: `0219_1.4.1.md` - Verification Report: Item 1.4.1 — Asynchronous Metabolism Mechanism (ADR-008)

3. **⚠️ No authentication on client tick endpoint**: `GET /api/metabolism-tick` has no authentication at all. Any caller can trigger metabolism work. While this is a relatively low-risk endpoint (it only processes pending internal tasks), it could be abused for DoS by repeatedly triggering expensive LLM operations. Consider adding at least a lightweight shared-secret check.


4. **⚠️ `GITHUB_TOKEN` from env without validation**: `metabolism.ts:55` reads `process.env.GITHUB_TOKEN` but doesn't validate its presence before the merge gate loop. If the token is missing, the GitHub API calls will fail silently (caught by try/catch at line 69), and no L3 nodes will be promoted. This is acceptable fallback behavior but could lead to silent failures.

### Code Quality Findings


1. **⚠️ Distillation marks corrections as processed even on failure**: At `metabolism.ts:129`, `processedIds.push(correction.id)` is inside the `try` block but after the LLM call. If `openai.chat.completions.create` throws, the correction is NOT added to `processedIds` (correct). However, if the LLM returns a response but `guardrail` is falsy (empty string, null), the correction IS added to `processedIds` at line 129 but no prompt template is created. This means corrections can be silently marke...


2. **⚠️ No batch size limit on merge gate**: The merge gate query at `metabolism.ts:21-36` has no `.limit()`. If thousands of L3 nodes are pending, all will be fetched and processed in a single tick. This could cause memory pressure and long-running requests.


3. **⚠️ Sequential LLM calls in distillation loop**: The distillation job at `metabolism.ts:102-133` calls the LLM sequentially for each correction. With a limit of 10, this could take a significant amount of time. No timeout or overall time budget is enforced.


6. **⚠️ `any` type usage**: `metabolism.ts:99` uses `const promptsToInsert: any[]` — should use the proper Drizzle insert type.

---

## Round 3 — Integration & Completeness Review

### Integration Findings


4. **⚠️ No tests for metabolism**: Zero test files cover the metabolism feature. The ADR explicitly requires:
   - **DLQ Routing Proof**: "Vitest DB tests using `withRollback(...)` MUST inject a mocked deterministic-failing task. The test MUST tick the worker 3 times and explicitly assert the task transitions to the `DEAD_LETTER_QUEUE` status."
   - **Mutex Lock Proof**: "Concurrent test runners MUST attempt to claim the same pending task simultaneously. DB assertions MUST prove exactly 1 worker...


5. **⚠️ No OpenAPI spec coverage**: The metabolism endpoints (`/api/metabolism-tick`, `/api/admin/metabolism-tick`) are not defined in the OpenAPI spec. Per project conventions, all API routes should be in `openapi.yaml` and codegen'd via Orval.


6. **⚠️ `job_queue` table not in generate pipeline**: The generate route (`generate.ts`) manages project status directly on `projectsTable.status` rather than using the `job_queue` table. This means the job queue is completely disconnected from the actual async work.

### Completeness Summary

| Feature                                              | Implemented | Tested | In OpenAPI |
| ---------------------------------------------------- | ----------- | ------ | ---------- |
| Client heartbeat ...

### Report: `0235_3.3.1.md` - Verification Report: Item 3.3.1 — O(1) Fast-Path Filters (#attach)

3. **⚠️ O(1) claim is inaccurate for Layer 3:** The ADR-007 describes the L1/L2 check as O(1), but the implementation loads ALL L1 tags and ALL L2 nodes into memory and iterates through them. This is O(N) where N = number of tags + nodes. For large knowledge graphs, this could be significant. The design doc itself acknowledges this should be a fast cache check, but the implementation does a full table scan.


4. **⚠️ Single-word path bypasses `#attach`/extension filter:** A query like `auth.ts` (single word, >3 chars) would enter Layer 1 first. If no DB results are found, it falls through to Layer 2 where the `.ts` extension would match. This is acceptable behavior but means the single-word path adds a DB query overhead before the regex filter runs.

---

## Round 2 — Code Quality & Security Review

### Critical Bug: `validityStatus` Value Mismatch

**Severity: HIGH**

In `directLookupHandler()`, lin...


1. **⚠️ No unit tests for fast-path routing logic:** The unit test file (`intent-router.unit.test.ts`) only tests `escapeLike`, `calculateTemporalDecay`, and `sanitizeQuery`. It does NOT test:
   - The single-word short-circuit logic
   - The `#attach`/file extension regex matching
   - The L1/L2 term matching
   - The overall `routeQuery()` orchestration


2. **⚠️ No integration tests for LLM bypass:** ADR-007 explicitly requires integration tests that use MSW to assert "0 external HTTP requests are made to the AI server" during fast-path hits. No such tests exist. The only integration test infrastructure found is the unit test file.


3. **⚠️ `routeQuery()` function exceeds recommended length:** The function is ~127 lines (lines 614-740). The coding rules in section 8.3.5 specify a maximum of 100 lines per function. This is a minor style concern.


6. **⚠️ Inconsistent `includePending` default in MCP route:** In `mcp.ts` line 218, the `includePending` is read from `req.query.include_pending` but the POST body is parsed separately. The `includePending` is not extracted from the Zod-validated body, only from the query string. This means POST requests with `includePending` in the body will be ignored.

---

## Round 3 — Integration & Completeness Review

### Integration Coverage


3. **❌ No fast-path verification tests:** The ADR-007 "Verifiability" section explicitly requires:
   - **Fast-Path Assertion:** Integration tests that seed the DB, trigger an exact-match query, and assert 0 external HTTP requests via MSW.
   - **Fallback Assertion:** Queries below the similarity threshold must assert exactly 1 MSW-intercepted request.

   Neither assertion exists in the test suite. The only test file is `intent-router.unit.test.ts` which tests utility functions, not the routing...


2. **⚠️ Performance concern with Layer 3:** The L1/L2 term matching loads all tags and nodes on every non-single-word query. For a knowledge graph with thousands of L2 nodes, this could add significant latency — partially defeating the purpose of the O(1) fast-path. A more efficient approach would be to use a database-side `ILIKE` query or maintain an in-memory trie/cache.


3. **⚠️ Missing `pg_trgm` usage:** The code comment on line 522 says "We would ideally use Postgres Full Text Search (to_tsvector/to_tsquery) but sticking to ILIKE for architectural continuity here." The ADR-007 mentions `pg_trgm` in the sequence diagram. The current implementation doesn't leverage PostgreSQL's trigram indexing, which would be more efficient for fuzzy matching.

---

## Findings Summary

| #   | Severity        | Finding                                                           ...

### Report: `0236_3.2.2.md` - Verification Report: Item 3.2.2 — Decay Application on Knowledge Query Results

2. **❌ Vector search fallback**: L2 fallback (line 336) and L3 fallback (line 377) use fixed scores (0.9, 0.8) with no decay applied, violating the universal decay requirement.


3. **❌ Graph traversal**: All scoring uses fixed constants (seed: 1.0, related L2: 0.8, L3 decisions: 0.9) with no decay applied.


4. **❌ Direct lookup**: Hash match (line 513) and ILIKE match (line 547) use fixed scores (1.0, 0.8) with no decay applied.


5. **❌ Validity status bug**: Lines 500 and 535 still check for `validityStatus !== 'active'` instead of `'valid'`, breaking the direct lookup path when `includePending=false`.


6. **⚠️ Hybrid search**: Combines decayed vector results with non-decayed graph results; the merge scoring boost (`existing.score += r.score + 0.5`) can push older, non-decayed graph results above newer, decayed vector results.


7. **❌ Single-word fast-circuit**: Routes to `directLookupHandler` which applies no decay, meaning the fastest path returns results without age-based ranking.

**Design Gap**: The specification requires universal decay application so that "knowledge untouched naturally sinks to the bottom," but decay is only applied in 1 of 6 query paths (vector search with embeddings). This creates inconsistent behavior where the same query may return different rankings depending on which strategy is selected.
...


1. **❌ Inconsistent decay application**: Decay logic is duplicated where present (vector search) rather than centralized. No shared `applyDecayToResults()` utility exists.


2. **❌ Magic numbers**: Fixed scores (1.0, 0.9, 0.8) are hardcoded throughout handlers without decay adjustment.


3. **❌ Function length**: `vectorSearchHandler()` exceeds 180 lines, violating the 100-line recommended maximum.


4. **❌ Missing tests**: No unit tests for decay application in graph traversal, direct lookup, or fallback paths.

### Security Review

- **✅ Input validation**: All queries use parameterized Drizzle ORM — no SQL injection risk.
- **✅ Validity status**: Despite the 'active' vs 'valid' bug, the schema correctly defines the enum as `pending | valid | orphaned`.
- **✅ Error handling**: `classifyIntent()` has proper fallback to `vector_search` on failure.

### Critical Bug Re-Confirmation

The `vali...

### Report: `0237_3.4.1.md` - Verification Report: Item 3.4.1 — Orphan Branch Writer (Centralized w/ Advisory Locks)

5. **⚠️ L1 tags are always empty:** `buildL1TagsYaml([])` is called with an empty array on line 103. The function never queries the `l1_tags` table. The `l1_tags.yaml` file will always contain `tags: []`. This is a gap between the design (which specifies L1 tags should be written) and the implementation.


6. **⚠️ No 3-way merge support:** ADR-004 states: "the API Server performs a standard Git 3-way merge on the orphan branch. If conflicts occur, it returns 409 Conflict." The current implementation uses `git fast-import` with `deleteall`, which **overwrites** the entire tree. It does not perform a 3-way merge and cannot detect or report conflicts. This is a significant gap for concurrent client pushes.


7. **⚠️ Double advisory lock acquisition:** The `sync.ts` route acquires `pg_try_advisory_xact_lock` on lines 29-36, then calls `writeKnowledgeToOrphanBranch()` which also acquires the same lock on lines 73-81. Since `pg_try_advisory_xact_lock` is transaction-scoped and the same transaction is used (the `db.transaction()` call in sync.ts), the second lock attempt within the same transaction will succeed (Postgres advisory locks are reentrant within the same session). However, this is redundant a...


8. **⚠️ `generate.ts` does NOT call orphan branch writer:** The `POST /projects/:id/generate` endpoint creates L1/L2/L3 nodes in PostgreSQL but does NOT call `writeKnowledgeToOrphanBranch()`. This means the orphan branch is only updated when `POST /sync/push` is called, not when the generate pipeline runs. The generate pipeline is the primary way knowledge is created, so the orphan branch will be stale unless sync is explicitly called.

---

## Round 2 — Code Quality & Security Review

### Secur...


1. **🔴 Command injection risk in `buildFastImportData`:** The `fastImportData` string is constructed from user-controlled data (L2 node names, L3 titles/content, commit hashes) and passed to `git fast-import` via `printf '%s' ${JSON.stringify(fastImportData)}`. While `JSON.stringify` provides some escaping, the `filePath` in the fast-import stream is not escaped — it's derived from `slugify()` which restricts to `[a-z0-9-]`, so file paths are safe. However, the **content** of the files is embedd...


2. **⚠️ No input sanitization on L2/L3 content:** The `buildL2ModuleYaml` and `buildL3DecisionMd` functions escape double quotes (`\"`) but do not sanitize against YAML injection (e.g., `description: "!!python/object/apply:os.system ['rm -rf /']`). Since the output is YAML frontmatter in Markdown files, this is low-risk, but proper YAML serialization (using a library like `js-yaml`) would be safer than string concatenation.


3. **⚠️ `buildL1TagsYaml` is a no-op:** The function is always called with an empty array. Either the L1 tags should be queried from the database, or the function should be removed.


4. **⚠️ `slugify` is duplicated:** The `slugify` function is defined locally in `orphan-branch-writer.ts`. If other modules need slugification, this should be a shared utility.


5. **⚠️ No unit tests for `orphan-branch-writer.ts`:** There are zero tests for this module. The ADR-004 "Verifiability" section requires: "Outbox Sync Guarantee: API server integration tests MUST use `withRollback(...)` to insert a pending Git synchronization event into the Outbox table. A worker tick MUST assert the `git` command execution (via mocked `child_process` or equivalent) and the subsequent deletion/status-update of the Outbox row." No such test exists.


6. **⚠️ No integration test for `POST /sync/push`:** The sync route has no integration tests. The only integration test for the sync/generate pipeline is `generate.test.ts` which tests the generate endpoint, not the sync endpoint.


7. **⚠️ `sync.ts` has incomplete event handlers:** Line 51 says `// ... (other handlers omitted for brevity)` — the `DELETE_L3`, `CREATE_L2`, and `UPDATE_L2` event types defined in the schema (line 14) are not implemented. Only `CREATE_L3` and `UPDATE_L3` have handlers.

---

## Round 3 — Integration & Completeness Review

### Integration Coverage


3. **❌ Orphan branch writer is NOT called from generate:** The `POST /projects/:id/generate` endpoint (1210 lines) creates L1/L2/L3 nodes in PostgreSQL but never calls `writeKnowledgeToOrphanBranch()`. This means the orphan branch is only updated via explicit sync calls, not via the generate pipeline. This is a significant integration gap — the generate pipeline is the primary knowledge creation path.


4. **❌ No tests for orphan branch writer:** Zero unit tests and zero integration tests for the orphan branch writer. The ADR-004 verifiability requirements are not met.


5. **❌ No tests for sync route:** Zero integration tests for `POST /sync/push`.

### Completeness


3. **⚠️ L1 tags not populated:** The `l1_tags.yaml` file is always empty. The L1 tags table is never queried.


4. **⚠️ No 3-way merge:** ADR-004 requires 3-way merge with 409 Conflict on merge conflicts. The current implementation uses `fast-import` with `deleteall` which overwrites the tree. This is acceptable for the server-authoritative model but doesn't support concurrent client pushes.


5. **⚠️ Incomplete sync event handlers:** Only `CREATE_L3` and `UPDATE_L3` are handled. `DELETE_L3`, `CREATE_L2`, and `UPDATE_L2` are defined in the schema but not implemented.


6. **⚠️ No git hook template:** ADR-008 and the implementation plan specify a `post-push` git hook template (`githook-template.sh`) that triggers `docuvia sync`. This file does not exist in the codebase.


7. **⚠️ No `docuvia sync` CLI:** The `docuvia sync` CLI command (item 3.4.3) is marked as ✅ in the checklist but the roadmap analysis noted it as "not yet implemented." The orphan branch writer depends on this CLI being available for the sync flow to work end-to-end.

### Performance Considerations


2. **⚠️ Full tree rewrite on every sync:** The `deleteall` approach rewrites ALL files for the project, even if only one L3 node changed. For large knowledge graphs, this could generate large git objects. An incremental approach (only writing changed files) would be more efficient.


3. **⚠️ All L2/L3 nodes loaded into memory:** The function loads all L2 nodes and all their L3 nodes into memory simultaneously. For projects with thousands of nodes, this could cause memory pressure.

---

## Findings Summary

| #   | Severity      | Finding                                                                                                                                |
| --- | ------------- | ---------------------------------------------------------------------------------------...

### Report: `0238_3.4.2.md` - Verification Report: Item 3.4.2 — Bidirectional Sync between Client and Server

3. **❌ Client → Server push is never triggered:** The `CentralServerClient.sync()` method exists but is **never called** from any code path in the extension. There is no automatic or manual mechanism to push local changes to the server. The bidirectional sync is therefore **half-implemented** — only the pull direction works.


4. **❌ No `docuvia sync` command:** There is no VS Code command (e.g., `docuvia.sync`) that would allow the user to manually trigger a sync. The `docuvia.addDecision` command handler is commented out (line 160-161: `// await addDecision(context, store);`).


5. **❌ No automatic sync on knowledge change:** When the `TaskRunner` writes extraction results to `.docuvia/` files (in `writeExtractionResults`), it calls `this.store.load()` to reload the local snapshot, but it does NOT call `centralClient.sync()` to push changes to the server. Local changes stay local.


6. **⚠️ `GET /projects/:id/graph` returns empty L1 tags:** The graph endpoint hardcodes `l1Tags: []` (line 180). The L1 tags are never queried from the database. This means the client always receives an empty L1 tag list when pulling from the server.


7. **⚠️ `POST /sync/push` has incomplete event handlers:** Only `CREATE_L3` and `UPDATE_L3` are implemented. `DELETE_L3`, `CREATE_L2`, and `UPDATE_L2` are defined in the schema but have no handlers (line 51: `// ... (other handlers omitted for brevity)`).


8. **⚠️ No WebSocket or SSE for server push:** ADR-004's sequence diagram shows a Sync ACK response, but there is no mechanism for the server to proactively push updates to the client. The client must poll or manually reload. This is acceptable for v1 but limits real-time sync.

---

## Round 2 — Code Quality & Security Review

### Security Findings


4. **⚠️ No HMAC or signature on sync payload:** Unlike GitHub webhooks (which use HMAC-SHA256), the sync endpoint relies solely on the bearer token for authentication. This is acceptable for a bearer-token model but means any token holder can push arbitrary events.


5. **⚠️ No rate limiting on sync endpoint:** The sync route has no rate limiting. An attacker with a valid token could flood the endpoint with events, each of which triggers `writeKnowledgeToOrphanBranch()` (which runs `git fast-import`).


4. **⚠️ `sync()` method signature mismatch with server:** The client's `sync()` method sends `{ projectId, pushedBranch, pushedCommits }` but the server's `POST /sync/push` expects `{ projectId: number, events: [...] }`. The client sends branch/commits while the server expects a CQRS outbox event format. **These are incompatible** — even if the client called `sync()`, the server would reject the payload as invalid (the server expects `events` array, not `pushedBranch`/`pushedCommits`).


5. **⚠️ No tests for bidirectional sync:** There are no unit tests for `CentralServerClient.sync()` or `CentralServerClient.pullSnapshot()`. There are no integration tests for the sync route. The only integration tests are `generate.test.ts` and `mcp-list-projects.test.ts`.


6. **⚠️ `KnowledgeStore.load()` doesn't push after pull:** After successfully pulling from the server, the store doesn't check whether there are local changes that should be pushed back. A true bidirectional sync would reconcile local and remote state.

---

## Round 3 — Integration & Completeness Review

### Integration Coverage


4. **❌ Push path is NOT integrated:** `CentralServerClient.sync()` is defined but never invoked. There is no code path that triggers a push from client to server.


5. **❌ No reconciliation logic:** There is no logic to detect conflicts between local and remote state, no merge strategy, and no conflict resolution UI.


6. **❌ No sync status indicator:** The extension has no way to show the user whether local changes have been synced to the server.

### Completeness

| Component                                | Status                              |
| ---------------------------------------- | ----------------------------------- |
| Client pull from server (`pullSnapshot`) | ✅ Implemented and integrated       |
| Client push to server (`sync` method)    | ✅ Implemented but **never called** |
| Server receive pus...


2. **⚠️ No incremental sync:** The client always pulls the full snapshot. There is no delta-based sync that would only fetch changes since the last sync.


3. **⚠️ `KnowledgeStore.load()` blocks on server:** If the server is slow or unreachable, the `await this._client.pullSnapshot()` call will block the entire load process before falling back to local. A timeout or parallel approach would be more resilient.

---

## Findings Summary

| #   | Severity      | Finding                                                                                                                                                                                         |...

### Report: `0239_3.4.3.md` - Verification Report: Item 3.4.3 — docuvia sync CLI

1. **🟡 Medium — CLI uses `MCP_PAT` env var for auth:** The CLI passes the token as a `Bearer` header, which is correct. However, the githook template does not document how `MCP_PAT` should be set in the hook environment. Git hooks run in a limited environment and may not inherit `.env` files.


2. **🟡 Medium — No input validation on project ID:** `cli.ts` passes `process.argv[3]` directly to the URL template without validating it's a numeric ID. A malicious or malformed argument could cause unexpected URL construction.


1. **🟡 Medium — `scripts/package.json` has no `bin` entry:** The CLI cannot be installed as a `docuvia` command via `npm install -g` or `pnpm link`. It can only be run via `tsx ./scripts/src/cli.ts`, which is not a distributable CLI.


2. **🟡 Medium — No build script for CLI:** The `scripts/package.json` has `"hello": "tsx ./src/hello.ts"` but no `"build"` or `"cli"` script. There is no compiled output.

### Report: `0284_6.1.1.md` - Verification Report: Item 6.1.1 — openapi.yaml as single source of truth

1. **🔴 Extensions VS Code routes use raw Zod, not generated schemas.** `extensions_vscode.ts` defines its own Zod schemas inline (`z.object({...})`) instead of importing from `@workspace/api-zod`. This means the VS Code extension endpoints bypass the API-first pipeline. While the OpenAPI spec defines `VscodeQueryInput` and `VscodeCreateDecisionInput`, the server doesn't use the generated validators.


2. **🔴 Metabolism routes have no spec and no generated types.** The `/metabolism-tick` and `/admin/metabolism-tick` endpoints are administrative/debug endpoints that are not in the spec. This is a minor concern (they're internal) but violates the "all routes in spec" principle.


3. **🟡 `/sync/path` path mismatch.** The spec defines `POST /sync` but the server implements `POST /sync/push`. This means the generated client will call `/sync` but the server expects `/sync/push`, causing a 404 at runtime. This is a **functional bug** — the sync endpoint is broken for any client using the generated hooks.


4. **🟡 `/projects/:id/sync` is a completely separate sync endpoint.** The `projects.ts:240` route handles project-specific sync, but the spec has no such path. This appears to be a different sync mechanism than the `/sync` endpoint.


5. **🟡 Build artifact ingestion not in spec.** The `POST /projects/:id/ingest/build-artifact` endpoint is implemented but not documented in the spec. This means no generated types or client hooks exist for it.


1. **🔴 Fix `/sync` path mismatch.** The spec defines `POST /sync` but the server implements `POST /sync/push`. Either update the spec to `/sync/push` or update the server to `/sync`. This is a functional bug — the generated client will get a 404.


2. **🔴 Add missing server routes to OpenAPI spec.** The following endpoints need to be added to `openapi.yaml`:
   - `POST /projects/{id}/sync` (project-specific sync)
   - `POST /projects/{id}/ingest/build-artifact` (build artifact ingestion)
   - `POST /admin/reindex-embeddings` (admin reindex)
   - `POST /documents` (direct document upload)
   - `GET /mcp/read_shared_memory` and `GET /mcp/retrieve_original` (MCP internal tools)
   - `GET /metabolism-tick` and `GET /admin/metabolism-tick` (or ...


3. **🟡 Use generated Zod schemas in extensions_vscode.ts.** Replace the inline `z.object({...})` definitions with imports from `@workspace/api-zod` to maintain API-first consistency.


4. **🟡 Add CI check for spec-to-server alignment.** Implement a CI step (or a script) that verifies all server routes are defined in the OpenAPI spec. This could be a simple comparison of `router.get/post/put/patch/delete` calls against spec paths.

### Report: `0285_6.1.2.md` - Verification Report: Item 6.1.2 — Orval codegen → Zod validators + React Query hooks

1. **🔴 Server routes define inline Zod schemas instead of using generated ones.** At least 8 route files define their own `z.object({...})` schemas:
   - `integrations.ts`: `IntegrationInputSchema`, `IntegrationUpdateSchema`
   - `llm_config.ts`: `LlmConfigInputSchema`
   - `extensions_vscode.ts`: `VscodeQuerySchema`, `VscodeCreateDecisionSchema`
   - `search.ts`: `SearchSchema`, `FeedbackSchema`
   - `l2_nodes.ts`: `NodeLinkInputSchema`
   - `mcp.ts`: `mcpQueryBodySchema`
   - `templates.ts`: `...


2. **🟡 Codegen cannot run in current environment.** Running `pnpm --filter @workspace/api-spec run codegen` fails with `orval: command not found` because `node_modules` is not installed for the api-spec package. This is an environment issue (not a code issue), but it means the codegen pipeline hasn't been exercised recently.


3. **🟡 No CI enforcement of codegen freshness.** There is no CI step that verifies the generated files are in sync with `openapi.yaml`. A spec change could be committed without running codegen, and CI would not catch it.

**Round 1 Verdict: WARN** — The codegen pipeline architecture is excellent. Orval is properly configured, generated files are comprehensive and correctly structured, hook count matches operationId count, and the custom fetch wrapper is well-engineered. However, multiple server ...


1. **🔴 Inline Zod schemas duplicate spec-defined types.** The following routes define their own Zod schemas for types that likely exist in the OpenAPI spec:
   - `search.ts`: `SearchSchema`, `FeedbackSchema` — spec defines `SearchInput`, `SearchFeedbackInput`
   - `l2_nodes.ts`: `NodeLinkInputSchema` — spec defines `NodeLinkInput`
   - `templates.ts`: `TemplateUpdateSchema` — spec likely defines template update types
   - `documents.ts`: `AffiliateBodySchema` — spec defines `AffiliateDocumentInp...


2. **🟡 Extensions VS Code routes use raw Zod exclusively.** `extensions_vscode.ts` defines `VscodeQuerySchema` and `VscodeCreateDecisionSchema` inline, even though the spec defines `VscodeQueryInput` and `VscodeCreateDecisionInput`. This is a code quality concern — the VS Code extension endpoints should use the generated validators.


3. **🟡 MCP route uses inline schema.** `mcp.ts:230` defines `mcpQueryBodySchema` inline, but the spec defines `McpQueryInput`.


1. **🔴 Replace inline Zod schemas with generated ones.** The following route files should import Zod validators from `@workspace/api-zod` instead of defining them inline:
   - `search.ts` → use `SearchInput`, `SearchFeedbackInput` from spec
   - `l2_nodes.ts` → use `NodeLinkInput` from spec
   - `templates.ts` → use template update types from spec
   - `documents.ts` → use `AffiliateDocumentInput` from spec
   - `generate.ts` → use `GenerateInput` from spec
   - `integrations.ts` → use integrati...


2. **🟡 Add CI check for codegen freshness.** Implement a CI step that runs `pnpm --filter @workspace/api-spec run codegen` and verifies no generated files changed (i.e., `git diff --exit-code`). This ensures the generated files are always in sync with the spec.


3. **🟡 Add a pre-commit hook for codegen.** Consider adding a git pre-commit hook that runs codegen when `openapi.yaml` changes, ensuring developers never forget to regenerate.

### Report: `0288_6.2.1.md` - Verification Report: Item 6.2.1 — POST /mcp/query Endpoint

1. **🟡 Redundant boolean expression on line 244:** `req.query.include_pending === "true" || false` — the `|| false` is redundant since the comparison already returns a boolean. Not a bug, but unnecessary. Same pattern on line 98.


2. **🟡 `project_id` type coercion inconsistency:** The Zod schema validates `project_id` as `z.number().int().positive()`, but the OpenAPI spec defines it as `zod.number().optional()` (no integer/positive constraint). The inline schema is stricter than the spec. This could cause the endpoint to reject values that the OpenAPI spec would accept (e.g., `1.5` or `-1`).


3. **🔴 No rate limiting on MCP endpoint:** The POST `/mcp/query` endpoint has no rate limiting. Since it calls the LLM (gpt-4o-mini) on every request (unless fast-path applies), an attacker with a valid token could exhaust LLM API credits. The GET-based MCP endpoints (list_projects, search_knowledge, etc.) also lack rate limiting.

## Round 3 — Integration & Completeness Review

**Endpoint contract verification:**

| Aspect            | Expected (OpenAPI)    | Actual (Implementation)         | S...

### Report: `0290_6.2.2.md` - Verification Report: Item 6.2.2 — MCP Tool Discovery

1. **🟡 `read_shared_memory` and `retrieve_original` are undocumented.** These endpoints exist in the route file (mcp.ts:68-91) but are not in the OpenAPI spec. This violates the "API-first" principle stated in AGENTS.md. Any changes to these endpoints won't trigger codegen updates.


2. **🟡 kg-engine MCP page is manually maintained.** The `mcp.tsx` file hardcodes endpoint definitions (name, method, path, description, params). If a new endpoint is added to `mcp.ts`, the UI won't reflect it unless manually updated. This is a direct consequence of having no tool discovery mechanism.


3. **🟡 No test coverage for `read_shared_memory` or `retrieve_original`.** The only MCP integration test is `mcp-list-projects.test.ts`. The two undocumented endpoints have zero test coverage.


4. **🔴 No rate limiting on any MCP endpoint.** Same issue as identified in 6.2.1 report — no rate limiting on MCP routes, which could lead to LLM API credit exhaustion.

## Round 3 — Integration & Completeness Review

**Endpoint inventory cross-reference:**

| Endpoint              | Route File | OpenAPI Spec | kg-engine UI | Test |
| --------------------- | ---------- | ------------ | ------------ | ---- |
| `list_projects`       | ✅ L39     | ✅ L985      | ✅           | ✅   |
| `read_shared_me...

### Report: `0292_6.2.3.md` - Verification Report: Item 6.2.3 — Bearer Token Auth for MCP

1. **🔴 Timing-unsafe token comparison (mcp.ts:29):** `authHeader !== \`Bearer ${expectedToken}\``uses JavaScript string comparison, which is vulnerable to timing side-channel attacks. An attacker can determine the token by measuring response times for different prefix matches. Should use`crypto.timingSafeEqual()`:

   ```typescript
   const expected = Buffer.from(`Bearer ${expectedToken}`);
   const actual = Buffer.from(authHeader ?? "");
   if (expected.length !== actual.length || !crypto.timin...


2. **🟡 No `securitySchemes` in OpenAPI spec:** The OpenAPI spec at `lib/api-spec/openapi.yaml` has no `components.securitySchemes` section and no `security` requirements on any path. This means:
   - The auth requirement is invisible to spec consumers
   - Generated clients won't include auth headers
   - The spec doesn't match the actual runtime behavior


3. **🟡 Existing test doesn't test auth:** The only MCP test (`mcp-list-projects.test.ts`) calls `request(app).get("/api/mcp/list_projects").expect(200)` without sending a Bearer token. The test setup (`setup.ts`) does not set `MCP_PAT`. This means:
   - If `MCP_PAT` is unset (as in the test env), the middleware returns 500 — the test should be failing
   - If the test is passing, it may be because the test database setup bypasses the middleware somehow
   - There are no tests for the 401 respons...


4. **🟡 No token format validation:** The middleware does not validate that the `MCP_PAT` env var has a minimum length or format. An empty string or trivially short token would be accepted.


5. **🟡 No rate limiting on auth failures:** As noted in the 6.2.1 and 6.2.2 reports, there is no rate limiting on MCP endpoints. An attacker can make unlimited token guess attempts.

## Round 3 — Integration & Completeness Review

**Auth coverage matrix:**

| Endpoint                       | Auth Middleware | OpenAPI security | Test covers auth  |
| ------------------------------ | --------------- | ---------------- | ----------------- |
| `GET /mcp/list_projects`       | ✅ L19-36       | ❌ Not ...

### Report: `0328_9.1.1.md` - Verification Report: Item 9.1.1 — HMAC-SHA256 for GitHub Webhooks

1. **🔴 CRITICAL — Fail-open when `GITHUB_WEBHOOK_SECRET` is unset** (`github_webhooks.ts:131-140`):
   - When the env var is undefined, all webhook requests are accepted without authentication
   - No warning is logged when the server starts without the secret configured
   - **Impact**: Any anonymous attacker can trigger PR analysis, L3 state transitions, and database writes
   - **Recommendation**: Add an `else` clause that returns 401/500 when `GITHUB_WEBHOOK_SECRET` is not set. Better: fail ...


2. **🟡 MEDIUM — No runtime validation of secret format** (`github_webhooks.ts:131`):
   - If `GITHUB_WEBHOOK_SECRET=""` (empty string), the truthiness check `if (webhookSecret)` evaluates to `false`, silently skipping validation
   - While this doesn't create a security hole (it falls through to the fail-open path, which is the same as #1), it could mislead developers who think they've configured the secret
   - **Recommendation**: Add a startup warning if the secret is empty or shorter than a m...


3. **🟡 MEDIUM — Buffer padding approach is correct but fragile** (`github_webhooks.ts:27-28`):
   - The null-byte padding for `timingSafeEqual` is a known workaround for Node.js requiring equal-length buffers
   - If GitHub ever changes their signature format to include characters that collide with null bytes, this could theoretically cause issues
   - In practice, this is safe since HMAC-SHA256 hex output is always 64 characters + "sha256=" prefix = 71 characters
   - **Status**: Acceptable — n...

### Report: `0331_9.1.2.md` - Verification Report: Item 9.1.2 — API Key via VS Code SecretStorage

5. **🟡 MEDIUM — Token sent as custom header over HTTPS assumed**: The `x-docuvia-token` header is a custom authentication scheme. The `server_url` in `~/.docuvia/config.yaml` is documented as requiring `https://` (per `settings.md` line 60: "Must use `https://`"). However, there is no runtime validation that the URL uses HTTPS. If a user configures `http://` instead of `https://`, the token would be transmitted in cleartext.
   - **Mitigation**: The design doc mandates HTTPS. The risk is low sin...

### Report: `0332_8.4.6.md` - Verification Report: Item 8.4.6 — docuvia.autoCategorizeDecisions

3. **🟡 MEDIUM — LLM output used without validation**: The `mapping` array from the LLM response is iterated and the `l3_id`, `target_l2_id`, `new_l2_name`, and `l1_id` fields are used without schema validation. A malformed LLM response could:
   - Reference non-existent `l3_id` values (silently no-op — router entry not found)
   - Reference non-existent `l1_id` for new L2 modules (creates orphan L2 module)
   - Include empty strings or unexpected types
   
   **Mitigation**: The `JSON.parse` and...


8. **🟡 MEDIUM — No input length limit on unassigned nodes**: Unlike `searchFromSelection` which caps at 2000 chars, `autoCategorizeDecisions` sends ALL unassigned decisions to the LLM without any cap. If a project has hundreds of unassigned decisions, the prompt could exceed the LLM's context window.
   - **Recommendation**: Consider batching or capping the number of decisions sent in a single request (e.g., max 50 decisions per request, process in batches).


9. **🟡 MEDIUM — `any` type for `snap` parameter**: The `applyAutoCategorization` method types `snap` as `any` (line 182). This loses type safety for the snapshot object.
   - **Recommendation**: Use the proper `Snapshot` type from `KnowledgeStore`.

### Report: `0335_9.1.5.md` - Verification Report: Item 9.1.5 — CORS Configuration Review

1. **🔴 HIGH — Wildcard CORS allows all origins** (`app.ts:30`):
   - `app.use(cors())` with no configuration sets `Access-Control-Allow-Origin: *`
   - Any website can make cross-origin requests to the API, including authenticated requests with cookies/credentials
   - **Impact**: Enables CSRF attacks — a malicious website could trigger API actions (ingest, generate, review resolution) if a user has an active session
   - **Note**: The API uses token-based auth (`x-docuvia-token` header) rather ...


2. **🟡 MEDIUM — `CORS_ORIGIN` env var documented in design but never implemented**:
   - The crosscutting concepts document specifies `CORS_ORIGIN` as the configuration mechanism
   - No code reads this variable; no `.env.example` or deployment documentation mentions it
   - **Impact**: Operators have no way to configure CORS without modifying source code


3. **🟡 MEDIUM — No OPTIONS preflight handler**:
   - The `cors()` middleware handles OPTIONS automatically, but there is no explicit OPTIONS route or middleware
   - This is acceptable behavior for the `cors` package, but means there's no control over preflight response headers or caching
   - **Impact**: Low — the `cors` package handles preflight correctly by default


7. **🟡 MEDIUM — No environment-based configuration pattern**: Unlike other env vars (`PORT`, `DATABASE_URL`, `GITHUB_WEBHOOK_SECRET`), `CORS_ORIGIN` has no implementation pattern to follow. The codebase has no precedent for environment-based feature flags.

### Report: `0337_9.2.1.md` - Verification Report: Item 9.2.1 — Structured Logging (pino)

3. **🟡 MEDIUM — `console.error` bypasses redaction in `l2_nodes.ts:146`** — The bootstrap confirmation error handler uses `console.error(error)` directly. If the error object contains sensitive data (e.g., database connection strings with passwords), it will be logged in plaintext without redaction. This is the only instance of `console.error` in the API server source (excluding examples and scripts).


8. **🟡 MEDIUM — Dead code: `isProduction` variable** (`logger.ts:3`):
   ```typescript
   const isProduction = process.env.NODE_ENV === "production";
   ```
   This variable is never used. The transport config inline-checks `process.env.NODE_ENV !== "production"`. This is dead code that should be removed or used.


9. **🟡 MEDIUM — `l2_nodes.ts` doesn't import logger** — The file has no `import { logger }` statement and uses `console.error` instead. This is inconsistent with every other route file.


11. **🔴 No logger tests exist** — Zero test files reference `logger`, `pino`, or `redact`. The design doc's verifiability requirement explicitly states:
    > "The test suite MUST instantiate the Pino logger, simulate an error containing mock PII (e.g., email addresses, bearer tokens, or auth headers), and capture the output stream. The assertion MUST explicitly verify that the sensitive strings are replaced with `[REDACTED]` in the final log output."

    This test does not exist. The `console....


12. **🔴 No pino-http integration tests** — No tests verify that HTTP requests produce structured log output with the expected serializers.

---

## Round 3 — Integration & Completeness Review

### End-to-End Flow Verification

| Step | Flow | Status |
|------|------|--------|
| 1 | Server starts, logger instantiated with LOG_LEVEL | ✅ `logger.ts` exports configured pino instance |
| 2 | pino-http middleware logs all incoming requests | ✅ `app.ts:11-29` — custom serializers for req/res |
| 3 | Ro...

### Report: `0339_9.3.1.md` - Verification Report: Item 9.3.1 — Defensive Design (Early Return / Guard Clauses)

1. **🟡 MEDIUM — `review_tasks.ts:23-55` — `enrichTask` has if/else-if chain with nested blocks:**
   ```typescript
   if (task.entityType === "l1_tag") {
     // ...
   } else if (task.entityType === "l2_node") {
     // ...
     if (node) {  // ← Nested if inside else-if
       // ...
     }
   } else if (task.entityType === "l3_node") {
     // ...
     if (node) {  // ← Nested if inside else-if
       if (l2) {  // ← Double-nested if
         // ...
       }
     }
   }
   ```
   This is the ...


2. **🟡 MEDIUM — `l2_nodes.ts:33-149` — `confirm-bootstrap` handler is 116 lines with deep nesting:**
   The handler contains:
   - `try { ... } catch { }` wrapping the entire body
   - `for (const module of body.approvedModules) { ... }` loop
   - `if (body.rejectedModuleIds.length > 0) { ... }` with nested `if (!sysNode) { ... }`
   - `if (approvedNodes.length > 0) { ... }` with nested function definitions and sorting

   While each individual conditional is not deeply nested, the cumulative co...


9. **🟡 No dedicated defensive design tests** — There are no tests that specifically verify guard clause behavior (e.g., testing that a function returns early when given null input). However, the integration tests for routes implicitly test guard clauses by sending invalid inputs and checking for 400/404 responses.

### Report: `0340_9.3.2.md` - Verification Report: Item 9.3.2 — MVC Pattern for UI Layers

1. **🟡 MEDIUM — `pipeline.tsx:77,108` — Raw `fetch()` bypasses Model layer:**
   ```typescript
   // pipeline.tsx line 77
   const res = await fetch(`/api/projects/${selectedProject}/ingest/git`, {
     method: "POST",
     headers: { "Content-Type": "application/json" },
     body: JSON.stringify({ ... }),
   });
   ```
   The ingest and generate endpoints are defined in `openapi.yaml` but the frontend doesn't use the generated hooks for these operations. Instead, it constructs raw fetch reques...


2. **🟡 MEDIUM — `query.tsx:65` — Raw `fetch()` for MCP query:**
   ```typescript
   const res = await fetch("/api/mcp/query", {
     method: "POST",
     headers: { "Content-Type": "application/json" },
     body: JSON.stringify({ query: query.trim(), projectId: ..., limit: 20 }),
   });
   ```
   The MCP query endpoint is defined in `openapi.yaml` but the frontend uses raw fetch. Same issues as above — no validation, no caching, no type safety.


3. **🟡 MEDIUM — `documents.tsx:97` — Raw `fetch()` for document loading:**
   ```typescript
   const res = await fetch(`/api/projects/${projectId}/documents`);
   ```
   Bypasses the generated `useListProjectDocuments` hook (if it exists in the generated API client).


10. **🟡 No MVC-specific tests** — There are no tests that specifically verify layer separation (e.g., testing that a View component doesn't make direct API calls). The integration tests for routes test the API boundary but don't test frontend layer compliance.

### Report: `0341_9.3.3.md` - Verification Report: Item 9.3.3 — POP (Protocol-Oriented Programming) for Services

5. **🟡 No POP-specific tests** — There are no tests that verify interface compliance or dependency inversion. The lack of interfaces means all tests either test the concrete implementation or require manual mocking.


6. **🟡 Testing difficulty due to lack of interfaces** — Without interfaces, unit testing requires:
   - Direct DB connections (integration tests only)
   - Mocking the entire OpenAI SDK (for LLM-dependent code)
   - No ability to inject mock implementations for testing

---

## Round 3 — Integration & Completeness Review

### End-to-End Flow Verification

| Step | Flow | Status |
|------|------|--------|
| 1 | Route handler receives request | ✅ Routes are properly defined |
| 2 | Route handler c...

### Report: `0344_10.1.1.md` - Verification Report: Item 10.1.1 — GitHub Actions: lint job

1. **🔴 HIGH — Missing Prettier config (`tabWidth: 4`, `printWidth: 100`)** — The design doc at `docs/design/08-crosscutting-concepts.md:436` explicitly states: "The call-chain and indentation rules are enforced by Prettier with `tabWidth: 4` and `printWidth: 100`." No config file exists. Prettier defaults to `tabWidth: 2`, `printWidth: 80`. This means the lint job enforces **different formatting rules** than what the design spec mandates.


2. **🔴 HIGH — Missing `eslint.config.js`** — The design doc at `docs/design/08-crosscutting-concepts.md:436` states: "These rules should be encoded in `eslint.config.js` where tooling supports them (`max-lines-per-function`, `max-len`)." No ESLint config exists. The `max-lines-per-function` and `max-len` rules are completely unenforced.


3. **🟡 MEDIUM — `.prettierignore` does not exclude `.gitnexus/`** — Running `prettier --check .` warns about `.gitnexus/meta.json`, `.gitnexus/parse-cache/`, `.gitnexus/parsedfile-cache/`, and `.gitnexus/run.cjs`. These are tool-generated cache/index files that should be in `.prettierignore`. The `[DEPRECATED_V1_DOC]` directory is also not excluded despite containing legacy files.


4. **🟡 MEDIUM — `.prettierignore` does not exclude `docs/roadmap/reports/`** — Multiple report files in `docs/roadmap/reports/` trigger formatting warnings. Since reports are generated by cron jobs and not meant to be manually formatted, they should be excluded.


5. **🟡 MEDIUM — 35 files currently fail lint check** — Running `pnpm run lint` locally produces `ELIFECYCLE Command failed with exit code 1` with "Code style issues found in 35 files." This means the CI lint job would fail if triggered on the current codebase state.

### Report: `0348_5.1.4.md` - Verification Report: Item 5.1.4 — Correction examples creation on review approval

2. **🟡 Medium — `review_tasks.ts:127,148` — Null original content silently drops corrections**
   - The guards `if (node && node.description)` (L2) and `if (node.content)` (L3) skip creating a correction example when the original content is falsy. This means if a reviewer corrects a node that was created with empty/null content (e.g., a newly extracted module with no description yet), the correction is silently discarded.
   - **Impact**: Edge-case data loss; the guard is overly protective.


3. **🟡 Medium — `generate.ts:88-104` — `getRecentCorrections()` only supports `l2_node` and `l3_node` entity types**
   - The function signature is `entityType: "l2_node" | "l3_node"` — no `"l1_tag"` option exists. Even if L1 corrections were stored in `correction_examples`, they could not be fetched for few-shot injection.
   - **Impact**: Compound issue — even after fixing the L1 insert gap, L1 generation would still not use corrections.

### Report: `0349_10.2.1.md` - Verification Report: Item 10.2.1 — Single-host deployment topology documented

1. **🟡 MEDIUM — `OPENAI_API_KEY` naming discrepancy** — The design doc (`07-deployment.md` line 43) specifies `OPENAI_API_KEY` as the required env var. The codebase (`integrations-openai-ai-server/src/client.ts:9`) reads `AI_INTEGRATIONS_OPENAI_API_KEY`. An operator following the deployment guide would set the wrong variable name and the server would fail to initialize the LLM client.


2. **🟡 MEDIUM — `GITHUB_TOKEN` undocumented** — `github_webhooks.ts:175` reads `process.env.GITHUB_TOKEN` for fetching PR commits and posting comments. This required variable is not listed in the env var table in `07-deployment.md`. Without it, PR analysis features would fail silently.


3. **🟡 MEDIUM — Webhook secret not enforced at startup** — `github_webhooks.ts:131-140` only validates HMAC signatures when `webhookSecret` is set AND signature is present. If the secret is not configured, the server starts and accepts unsigned webhooks. The design doc says "Required when GitHub PR integration is active" but the code doesn't enforce this conditional requirement.

### Report: `0350_10.3.1.md` - Verification Report: Item 10.3.1 — No .vsix build script (D-02)

1. **🟡 MEDIUM — CI does not produce `.vsix` artifact** — The `typecheck-and-build` job in `.github/workflows/ci.yml` runs `pnpm -r --if-present run build` but never invokes `pnpm --filter @workspace/vscode-client run package`. The `.vsix` file is not generated, not uploaded as an artifact, and not available for distribution. This is the core D-02 debt.


2. **🟡 MEDIUM — No CI step to validate `vsce package` succeeds** — Even if the `package` script were added to CI, there's no guarantee it would pass in the CI environment (vsce requires a valid `README.md`, `CHANGELOG.md`, and `LICENSE` in the extension package). The vscode-client directory lacks these files:
   - No `README.md` in `artifacts/vscode-client/`
   - No `CHANGELOG.md` in `artifacts/vscode-client/`
   - No `LICENSE` in `artifacts/vscode-client/`
   - `vsce package` will warn or fail ...

### Report: `0352_10.1.4.md` - Verification Report: Item 10.1.4 — No .vsix packaging step in CI (D-02)

1. **🟡 MEDIUM — CI does not produce `.vsix` artifact on push to `main`** — The `typecheck-and-build` job runs `pnpm -r --if-present run build`, which invokes the `build` script (tsc typecheck + emit), but does NOT invoke the `package` script (esbuild + vsce package). The `.vsix` file is not generated, not uploaded as a build artifact, and not available for download from CI. This is the core D-02 debt.


2. **🟡 MEDIUM — Missing extension metadata files** — `vsce package` expects `README.md` and `CHANGELOG.md` in the extension package directory. The `artifacts/vscode-client/` directory lacks both. Running `vsce package` produces warnings about missing files (though `--no-dependencies` bypasses dependency checks).


3. **🟡 MEDIUM — Release workflow is tag-gated, not push-gated** — The `release.yml` workflow correctly packages the .vsix but only triggers on `v*` tags. This means:
   - Every push to `main` produces NO .vsix artifact
   - Developers must manually create a GitHub Release with a version tag to get a .vsix
   - There's no CI validation that `vsce package` succeeds before a tag is created

### Report: `0362_1.2.1.md` - Verification Report: Item 1.2.1 — Git Ingestion via child_process.spawn Streaming

1. **🟡 Medium — Noise commits are ingested, not filtered:** `scoreCommit()` returns `{ valid: false, score: 0.1 }` for noise patterns (merge commits, version bumps, etc.), but `processIngestion` at ingestion-pipeline.ts line 92 still inserts the commit with `valid: false`. The design (arc42 section 4.2) describes `scoreCommit` as a "signal/noise filter," suggesting noise commits should be skipped entirely rather than stored with a `valid=false` flag. Currently, noise commits consume DB space and...


2. **🟡 Medium — Silent diff failure:** `getDiff()` (git-client.ts lines 168-179) resolves with an empty string `""` on both non-zero exit codes and error events. While this prevents a single failed diff from aborting the entire ingestion, it means commits will be ingested with empty diffs without any warning logged at a visible level. The `logger.warn` calls are present but the ingestion pipeline has no way to distinguish an empty diff due to failure vs. genuinely empty.


3. **🟡 Medium — `lastGitIngestedAt` uses `new Date()` instead of commit date:** In `processIngestion` (ingestion-pipeline.ts line 108), the cursor is set to `new Date()` rather than the newest commit's actual date. This means the incremental cursor wall-clock time may not match the commit timeline, potentially causing missed or re-ingested commits if the system clock and git commit dates diverge.


1. **🟡 Medium — `repoUrl` passed directly to `git clone`:** The `repoUrl` from the request body (or project record) is passed directly to `execFileAsync("git", ["clone", ..., repoUrl])` without URL validation. While `execFile` (not `exec`) mitigates shell injection by passing arguments directly without shell interpretation, a malformed URL could still cause unintended behavior (e.g., cloning an unintended repository, or passing arbitrary git flags via a crafted URL). The route handler only check...

