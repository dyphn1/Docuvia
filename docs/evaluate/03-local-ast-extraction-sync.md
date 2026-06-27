# 03. Local AST Extraction Sync

**Severity:** 🔴 CRITICAL
**Domain:** Data Pipeline
**Target:** `@workspace/cli` (`sync` command)

## Deficit Description

The `docuvia sync` command is currently registered to act as the `post-commit` hook, but its implementation is incomplete regarding the extraction pipeline. It attempts to call the server or do basic setup, but it does not actually stream the Git delta (the changed files in the commit) into the `@workspace/ast-core` parser. Without this link, the system is fundamentally broken: commits happen, but the AST is never analyzed locally.

## Acceptance Criteria

1. The `docuvia sync` command must correctly read the `git diff-tree` or equivalent to determine which files were modified in the target commit.
2. It must route these modified files into the `@workspace/ast-core` processing queue.
3. The processing must handle large commits gracefully without running out of memory.
