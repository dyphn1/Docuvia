---
Date: 2026-07-02
Status: Accepted
Supersedes: None
---

# ADR-016: Git Blob-Native Identity & Checkout Thrashing Defense

## Context

_(Ref: [`docs/gitbook/comparisons/05-data-pipeline-sync.md`](../comparisons/data-pipeline-sync.md), [`docs/gitbook/evaluate/12-file-hash-delta-detection.md`](../evaluate/file-hash-delta-detection.md))_

When dynamically analyzing code, AST tree-diffing algorithms are computationally expensive. Additionally, when a user switches branches (e.g., `git checkout`), thousands of files may change instantly, causing a File-Watcher to trigger massive, unnecessary graph rebuilds and generate useless [database tombstones](./ADR-017-tiered-storage-and-orphan-branch-graph-maintenance.md) (thrashing).
Competitor analysis showed that utilizing Git's native tree objects could provide near-instant incremental scanning and deep git integration to map diff hunks.

## Decision

Docuvia will implement an "Environment-Aware Ingestion Pipeline" that heavily leverages native Git objects when a VCS is present (aligning with our [Git-Isomorphic Graph](./ADR-004-git-isomorphic-graph.md)).

- **Git Blob-Native Identity**: For projects with Git, the graph will use the `git_blob_hash` as the anchor for file-level nodes, and a custom `content_hash` (SHA-256 of the source string) for function/class-level AST nodes. Renames and moves are handled as zero-cost `UPDATE` statements by querying `git diff --name-status` and matching hashes, rather than fully parsing files again.
- **Checkout Thrashing Defense**: Docuvia will monitor `.git/HEAD`. During branch checkouts, the File-Watcher is paused (debounced). The system determines differences via `git diff <old_hash> <new_hash>`, and utilizes existing hashes from the graph to merely flip the `is_active` boolean state in SQL instead of deleting and creating new nodes. Ephemeral checkouts will enter a read-only mode to prevent [polluting the history](./ADR-017-tiered-storage-and-orphan-branch-graph-maintenance.md).
- **Environment-Aware Fallback**: If no Git repository is detected, the pipeline degrades gracefully to rely solely on local file hashing and basic [AST parsing](./ADR-020-unified-isomorphic-ast-microkernel.md).

## Consequences

- **Positive**: Practically zero computational cost for file rename/move tracking.
- **Positive**: Eliminates CPU spikes and database thrashing during branch switches.
- **Positive**: Adapts to both Git-versioned repositories and unversioned folders.
- **Negative**: Adds Git CLI integration dependencies and complexity to the ingest pipeline.

## Implementation Status (as of 2026-07-05)

The git-level half of this ADR is implemented: `lib/core/src/services/change-detection-service.ts` runs `git diff --name-status -M` and correctly reads the new path from a `R100\told\tnew` line. However, the "zero-cost `UPDATE`" rename claim is **not yet implemented at the database layer** — `lib/core/src/services/ast/ast-change-detector.ts` (`AstChangeDetector`) still hashes and looks up rows by `filePath` alone, with no `oldPath` concept in `projectFilesTable`. A renamed-but-content-unchanged file is currently detected as "not found at this path" and re-inserted as a new file record rather than updated in place — the opposite of the zero-cost `UPDATE` this ADR describes. Tracking real DB-level rename-as-update would require an `oldPath` column plus rewiring `AstChangeDetector` to consume the rename info `change-detection-service.ts` already computes.

## Diagram

```mermaid
sequenceDiagram
    participant User
    participant Git
    participant FileWatcher
    participant SQLDB

    User->>Git: git checkout new-branch
    FileWatcher->>FileWatcher: Detect .git/HEAD change
    FileWatcher->>FileWatcher: Pause/Debounce watcher
    FileWatcher->>Git: git diff <old_hash> <new_hash>
    Git-->>FileWatcher: Changed files
    FileWatcher->>SQLDB: UPDATE is_active (Flip State)
    SQLDB-->>FileWatcher: Success
    FileWatcher->>FileWatcher: Resume watcher
```
