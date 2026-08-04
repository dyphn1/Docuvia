import type Database from "better-sqlite3";
import type { IProjectFilesRepo, ProjectFileRow } from "@workspace/contracts";
import { SchemaTables, SchemaColumns } from "../constants.js";

/** `files` repo — `project_files` reads/writes for the file-discovery hash-diff. */
export class ProjectFilesRepo implements IProjectFilesRepo {
  constructor(private readonly db: Database.Database) {}

  /**
   * Reads path + content-hash pairs for every tracked file. Used by file discovery to diff
   * on-disk hashes against last-known hashes and decide which files need (re-)parsing. Returns
   * an empty array on a fresh workspace (no rows yet).
   */
  getAllHashes(): Array<{ filePath: string; contentHash: string | null }> {
    const rows = this.db
      .prepare(
        `SELECT ${SchemaColumns.FILE_PATH}, ${SchemaColumns.CONTENT_HASH} FROM ${SchemaTables.PROJECT_FILES}`,
      )
      .all() as Pick<ProjectFileRow, "file_path" | "content_hash">[];
    return rows.map((row) => ({
      filePath: row.file_path,
      contentHash: row.content_hash,
    }));
  }

  /** Upserts a file's content hash after (re-)parsing, keyed on (project_id, file_path). */
  upsertFile(input: {
    projectId: number;
    filePath: string;
    contentHash: string | null;
  }): void {
    this.db
      .prepare(
        `INSERT INTO ${SchemaTables.PROJECT_FILES} (${SchemaColumns.PROJECT_ID}, ${SchemaColumns.FILE_PATH}, ${SchemaColumns.CONTENT_HASH}, last_parsed_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(${SchemaColumns.PROJECT_ID}, ${SchemaColumns.FILE_PATH})
         DO UPDATE SET ${SchemaColumns.CONTENT_HASH} = excluded.${SchemaColumns.CONTENT_HASH}, last_parsed_at = CURRENT_TIMESTAMP`,
      )
      .run(input.projectId, input.filePath, input.contentHash);
  }

  /**
   * Stamps a file's `last_tier_b_processed_at`/`last_tier_b_commit_sha` after Tier B (re)computes
   * its calls-edges, keyed on (project_id, file_path) — mirrors `upsertFile()`'s own upsert shape
   * exactly. Upserts defensively: a matching row should already exist from Tier A parsing, but a
   * missing one must not silently no-op.
   */
  markTierBProcessed(input: {
    projectId: number;
    filePath: string;
    commitSha: string | null;
  }): void {
    this.db
      .prepare(
        `INSERT INTO ${SchemaTables.PROJECT_FILES} (${SchemaColumns.PROJECT_ID}, ${SchemaColumns.FILE_PATH}, last_tier_b_processed_at, last_tier_b_commit_sha)
         VALUES (?, ?, CURRENT_TIMESTAMP, ?)
         ON CONFLICT(${SchemaColumns.PROJECT_ID}, ${SchemaColumns.FILE_PATH})
         DO UPDATE SET last_tier_b_processed_at = CURRENT_TIMESTAMP, last_tier_b_commit_sha = excluded.last_tier_b_commit_sha`,
      )
      .run(input.projectId, input.filePath, input.commitSha);
  }

  /**
   * Tier B processed-at/commit-sha for a single file, keyed by `file_path` alone (matches how
   * `query`/`impact` resolve a node's own file — they don't carry a `project_id` at that point).
   * Undefined when there's no `project_files` row for `filePath` at all.
   */
  getTierBFileStatus(
    filePath: string,
  ):
    | { lastProcessedAt: string | null; lastProcessedCommitSha: string | null }
    | undefined {
    const row = this.db
      .prepare(
        `SELECT last_tier_b_processed_at, last_tier_b_commit_sha FROM ${SchemaTables.PROJECT_FILES} WHERE ${SchemaColumns.FILE_PATH} = ? LIMIT 1`,
      )
      .get(filePath) as
      | {
          last_tier_b_processed_at: string | null;
          last_tier_b_commit_sha: string | null;
        }
      | undefined;
    if (!row) return undefined;
    return {
      lastProcessedAt: row.last_tier_b_processed_at,
      lastProcessedCommitSha: row.last_tier_b_commit_sha,
    };
  }

  /**
   * Workspace-wide Tier B coverage — one cheap aggregate query, no row materialization. `SUM`
   * returns `NULL` (not `0`) over an empty table, so `processed` falls back to `0`.
   */
  getTierBCoverage(): { totalFiles: number; processedFiles: number } {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) as total, SUM(CASE WHEN last_tier_b_processed_at IS NOT NULL THEN 1 ELSE 0 END) as processed FROM ${SchemaTables.PROJECT_FILES}`,
      )
      .get() as { total: number; processed: number | null };
    return { totalFiles: row.total, processedFiles: row.processed ?? 0 };
  }
}
