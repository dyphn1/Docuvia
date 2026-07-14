import type Database from "better-sqlite3";
import {
  DocuviaError,
  ErrorCodes,
  type IProjectsRepo,
  type ProjectRow,
} from "@workspace/contracts";

/**
 * `projects` repo — one project row per local.db (see `GitConstants.DEFAULT_LOCAL_PROJECT_ID`
 * in `lib/core`). `getFirst()`/`insert()` are exposed as separate primitives for callers that
 * already know which one they need; callers doing the idempotency check themselves (e.g.
 * `lib/ui-core`'s `seed-project-row.ts`) should use `getOrInsert()` instead of composing
 * `getFirst()` + `insert()` by hand — that composition isn't safe across processes.
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

  /**
   * Atomic counterpart to a caller doing `getFirst()` then `insert()` itself: the check and the
   * insert run inside one `IMMEDIATE` transaction, so a second process racing this same sequence
   * (e.g. two `docuvia init` processes against a fresh workspace) blocks on SQLite's write lock
   * instead of also observing "no project yet" and inserting a duplicate row.
   */
  getOrInsert(input: { name: string; repoUrl: string }): ProjectRow {
    const run = this.db.transaction(() => {
      const existing = this.getFirst();
      if (existing) return existing;
      return this.insert(input);
    });
    return run.immediate();
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
