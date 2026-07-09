import fs from "fs/promises";
import path from "path";
import { existsSync } from "fs";
import Database from "better-sqlite3";
import { logger } from "../utils/logger.js";

export class CleanService {
  constructor(private workspaceRoot: string = process.cwd()) {}

  public async clean(): Promise<{ deleted: boolean; message: string }> {
    const docuviaDir = path.join(this.workspaceRoot, ".docuvia");
    const dbPath = path.join(docuviaDir, "local.db");

    try {
      await fs.access(dbPath);
      await fs.unlink(dbPath);
      logger.info({ path: dbPath }, "Deleted local database");
      return { deleted: true, message: "Cleaned .docuvia/local.db database." };
    } catch {
      return { deleted: false, message: "No local database found to clean." };
    }
  }

  /**
   * Surgically removes project_files/l2_nodes (and their node_links/l2_node_l1_tags)
   * for files no longer present, without wiping the whole database like clean() does.
   * A node is considered stale when none of its source_paths are in activeFiles.
   */
  public async prune(activeFiles: string[]): Promise<{ success: boolean; prunedFiles: number }> {
    const dbPath = path.join(this.workspaceRoot, ".docuvia", "local.db");
    if (!existsSync(dbPath)) {
      return { success: false, prunedFiles: 0 };
    }

    const activeSet = new Set(activeFiles);
    const db = new Database(dbPath);
    try {
      const staleNodeIds = (
        db.prepare("SELECT id, source_paths FROM l2_nodes").all() as {
          id: number;
          source_paths: string | null;
        }[]
      )
        .filter((row) => {
          const paths: string[] = row.source_paths ? JSON.parse(row.source_paths) : [];
          return paths.length === 0 || paths.every((p) => !activeSet.has(p));
        })
        .map((row) => row.id);

      const prune = db.transaction((ids: number[]) => {
        if (ids.length > 0) {
          const placeholders = ids.map(() => "?").join(",");
          db.prepare(`DELETE FROM l2_node_l1_tags WHERE l2_node_id IN (${placeholders})`).run(
            ...ids
          );
          db.prepare(
            `DELETE FROM node_links WHERE source_node_id IN (${placeholders}) OR target_node_id IN (${placeholders})`
          ).run(...ids, ...ids);
          db.prepare(`DELETE FROM l2_nodes WHERE id IN (${placeholders})`).run(...ids);
        }

        const allFiles = db.prepare("SELECT file_path FROM project_files").all() as {
          file_path: string;
        }[];
        const staleFiles = allFiles.filter((f) => !activeSet.has(f.file_path));
        for (const { file_path } of staleFiles) {
          db.prepare("DELETE FROM project_files WHERE file_path = ?").run(file_path);
        }
        return staleFiles.length;
      });

      const prunedFiles = prune(staleNodeIds);
      logger.info({ prunedFiles, staleNodes: staleNodeIds.length }, "Pruned stale records");
      return { success: true, prunedFiles };
    } finally {
      db.close();
    }
  }
}
