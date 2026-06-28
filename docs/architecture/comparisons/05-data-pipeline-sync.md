# Data Pipeline & Sync Competitor Analysis

## Current State
Docuvia implements Git-isomorphic knowledge sync via the `docuvia-knowledge` orphan branch, using Git-native blob hashing for incremental syncs.

## Competitors
Turborepo, GitNexus

## What Competitors Have That We Don't
- Daemon-based file watching.
- Near-instant cache invalidation.
- Seamless remote sync.

## What We Have That They Don't
- Git-isomorphic knowledge sync via the `docuvia-knowledge` orphan branch, distributing local graphs without cloud reliance.

## Fatal Flaws
- Re-indexing large monorepos blocks the main thread.
- SQLite write-lock contention during heavy ingestion.

## Immediate Next Steps
- Move indexing to a background worker process.
- Implement WAL mode properly for SQLite.
- Optimize git diff parsing.
