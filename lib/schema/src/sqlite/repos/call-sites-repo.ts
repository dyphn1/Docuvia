import type Database from "better-sqlite3";
import type { AstCallSiteRow, ICallSitesRepo } from "@workspace/contracts";
import { SchemaTables, SchemaColumns } from "../constants.js";

/**
 * `callSites` repo — `ast_call_sites` reads/writes (issue #11 plan A, Slice 3). Tier A's
 * `collectCallEdges` (ast-worker.ts) computes each call site's source position; this table is
 * the durable read-back surface Tier B's forward resolution pass seeds itself from. See
 * `migrations/0008_ast_call_sites.sql`'s header comment for why this is one row per call site,
 * not one row per resolved edge.
 */
export class CallSitesRepo implements ICallSitesRepo {
  constructor(private readonly db: Database.Database) {}

  /** Deletes every call-site row for one (project, file) — see `ICallSitesRepo.deleteForFile`'s
   *  doc comment on the delete-then-reinsert-on-reparse pattern this mirrors. */
  deleteForFile(projectId: number, filePath: string): void {
    this.db
      .prepare(
        `DELETE FROM ${SchemaTables.AST_CALL_SITES} WHERE ${SchemaColumns.PROJECT_ID} = ? AND ${SchemaColumns.FILE_PATH} = ?`,
      )
      .run(projectId, filePath);
  }

  /** Bulk-inserts one file's call sites via one prepared statement in a loop (matches
   *  `GraphPersisterService.insertFunctionNodes`'s existing bulk-insert idiom). No-op on an
   *  empty array. */
  insertMany(
    projectId: number,
    filePath: string,
    callSites: Array<{
      targetFunction: string;
      startLine: number;
      startColumn: number;
    }>,
  ): void {
    if (callSites.length === 0) return;

    const insert = this.db.prepare(
      `INSERT INTO ${SchemaTables.AST_CALL_SITES} (${SchemaColumns.PROJECT_ID}, ${SchemaColumns.FILE_PATH}, ${SchemaColumns.TARGET_FUNCTION}, ${SchemaColumns.START_LINE}, ${SchemaColumns.START_COLUMN})
       VALUES (?, ?, ?, ?, ?)`,
    );
    for (const callSite of callSites) {
      insert.run(
        projectId,
        filePath,
        callSite.targetFunction,
        callSite.startLine,
        callSite.startColumn,
      );
    }
  }

  /** Tier B's read-back — see `ICallSitesRepo.getForFiles`'s doc comment (D4: keyed by the exact
   *  `filePaths` strings passed in, no path normalization; files with zero rows are absent from
   *  the returned map, not present with an empty array). Returns an empty map without touching
   *  the database when `filePaths` is empty. */
  getForFiles(
    projectId: number,
    filePaths: string[],
  ): Map<
    string,
    Array<{ targetFunction: string; startLine: number; startColumn: number }>
  > {
    const result = new Map<
      string,
      Array<{ targetFunction: string; startLine: number; startColumn: number }>
    >();
    if (filePaths.length === 0) return result;

    const placeholders = filePaths.map(() => "?").join(",");
    const rows = this.db
      .prepare(
        `SELECT ${SchemaColumns.FILE_PATH}, ${SchemaColumns.TARGET_FUNCTION}, ${SchemaColumns.START_LINE}, ${SchemaColumns.START_COLUMN}
         FROM ${SchemaTables.AST_CALL_SITES}
         WHERE ${SchemaColumns.PROJECT_ID} = ? AND ${SchemaColumns.FILE_PATH} IN (${placeholders})`,
      )
      .all(projectId, ...filePaths) as Pick<
      AstCallSiteRow,
      "file_path" | "target_function" | "start_line" | "start_column"
    >[];

    for (const row of rows) {
      const entry = {
        targetFunction: row.target_function,
        startLine: row.start_line,
        startColumn: row.start_column,
      };
      const existing = result.get(row.file_path);
      if (existing) {
        existing.push(entry);
      } else {
        result.set(row.file_path, [entry]);
      }
    }

    return result;
  }

  /** Issue #217's impact fallback read-back -- see `ICallSitesRepo.getByTargetFunctions`'s doc
   *  comment. Mirrors `getForFiles`'s prepared-statement/IN-clause idiom, keyed by the calling
   *  file instead of filtered by it. Backed by `0011_ast_call_sites_target_idx.sql`. */
  getByTargetFunctions(
    projectId: number,
    targetFunctions: string[],
  ): Map<string, Array<{ startLine: number; startColumn: number }>> {
    const result = new Map<
      string,
      Array<{ startLine: number; startColumn: number }>
    >();
    if (targetFunctions.length === 0) return result;

    const placeholders = targetFunctions.map(() => "?").join(",");
    const rows = this.db
      .prepare(
        `SELECT ${SchemaColumns.FILE_PATH}, ${SchemaColumns.START_LINE}, ${SchemaColumns.START_COLUMN}
         FROM ${SchemaTables.AST_CALL_SITES}
         WHERE ${SchemaColumns.PROJECT_ID} = ? AND ${SchemaColumns.TARGET_FUNCTION} IN (${placeholders})`,
      )
      .all(projectId, ...targetFunctions) as Pick<
      AstCallSiteRow,
      "file_path" | "start_line" | "start_column"
    >[];

    for (const row of rows) {
      const entry = {
        startLine: row.start_line,
        startColumn: row.start_column,
      };
      const existing = result.get(row.file_path);
      if (existing) {
        existing.push(entry);
      } else {
        result.set(row.file_path, [entry]);
      }
    }

    return result;
  }
}
