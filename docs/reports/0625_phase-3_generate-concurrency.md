# Verification Report: Generate Concurrency (Missing Transactions)
- **Date**: 2026-06-25
- **Phase & Item**: Phase 3 - Generate pipeline orchestrator
- **Target File**: artifacts/api-server/src/routes/generate.ts
- **Status Update Required**: ❌ ERROR

### Description of Failure
The `POST /projects/:id/generate` endpoint correctly uses an atomic `UPDATE ... RETURNING` query to lock the project state. However, the subsequent LLM generation pipeline (`generateL1Tags`, `generateL2Nodes`, `condenseL3Node`, etc.) executes dozens of discrete `db.insert()` and `db.update()` statements **without any database transaction wrapper (`db.transaction`)**. 

If the Node.js process crashes, the LLM hits a 429 rate limit, or an OOM occurs mid-generation, the database is left permanently corrupted with partial nodes and orphaned tags. The project state remains deadlocked in `indexing` until a hardcoded 30-minute timeout expires.

### Recommended Fix
Wrap the entire inner LLM generation pipeline in a robust `db.transaction()` block. If an external API call fails, the database should cleanly rollback to its pre-generation state.
