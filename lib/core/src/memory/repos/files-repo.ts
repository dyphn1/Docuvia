import type Database from "better-sqlite3";
import type { ProjectFileRow } from "@workspace/schema";

/** `files` repo — `project_files` reads/writes for the pilot's file-discovery hash-diff. */
export class ProjectFilesRepo {
  constructor(private readonly db: Database.Database) {}

  /**
   * Reads path + content-hash pairs for every tracked file. Used by file
   * discovery to diff on-disk hashes against last-known hashes and decide
   * which files need (re-)parsing. Returns an empty array on a fresh
   * workspace (no rows yet).
   */
  getAllHashes(): Array<{ filePath: string; contentHash: string | null }> {
    const rows = this.db
      .prepare("SELECT file_path, content_hash FROM project_files")
      .all() as Pick<ProjectFileRow, "file_path" | "content_hash">[];
    return rows.map((row) => ({ filePath: row.file_path, contentHash: row.content_hash }));
  }

  /** Upserts a file's content hash after (re-)parsing, keyed on (project_id, file_path). */
  upsertFile(input: { projectId: number; filePath: string; contentHash: string | null }): void {
    this.db
      .prepare(
        `INSERT INTO project_files (project_id, file_path, content_hash, last_parsed_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(project_id, file_path)
         DO UPDATE SET content_hash = excluded.content_hash, last_parsed_at = CURRENT_TIMESTAMP`
      )
      .run(input.projectId, input.filePath, input.contentHash);
  }
}
