import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";

/**
 * Minimal, hand-written SQLite migration runner (no external migration
 * library — see the plan's "Schema single source of truth" section). Applies
 * any `.sql` file in `migrationsDir` (sorted by filename) not yet recorded in
 * `schema_migrations`, each inside its own transaction.
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

  const applied = new Set(
    (
      db.prepare("SELECT filename FROM schema_migrations").all() as {
        filename: string;
      }[]
    ).map((row) => row.filename),
  );

  const filenames = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const recordApplied = db.prepare(
    "INSERT INTO schema_migrations (filename) VALUES (?)",
  );

  for (const filename of filenames) {
    if (applied.has(filename)) continue;

    const sql = fs.readFileSync(path.join(migrationsDir, filename), "utf8");
    const runMigration = db.transaction(() => {
      db.exec(sql);
      recordApplied.run(filename);
    });
    runMigration();
  }
}
