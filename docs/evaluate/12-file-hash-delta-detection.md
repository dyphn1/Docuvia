> **Note:** This document contains competitor analysis and references that have not been fully integrated into the current implementation yet.

# 12. File Hash Delta Detection

**Severity:** 🟡 MEDIUM
**Domain:** Diff Optimization
**Target:** `@workspace/vscode-client` / `@workspace/cli`

## Deficit Description

When re-evaluating a project (e.g., during a large `git pull` or `git checkout`), passing thousands of files through the AST parser is computationally expensive and slow. To achieve the sub-second speeds required for a local-first experience, unmodified files must be aggressively skipped.

## Acceptance Criteria

1. Introduce a `project_files` tracking table in the local SQLite database.
2. Store the SHA-256 hash of every file's contents upon successful parsing.
3. During any bulk or incremental extraction, hash the incoming file first. If the hash matches the DB, skip AST extraction entirely.
