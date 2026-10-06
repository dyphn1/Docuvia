# GRPH-008 Phase 3: Dependency invalidation

This closes the source-change invalidation gap for the current Q1/Q2 proof slices. It does not change ScopeResolver, proof selection policy, Tier B eligibility, calibration, or test/temporal labels.

## Workflow wiring

- Delta ingestion hashes every changed path at `headSha`, including configuration files; deleted paths and the old side of renames are sent with a null hash. Generated Docuvia hooks are excluded. Immediately after hashing and before semantic classification, the repository invalidates proofs whose stored dependency fingerprint changed and rebuilds each affected caller's collapsed `calls` projection inside the same SQLite transaction.
- The delta workflow reparses affected callers that were not already changed or retired. Since a delta has no complete source index, this pass conservatively restores ScopeResolver's edge and leaves strict reproof to a later complete ingestion. A stale proven target is never retained.
- Full ingestion and successful hydration invalidate all current proof rows and rebuild their projections before replacing graph state. Full ingestion can prove again from its complete source index; hydration treats imported aggregate links as unproven graph state.
- Repeat `init` does not reparse a populated graph: `InitWorkflow.execute()` returns through its already-initialized guard before discovery or persistence. First-time init has no prior proof state to invalidate.
- Tier B results for stale rows continue to be rejected. Projection rebuilding retains a collapsed caller-to-target edge while any other current call site in that caller still selects the target.

The code is in `lib/ui-core/src/workflows/analyze/run-delta-ingestion.ts:126`, `:130`, `:213`, `lib/schema/src/sqlite/repos/call-site-resolutions-repo.ts:473`, `:546`, `lib/ui-core/src/workflows/analyze/run-full-ingestion.ts:67`, and `lib/core/src/git/hydration.service.ts:360`.

## Exit-gate coverage

The workflow tests cover a changed target, a Q2 barrel edit, a configured `tsconfig` path edit, an unrelated one-file edit, and invalidation errors before persistence. SQLite integration tests cover hash changes and deletion, unrelated-path no-churn, shared collapsed edges after an LSP contradiction, stale Tier B responses, bounded batches, and rollback when projection rebuilding fails. Full-ingestion and hydration tests assert invalidation occurs before source replacement. The focused run passed 102 tests across five files.

Q1 and Q2 are implemented for their current strict proof slices. Broader Q3 receiver forms and the remaining proof-shape cases stay open in the Phase 3 gap table. Delta invalidation deliberately chooses safe over-invalidation over treating an incomplete index as complete.

## One-file delta cost

Measured the real `runDeltaIngestion` workflow before and after the wiring with the repository's actual AST worker, GraphPersister, and SQLite store. Each condition started from a fresh copy of the 32 MiB local graph and simulated one edit to `lib/core/src/semantic/call-resolution-reexport-proof.ts` through an in-memory Git provider. The copied graph has no call-site dependency rows, so this measures the one-file edit path and empty invalidation transaction without dependent-caller fanout. Each side had one warm-up followed by five measured runs; wall time is the median and RSS is the process peak.

| Measurement      |      Before |       After |           Change |
| ---------------- | ----------: | ----------: | ---------------: |
| Wall time        |      131 ms |      134 ms |            +2.3% |
| Peak process RSS | 1,551.7 MiB | 1,553.4 MiB | +1.7 MiB (+0.1%) |

The wall-time change is under the 10% guard, and peak RSS remains below 6 GiB. This post-commit path does not invoke tsserver or LSP.
