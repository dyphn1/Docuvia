import Database from "better-sqlite3";
import path from "path";

export function openLocalDatabase(dbPath: string): any {
  return new Database(dbPath);
}

export function openWorkspaceLocalDatabase(workspaceRoot: string): any {
  return openLocalDatabase(path.join(workspaceRoot, ".docuvia", "local.db"));
}

export function resolveL2NodeIdForFile(db: any, relativePath: string): number | null {
  try {
    const row = db
      .prepare("SELECT id FROM l2_nodes WHERE path_patterns = ?")
      .get(JSON.stringify([relativePath]));
    return row ? row.id : null;
  } catch {
    return null;
  }
}
