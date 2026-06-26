# Verification Report: Item 11.1.1 — AST Microkernel Architecture (ADR-022 Comprehensive Review)
- **Date**: 2026-06-26
- **Phase & Item**: Phase 5 - AST Microkernel Architecture
- **Target File**: `artifacts/ast-core/src/index.ts`
- **Status Update Required**: ⚠️ WARN

### Description of Failure
1. **🔴 HIGH — No `git diff-tree -M` fast-path**: ADR-022 Pillar 2 specifies O(1) incremental computation. No implementation exists. Must re-parse all files on every ingestion run.

2. **🔴 HIGH — No cross-language / polyglot edge detection**: ADR-022 §SRE specifies API Contracts as Bridge Nodes and framework-specific AST tracking (tRPC, Next.js Server Actions). Not implemented.

3. **🟡 MEDIUM — No Strict ACK Protocol / Bounded Job Dispatch**: Design specifies "Strict ACK Protocol / Bounded Job Dispatch (max 100 in-flight jobs)." `p-limit` bounds concurrency but does not implement the ACK protocol or coordinate with the worker's completion signal.

4. **🟡 MEDIUM — .jsonl Spool Files partially implemented**: Workers write AST skeletons to `.jsonl` files, but the ingestion pipeline reads them sequentially without streaming bulk-insert.

5. **🟡 MEDIUM — No Size Limits**: Design specifies "Size Limits (e.g., skip >1MB or *.min.js)." `ParsingFunnel` only checks for binary NUL bytes.

6. **🟡 MEDIUM — Poison Pill Quarantine Timing**: Quarantine is in-memory SQLite (`DatabaseSync`), resetting on server restart. Design implies permanent SQLite blacklist.

7. **🟡 MEDIUM — No `languages.toml` in repo**: Code supports loading TOML config but no template or default file exists.

8. **🟡 MEDIUM — No VS Code `ast.worker.ts` integration with host extension**: Worker file exists but no consumer code creates the Worker and posts messages to it.

9. **🟢 LOW — `any` types in `ast-worker.ts`**: Bypass TypeScript type safety.

10. **🟢 LOW — `tree-sitter-wasms` not in package.json dependencies**: Only `web-tree-sitter` is listed.

### Recommended Fix
1. Implement `git diff-tree -M` fast-path for incremental AST updates.
2. Add cross-language edge detection for API contracts and framework-specific patterns.
3. Implement Strict ACK Protocol with worker completion signals.
4. Add streaming bulk-insert from `.jsonl` files.
5. Add file size limits and minified file filters.
6. Make quarantine DB persistent.
7. Create `languages.toml` template.
8. Wire VS Code extension host to `ast.worker.ts`.
