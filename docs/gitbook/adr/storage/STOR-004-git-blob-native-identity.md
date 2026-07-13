---
id: STOR-004
title: Git Blob-Native Identity and Content Hash Caching
status: proposed
date: 2026-07-06
domains: [storage]
supersedes: [legacy/ADR-016]
superseded_by: []
---

# Git Blob-Native Identity and Content Hash Caching

## Context

Because Git is the sole source of truth and SQLite is only a disposable, rebuildable cache (STOR-001, STOR-002), checking out a different git branch locally forces the system to re-analyze files that were previously analyzed on that branch, resulting in "checkout thrashing" and wasted CPU cycles.

## Decision

_(Partially implemented in Docuvia2; Local caching mechanism is proposed)._

We rely on **Git Blob Hashes (Content Hashes)** as the primary identity for files rather than absolute file paths.
We propose adding a persistent, local cache table in SQLite keyed by `content_hash`. Before running the AST parser on a file, the system checks if the file's current blob hash exists in the cache. If it does, the analysis results are reused instantly.

_(Note: The second phase of this proposal—using the git branch itself as a content-addressable object store for team-wide sharing—is currently deferred pending a cost/benefit analysis)._

## Consequences

- **Positive**: Solves local checkout thrashing. Switching back to an old branch becomes instantaneous because the blob hashes are cached.
- **Negative**: The local cache table will grow indefinitely unless a TTL/LRU pruning mechanism is implemented. This does not solve team-wide redundant analysis.
