import * as path from "path";
import { openLocalDatabase } from "@workspace/core";

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
