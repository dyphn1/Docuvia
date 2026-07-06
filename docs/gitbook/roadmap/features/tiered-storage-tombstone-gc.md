# Tiered Storage & Tombstone GC

- **Status**: 🔲 TODO
- **Phase**: Phase 4: Git-Isomorphic Sync & Temporal Knowledge
- **Evidence / Verification Target**: `l2NodesTable` / `l3NodesTable` (no `is_active`/tombstone column yet); no background GC worker or hydrate-from-branch path in `lib/core` or `artifacts`

## Implementation Details

This feature tracks the "hot/cold" tiered storage design from [ADR-017](../../adr/ADR-017-tiered-storage-and-orphan-branch-graph-maintenance.md): soft-deleting refactored-away nodes as tombstones, periodically archiving expired tombstones to the `docuvia-knowledge` orphan branch, and hydrating historical data back on demand.

What is live today is only the full-snapshot write in [`lib/core/src/services/orphan-branch-writer.ts`](../../../../lib/core/src/services/orphan-branch-writer.ts) (see [Orphan Branch R/W Protocol](orphan-branch-r-w-protocol.md)) — it writes the current-state snapshot per project, not a tiered hot/cold archive of expired tombstones. The tombstone column, GC worker, and hydrate path described in ADR-017 do not exist yet.

## Testing & Verification

- Not yet applicable — no implementation to verify.
- Once implemented, validate via `pnpm test` in `lib/core`, and confirm expired tombstones are archived to `docuvia-knowledge` and hydrate back correctly.
