# Docuvia2 Tier A (AST Incremental Update) & Hook Migration In-Depth Analysis

> **Context**: In-depth technical analysis for "Priority 3: Implement Tier A & Switch Hook" in the Phase 1 execution strategy.
> **Date**: 2026-07-16
> **Status**: Independent Analysis Report

---

## 1. Vision vs. Reality

According to the PLAT-004 vision, every user Commit should incrementally update the knowledge graph "invisibly" in the background.
However, the reality is:

- The Git Post-commit hook is bound to `docuvia snapshot`.
- `snapshot` merely packs the "current SQLite database" and pushes it to the git branch; it **does not trigger any AST re-parsing**.
- Therefore, every commit pushes the Day 1 (at `init`) graph, leaving the knowledge clock frozen.

## 2. Incremental Update Architecture Design

The core goal of Tier A is to complete the graph update for the current Commit at a millisecond level. This requires a series of tightly linked components:

### Step 1: SHA Fast-Path (Idempotent Short-Circuit)

Each time the background triggers `analyze` (Auto Mode), the first thing is to read the `commitSha` of the last successful parse from local SQLite (or from the `docuvia-knowledge` branch's trailer).
If `LastIngestedSha === HEAD`, exit directly with `process.exit(0)`, achieving zero-cost idempotency.

### Step 2: Enable SemanticDiffDetector

Obtain the list of changed files via `git diff --name-only <LastIngestedSha> HEAD`.
The current `SemanticDiffDetector` has been implemented in `lib/ast-core` but is in a Dead Code state. We need to:

1. Pass the changed file paths to the detector.
2. For modified files, re-invoke Tree-Sitter for parsing.

### Step 3: Partial Upsert with AstProcessingService

Call the existing `AstProcessingService` and `GraphPersister`. Unlike the global parsing in `init`, incremental updates at the Persister layer must adopt an **Upsert + Delete Stale** strategy:

- Clear the old L2 nodes for target files in the database.
- Write new L2 nodes.

### Step 4: Dependency Diffusion & Tagging (Pruning Level)

`SemanticDiffDetector` determines whether the modification is `INTERNAL_LOGIC` (implementation detail) or `CONTRACT_CHANGED` (interface change).
If it is `CONTRACT_CHANGED`, the node needs to be tagged in the database and queued for subsequent Tier B (LSP Escalation) tasks.

## 3. Hook Command Replacement & Seamless Migration

Hook replacement can only happen after Tier A is implemented and unit tested.

- **Old Hook**: `npx --no-install docuvia snapshot`
- **New Hook**: `npx --no-install docuvia analyze`

To ensure a seamless transition for legacy users, `doctor` or `init` should include an automated Hook migration check mechanism. If an old script is detected, prompt the user to re-run `docuvia init --hooks-only` to update the script content.

## 4. Concurrency & Data Consistency Defense

In extreme cases (e.g., via `git commit --amend` or a large number of `git rebase` in a short time), multiple Post-commit hooks can be triggered in parallel.

- **Defense Mechanism**: The `analyze` command must use a process lock similar to PLAT-006's `acquireProcessLock`. If the Lock is occupied (another incremental update is running), the new process should decide whether to **wait and merge changes** or **drop directly and let the last Commit handle a global sweep** (Debounce mechanism).
- **Data Consistency**: The update process must be wrapped in a single SQLite Transaction. When a Crash occurs (e.g., AST Worker OOM), complete Rollback avoids a half-finished knowledge graph.
