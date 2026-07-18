# Docuvia2 Concurrency Conflict Defense — Reference Matrix (PLAT-006)

> **Context**: Originally a full independent analysis report (2026-07-16) proposing WAL mode,
> `withWriteLock`/`withKnowledgeBranchLock`, and concurrency stress tests for Races A
> (`analyze`+`snapshot`) and B (`doctor`+`hydrate`). Both races are now closed — the proposed
> locking architecture shipped as designed, and the two gating tests exist and pass (see
> `phase1-decision-integration.md` §6c/§8j). **Trimmed 2026-07-18**: the narrative describing
> already-shipped locking mechanics was removed as duplicative; this file now preserves only the
> two pieces of unique reference value the audit found — the workflow lock matrix below, and
> Race C, which is named here but not resolved anywhere else in the record.

---

## Core Workflow Safety Matrix

All workflows are expected to hold the locks below during execution. Kept as a quick reference —
not re-verified line-by-line against every workflow in this trim pass; treat as a design
reference, not a test oracle.

| Workflow               | Required DB Lock           | Required Git Knowledge Branch Lock | Notes                                                       |
| :--------------------- | :------------------------- | :--------------------------------- | :---------------------------------------------------------- |
| **`init`**             | 🔴 `WriteLock` (IMMEDIATE) | ❌ None                            | Ensures initialization & migrations are uninterrupted       |
| **`analyze` (Tier A)** | 🔴 `WriteLock` (IMMEDIATE) | ❌ None                            | Incremental modification of L2/L3 data, does not touch Git  |
| **`snapshot`**         | 🟢 `ReadLock` (Shared)     | 🔴 `KnowledgeBranchLock`           | Protects temp dir & branch writes during packing            |
| **`sync-knowledge`**   | ❌ None (No DB read)       | 🔴 `KnowledgeBranchLock`           | Must be protected when pushing/pulling Git knowledge branch |
| **`hydrate`**          | 🔴 `WriteLock` (IMMEDIATE) | ❌ None                            | Batch write to rebuild L2                                   |
| **`doctor`**           | 🟢 `ReadLock` (Shared)     | ❌ None                            | Read-only analysis, no exclusivity needed                   |

## Race C: `query` (foreground read) + `analyze` (background write) — still open

- **Conflict**: The developer runs `docuvia query` to check the blast radius while the
  post-commit hook silently runs `docuvia analyze` in the background, modifying L2 topology.
- **Physical consequence**: the foreground read sees outdated or inconsistent L2 data, producing
  an inaccurate impact radius.
- **Status**: unlike Races A and B, this one has no named gating test anywhere in the record.
  WAL mode's read/write non-blocking property likely makes this benign in practice (a stale-but-
  consistent snapshot, not corruption), but that's an inference, not a verified claim — worth a
  Slice 5 (`doctor`/reliability) or later reliability-pass item if it's ever worth confirming.
