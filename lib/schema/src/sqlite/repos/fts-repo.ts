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

  /**
   * AND-first, OR-fallback (roadmap item 25's "no fallback strategy when the top FTS hit scores
   * far below what an exact match would" gap): a multi-keyword query first tries to find rows
   * matching *every* keyword — precise by construction, so no ranking heuristic is needed to
   * separate them from unrelated single-term matches. Only when that finds nothing does it widen
   * to OR (any keyword), which is inherently less precise and relies on `QueryService`'s
   * keyword-coverage re-rank to prefer the fuller partial match. A single-keyword query's AND and
   * OR expressions are identical, so this is a no-op for the already-working exact/single-word case.
   */
  searchL2Nodes(keywords: string[], limit: number): L2NodeRow[] {
    try {
      const andExpr = buildFtsMatchExpression(keywords, "AND");
      if (andExpr) {
        const andRows = this.runL2Match(andExpr, limit);
        if (andRows.length > 0) return andRows;
      }
      const orExpr = buildFtsMatchExpression(keywords, "OR");
      return orExpr ? this.runL2Match(orExpr, limit) : [];
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.DB_QUERY_FAILED,
        FTS_REPO_ERROR_MESSAGES.SEARCH_L2_FAILED,
        err,
      );
    }
  }

  /** See `searchL2Nodes()`'s doc comment — same AND-first, OR-fallback strategy for L3 nodes. */
  searchL3Nodes(keywords: string[], limit: number): L3NodeRow[] {
    try {
      const andExpr = buildFtsMatchExpression(keywords, "AND");
      if (andExpr) {
        const andRows = this.runL3Match(andExpr, limit);
        if (andRows.length > 0) return andRows;
      }
      const orExpr = buildFtsMatchExpression(keywords, "OR");
      return orExpr ? this.runL3Match(orExpr, limit) : [];
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.DB_QUERY_FAILED,
        FTS_REPO_ERROR_MESSAGES.SEARCH_L3_FAILED,
        err,
      );
    }
  }

  private runL2Match(matchExpr: string, limit: number): L2NodeRow[] {
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
  }

  private runL3Match(matchExpr: string, limit: number): L3NodeRow[] {
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
  }
}

/**
 * Builds an FTS5 MATCH expression from extracted keywords: each keyword is quoted as a phrase
 * (neutralizing FTS5 operators in user input) and combined with `operator` (`AND` requires every
 * keyword to match the same row; `OR` requires only one). Returns null when no usable keywords
 * remain — mirrors old Docuvia's `buildFtsMatchExpression`.
 */
function buildFtsMatchExpression(
  keywords: string[],
  operator: "AND" | "OR",
): string | null {
  const phrases = keywords
    .map((k) => k.replace(/"/g, "").trim())
    .filter((k) => k.length > 0)
    .map((k) => `"${k}"`);
  return phrases.length > 0 ? phrases.join(` ${operator} `) : null;
}
