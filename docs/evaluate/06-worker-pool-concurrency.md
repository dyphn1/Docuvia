> **Note:** This document contains competitor analysis and references that have not been fully integrated into the current implementation yet.

# 06. Worker Pool Concurrency

**Severity:** 🟠 HIGH
**Domain:** Worker Management
**Target:** `@workspace/ast-core`

## Deficit Description

When parsing hundreds of files simultaneously (e.g., during a large git merge or initial project onboarding), running AST parsing sequentially is too slow, but running it unrestrictedly in parallel will crash the Node.js process (OOM). There is currently no robust concurrency management for local parsing.

## Acceptance Criteria

1. Implement a `worker_threads` pool in `@workspace/ast-core`.
2. Limit the maximum concurrent workers to `os.cpus().length - 1` to ensure the machine remains responsive.
3. Implement a strict memory ceiling and a timeout (quarantine) mechanism to kill and respawn workers that hang on malicious or overly complex source files.
