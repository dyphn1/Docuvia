# Verification Report: Item 4.1 — AST Microkernel & Plugin Ecosystem
- **Date**: 2026-06-26
- **Phase & Item**: Phase 5 - AST Microkernel
- **Target File**: `artifacts/ast-core/src/index.ts`
- **Status Update Required**: ⚠️ WARN

### Description of Failure
1. **🔴 HIGH — No `git diff-tree -M` fast-path for incremental ingestion**: ADR-022 §2 specifies O(1) incremental computation using `git diff-tree -M`. No implementation exists. The current pipeline processes all files on every ingestion run.

2. **🔴 HIGH — No cross-language / polyglot edge detection**: The design specifies API Contracts (OpenAPI/Swagger) as Bridge Nodes and framework-specific AST tracking. No implementation exists.

3. **🟡 MEDIUM — No bulk-insert**: Each L2/L3 node and link is inserted individually. For large codebases (10K+ files), this will be extremely slow.

4. **🟡 MEDIUM — No `fast-glob` + `xxhash` fallback for non-git workspaces**: ADR-022 specifies graceful degradation for workspaces without `.git`. Not implemented.

5. **🟡 MEDIUM — No file size limit**: Risk of OOM on large generated/minified files. The `ParsingFunnel` only checks for binary NUL bytes.

6. **🟡 MEDIUM — `LanguageRegistry.load()` is a stub**: Returns default registry without reading any TOML file from disk.

7. **🟡 MEDIUM — Quarantine DB is in-memory only**: `DatabaseSync` resets on server restart, losing quarantine state.

8. **🟢 LOW — `any` types in `ast-worker.ts`**: `buildScopeMap(importStatements: any[])` and `classifyCall(callNode: any)` bypass type safety.

9. **🟢 LOW — Duplicate `buildScopeMap` and `classifyCall`**: Functions fully duplicated between `parser-core.ts` and `ast-worker.ts`.

10. **🟢 LOW — No `languages.toml` template in repo**: Users must discover the format from source code.

### Recommended Fix
1. Implement `git diff-tree -M` fast-path for incremental AST updates.
2. Add cross-language edge detection for API contracts and framework-specific patterns.
3. Implement batch INSERT for L2/L3 nodes and links.
4. Add `fast-glob` + `xxhash` fallback for non-git workspaces.
5. Add file size limits in `ParsingFunnel` (skip >1MB or `*.min.js`).
6. Implement `LanguageRegistry.load()` to read from `languages.toml`.
7. Make quarantine DB persistent across restarts.
