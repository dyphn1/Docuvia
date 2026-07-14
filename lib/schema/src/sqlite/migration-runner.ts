import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";

/**
 * Minimal, hand-written SQLite migration runner (no external migration
 * library — see the plan's "Schema single source of truth" section). Applies
 * any `.sql` file in `migrationsDir` (sorted by filename) not yet recorded in
 * `schema_migrations`.
 *
 * The read-check-apply sequence runs inside a single `IMMEDIATE` transaction so concurrent
 * first-run callers (e.g. two `docuvia init` processes racing against a fresh workspace) are
 * safe: SQLite's write lock, combined with the `busy_timeout` GraphStore.open() sets before
 * calling this, serializes them instead of letting both see an empty `schema_migrations` and
 * both try to record the same filename (`UNIQUE(filename)` violation, surfaced as
 * `DB_MIGRATION_FAILED`). The loser blocks until the winner commits, then re-checks and finds
 * every migration already applied.
 */
export function applyMigrations(
  db: Database.Database,
  migrationsDir: string,
): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       filename TEXT NOT NULL UNIQUE,
       applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
     )`,
  );

  const filenames = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const recordApplied = db.prepare(
    "INSERT INTO schema_migrations (filename) VALUES (?)",
  );

  const applyPending = db.transaction(() => {
    const applied = new Set(
      (
        db.prepare("SELECT filename FROM schema_migrations").all() as {
          filename: string;
        }[]
      ).map((row) => row.filename),
    );

    for (const filename of filenames) {
      if (applied.has(filename)) continue;

      const sql = fs.readFileSync(path.join(migrationsDir, filename), "utf8");
      db.exec(sql);
      recordApplied.run(filename);
    }
  });

  applyPending.immediate();
}
