import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { logger } from "../utils/logger.js";

export const LOCAL_DB_NOT_FOUND_MESSAGE = 'Local database not found. Please run "docuvia init".';

export class StatusService {
  constructor(private workspaceRoot: string = process.cwd()) {}

  public async getStatus(): Promise<{ projects: number; l2Nodes: number; l3Nodes: number }> {
    logger.info("Getting status");

    const dbPath = path.join(this.workspaceRoot, ".docuvia", "local.db");
    if (!fs.existsSync(dbPath)) {
      throw new Error(LOCAL_DB_NOT_FOUND_MESSAGE);
    }

    const db = new Database(dbPath, { readonly: true });
    try {
      const count = (table: string): number =>
        (db.prepare(`SELECT COUNT(*) as c FROM ${table}`).get() as { c: number }).c;

      return {
        projects: count("projects"),
        l2Nodes: count("l2_nodes"),
        l3Nodes: count("l3_nodes"),
      };
    } finally {
      db.close();
    }
  }
}
