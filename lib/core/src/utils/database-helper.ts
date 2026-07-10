import Database from "better-sqlite3";
export function openLocalDatabase(dbPath: string): Database.Database {
  return new Database(dbPath);
}
