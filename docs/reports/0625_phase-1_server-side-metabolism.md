# Verification Report: Item 1.4.1 — Asynchronous Metabolism Mechanism (ADR-008)
- **Date**: 2026-06-25
- **Phase & Item**: Phase 1 - Server Side Metabolism
- **Target File**: Unknown (Derived from audit)
- **Status Update Required**: ❌ ERROR / ⚠️ WARN

### Description of Failure
3. **⚠️ No authentication on client tick endpoint**: `GET /api/metabolism-tick` has no authentication at all. Any caller can trigger metabolism work. While this is a relatively low-risk endpoint (it only processes pending internal tasks), it could be abused for DoS by repeatedly triggering expensive LLM operations. Consider adding at least a lightweight shared-secret check.


4. **⚠️ `GITHUB_TOKEN` from env without validation**: `metabolism.ts:55` reads `process.env.GITHUB_TOKEN` but doesn't validate its presence before the merge gate loop. If the token is missing, the GitHub API calls will fail silently (caught by try/catch at line 69), and no L3 nodes will be promoted. This is acceptable fallback behavior but could lead to silent failures.

### Code Quality Findings


1. **⚠️ Distillation marks corrections as processed even on failure**: At `metabolism.ts:129`, `processedIds.push(correction.id)` is inside the `try` block but after the LLM call. If `openai.chat.completions.create` throws, the correction is NOT added to `processedIds` (correct). However, if the LLM returns a response but `guardrail` is falsy (empty string, null), the correction IS added to `processedIds` at line 129 but no prompt template is created. This means corrections can be silently marke...


2. **⚠️ No batch size limit on merge gate**: The merge gate query at `metabolism.ts:21-36` has no `.limit()`. If thousands of L3 nodes are pending, all will be fetched and processed in a single tick. This could cause memory pressure and long-running requests.


3. **⚠️ Sequential LLM calls in distillation loop**: The distillation job at `metabolism.ts:102-133` calls the LLM sequentially for each correction. With a limit of 10, this could take a significant amount of time. No timeout or overall time budget is enforced.


6. **⚠️ `any` type usage**: `metabolism.ts:99` uses `const promptsToInsert: any[]` — should use the proper Drizzle insert type.

---

### Recommended Fix
Review the warnings and implement fixes in the corresponding source files.
