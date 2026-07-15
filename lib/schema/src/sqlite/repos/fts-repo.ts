import type Database from "better-sqlite3";
import {
  DocuviaError,
  ErrorCodes,
  type IFtsRepo,
  type L2NodeRow,
  type L3NodeRow,
} from "@workspace/contracts";
import { SchemaTables } from "../constants.js";

const FTS_REPO_ERROR_MESSAGES = {
  SEARCH_L2_FAILED: "Failed to search l2 nodes via FTS",
  SEARCH_L3_FAILED: "Failed to search l3 nodes via FTS",
} as const;

/**
 * `fts` repo — the FTS5 keyword-search surface (ADR-029), mirroring old Docuvia's
 * `sqlite-fts.ts`/`sqlite-graph.repository.ts#searchLocalNodes`.
 *
 * The FTS5 virtual tables and sync triggers are created by `migrations/0001_init.sql` (via
 * `GraphStore.open()`), applied once per database file (see `migration-runner.ts`) — since this
 * schema never predates the FTS5 rollout, there is no legacy-database self-heal/rebuild step to
 * port (unlike old Docuvia's `ensureLocalFtsIndex`, which had to backfill pre-existing databases).
 */
export class FtsRepo implements IFtsRepo {
  constructor(private readonly db: Database.Database) {}

  searchL2Nodes(keywords: string[], limit: number): L2NodeRow[] {
    const matchExpr = buildFtsMatchExpression(keywords);
    if (!matchExpr) return [];

    try {
      return this.db
        .prepare(
          `SELECT n.*
           FROM ${SchemaTables.L2_NODES_FTS} f
           JOIN ${SchemaTables.L2_NODES} n ON n.id = f.rowid
           WHERE ${SchemaTables.L2_NODES_FTS} MATCH ?
           ORDER BY rank
           LIMIT ?`,
        )
        .all(matchExpr, limit) as L2NodeRow[];
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.DB_QUERY_FAILED,
        FTS_REPO_ERROR_MESSAGES.SEARCH_L2_FAILED,
        err,
      );
    }
  }

  searchL3Nodes(keywords: string[], limit: number): L3NodeRow[] {
    const matchExpr = buildFtsMatchExpression(keywords);
    if (!matchExpr) return [];

    try {
      return this.db
        .prepare(
          `SELECT n.*
           FROM ${SchemaTables.L3_NODES_FTS} f
           JOIN ${SchemaTables.L3_NODES} n ON n.id = f.rowid
           WHERE ${SchemaTables.L3_NODES_FTS} MATCH ?
           ORDER BY rank
           LIMIT ?`,
        )
        .all(matchExpr, limit) as L3NodeRow[];
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.DB_QUERY_FAILED,
        FTS_REPO_ERROR_MESSAGES.SEARCH_L3_FAILED,
        err,
      );
    }
  }
}

/**
 * Builds an FTS5 MATCH expression from extracted keywords: each keyword is quoted as a phrase
 * (neutralizing FTS5 operators in user input) and combined with OR. Returns null when no usable
 * keywords remain — mirrors old Docuvia's `buildFtsMatchExpression`.
 */
function buildFtsMatchExpression(keywords: string[]): string | null {
  const phrases = keywords
    .map((k) => k.replace(/"/g, "").trim())
    .filter((k) => k.length > 0)
    .map((k) => `"${k}"`);
  return phrases.length > 0 ? phrases.join(" OR ") : null;
}
