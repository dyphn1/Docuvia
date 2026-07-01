import Database from "better-sqlite3";
export function openLocalDatabase(dbPath: string): any {
  return new Database(dbPath);
}
