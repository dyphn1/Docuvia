import type Database from "better-sqlite3";
import type { IFtsRepo } from "@workspace/contracts";

/**
 * `fts` repo — placeholder for the FTS5 keyword-search surface (ADR-029).
 *
 * The FTS5 virtual tables and sync triggers are created by `migrations/0001_init.sql` (via
 * `GraphStore.open()`), so table readiness needs no method here. Search query methods are
 * deliberately deferred to whichever future milestone rebuilds the `query` command.
 */
export class FtsRepo implements IFtsRepo {
  constructor(private readonly db: Database.Database) {
    void this.db;
  }
}
