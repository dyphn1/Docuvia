import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import Database from "better-sqlite3";

export class CleanService {
  constructor(private workspaceRoot: string) {}

  public async clean() {
    const dbPath = path.join(this.workspaceRoot, ".docuvia", "local.db");
    let deleted = false;
    try {
      await fs.access(dbPath);
      await fs.unlink(dbPath);
      deleted = true;
    } catch (e: any) {
      if (e.code !== "ENOENT") {
        throw e;
      }
    }
    return { success: true, deleted };
  }

  public async prune(activeFiles: string[]) {
    const dbPath = path.join(this.workspaceRoot, ".docuvia", "local.db");
    if (!fsSync.existsSync(dbPath)) {
      return { success: true, prunedFiles: 0 };
    }

    const db = new Database(dbPath);
    let prunedFiles = 0;
    try {
      db.transaction(() => {
        // Find all project files currently in DB
        const filesInDb = db.prepare("SELECT file_path FROM project_files").all() as {
          file_path: string;
        }[];
        const activeSet = new Set(activeFiles);
        const toDelete = filesInDb.map((f) => f.file_path).filter((f) => !activeSet.has(f));

        if (toDelete.length > 0) {
          prunedFiles = toDelete.length;
          // Delete from project_files
          const deleteFileStmt = db.prepare("DELETE FROM project_files WHERE file_path = ?");
          for (const file of toDelete) {
            deleteFileStmt.run(file);
          }

          // Delete L2 nodes where source_paths points entirely to deleted files
          const allNodes = db.prepare("SELECT id, source_paths FROM l2_nodes").all() as {
            id: number;
            source_paths: string;
          }[];
          const nodesToDelete: number[] = [];
          for (const node of allNodes) {
            try {
              const paths: string[] = JSON.parse(node.source_paths || "[]");
              if (paths.length > 0 && paths.every((p) => toDelete.includes(p))) {
                nodesToDelete.push(node.id);
              }
            } catch (e) {
              // Ignore invalid JSON
            }
          }

          if (nodesToDelete.length > 0) {
            const deleteNodeStmt = db.prepare("DELETE FROM l2_nodes WHERE id = ?");
            const deleteLinksStmt = db.prepare(
              "DELETE FROM node_links WHERE source_node_id = ? OR target_node_id = ?"
            );
            const deleteL1TagsStmt = db.prepare("DELETE FROM l2_node_l1_tags WHERE l2_node_id = ?");

            for (const id of nodesToDelete) {
              deleteNodeStmt.run(id);
              deleteLinksStmt.run(id, id);
              deleteL1TagsStmt.run(id);
            }
          }
        }
      })();
    } finally {
      db.close();
    }
    return { success: true, prunedFiles };
  }
}
