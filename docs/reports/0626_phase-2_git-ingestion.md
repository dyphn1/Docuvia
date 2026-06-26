# Verification Report: Item 1.2.1 — Git Ingestion via child_process.spawn Streaming
- **Date**: 2026-06-26
- **Phase & Item**: Phase 2 - Git Ingestion
- **Target File**: `artifacts/api-server/src/lib/git-client.ts`
- **Status Update Required**: ⚠️ WARN

### Description of Failure
1. **🟡 MEDIUM — Noise commits are ingested, not filtered**: `scoreCommit()` returns `{ valid: false, score: 0.1 }` for noise patterns, but `processIngestion` still inserts the commit with `valid: false`. The design describes `scoreCommit` as a "signal/noise filter," suggesting noise commits should be skipped entirely.

2. **🟡 MEDIUM — Silent diff failure**: `getDiff()` resolves with an empty string `""` on both non-zero exit codes and error events. The ingestion pipeline cannot distinguish an empty diff due to failure vs. genuinely empty.

3. **🟡 MEDIUM — `lastGitIngestedAt` uses `new Date()` instead of commit date**: In `processIngestion`, the cursor is set to `new Date()` rather than the newest commit's actual date, potentially causing missed or re-ingested commits.

4. **🟡 MEDIUM — All diffs buffered in memory**: For 500 commits with large diffs, accumulating all diffs in the `gitItems` array before processing could cause OOM.

5. **🟡 MEDIUM — `githubToken` parameter accepted but never used**: The `GitIngestSchema` accepts a `githubToken` field but the token is never passed to `LocalGitClient.clone()`.

6. **🟡 MEDIUM — No tests for git ingestion path**: No unit tests for `LocalGitClient`, no integration tests for the ingest endpoint, no tests for incremental mode.

7. **🟢 LOW — `repoUrl` passed directly to `git clone`**: No URL validation on the repo URL before passing to `execFileAsync`.

8. **🟢 LOW — No timeout on spawned git processes**: A hung `git log` or `git show` process would block indefinitely.

### Recommended Fix
1. Skip noise commits entirely in `processIngestion` when `scoreCommit()` returns `valid: false`.
2. Make `getDiff()` reject on error instead of resolving with empty string.
3. Use the actual commit date for `lastGitIngestedAt` cursor.
4. Implement streaming/chunked diff processing instead of buffering all diffs.
5. Wire `githubToken` to `LocalGitClient.clone()` or remove the unused parameter.
6. Add comprehensive tests for git ingestion (unit + integration).
7. Add URL validation and process timeouts.
