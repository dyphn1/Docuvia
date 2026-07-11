import type Database from "better-sqlite3";

/**
 * `fts` repo — placeholder for the FTS5 keyword-search surface (ADR-029).
 *
 * The FTS5 virtual tables and sync triggers are created by
 * `migrations/0001_init.sql` (via `GraphStore.open()`), so table readiness
 * needs no method here. `init`'s pilot flow doesn't call FTS search at all
 * (that's a `query`-command concern) — search query methods (ported from old
 * Docuvia's `sqlite-fts.ts`/`SqliteGraphRepository.searchLocalNodes`) are
 * deliberately deferred to whichever future milestone rebuilds `query`, per
 * the plan's "don't build unused surface" guidance.
 */
export class FtsRepo {
  constructor(private readonly db: Database.Database) {
    void this.db;
  }
}
