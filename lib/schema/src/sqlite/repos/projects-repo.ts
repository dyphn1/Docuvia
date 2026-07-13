import type Database from "better-sqlite3";
import {
  DocuviaError,
  ErrorCodes,
  type IProjectsRepo,
  type ProjectRow,
} from "@workspace/contracts";

/**
 * `projects` repo — one project row per local.db (see `GitConstants.DEFAULT_LOCAL_PROJECT_ID`
 * in `lib/core`). Idempotency (get-before-insert) is the caller's responsibility (e.g.
 * `lib/ui-core`'s `seed-project-row.ts`); this repo only exposes the two primitives it needs,
 * no built-in upsert logic.
 */
export class ProjectsRepo implements IProjectsRepo {
  constructor(private readonly db: Database.Database) {}

  /** Returns the first project row, or undefined if none has been seeded yet. */
  getFirst(): ProjectRow | undefined {
    return this.db.prepare("SELECT * FROM projects LIMIT 1").get() as
      ProjectRow | undefined;
  }

  /** Inserts a new project row and returns it. Always inserts — callers check `getFirst()` first. */
  insert(input: { name: string; repoUrl: string }): ProjectRow {
    const result = this.db
      .prepare("INSERT INTO projects (name, repo_url) VALUES (?, ?)")
      .run(input.name, input.repoUrl);
    return this.db
      .prepare("SELECT * FROM projects WHERE id = ?")
      .get(result.lastInsertRowid) as ProjectRow;
  }

  /** Row count of the `projects` table — used by `status`. */
  count(): number {
    try {
      return (
        this.db.prepare("SELECT COUNT(*) as c FROM projects").get() as {
          c: number;
        }
      ).c;
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.DB_QUERY_FAILED,
        "Failed to count projects",
        err,
      );
    }
  }
}
