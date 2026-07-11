import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { logger } from "../utils/logger.js";
import { appendCommandLogLine } from "./command-log-writer.js";
import { STATUS_LOG_FILE_NAME } from "../constants/paths.js";

export const LOCAL_DB_NOT_FOUND_MESSAGE = 'Local database not found. Please run "docuvia init".';

export class StatusService {
  constructor(private workspaceRoot: string = process.cwd()) {}

  public async getStatus(): Promise<{ projects: number; l2Nodes: number; l3Nodes: number }> {
    logger.info("Getting status");
    await appendCommandLogLine(this.workspaceRoot, STATUS_LOG_FILE_NAME, {
      event: "status.start",
    }).catch(() => {});

    const dbPath = path.join(this.workspaceRoot, ".docuvia", "local.db");
    if (!fs.existsSync(dbPath)) {
      await appendCommandLogLine(this.workspaceRoot, STATUS_LOG_FILE_NAME, {
        event: "status.error",
        message: LOCAL_DB_NOT_FOUND_MESSAGE,
      }).catch(() => {});
      throw new Error(LOCAL_DB_NOT_FOUND_MESSAGE);
    }

    const db = new Database(dbPath, { readonly: true });
    try {
      const count = (table: string): number =>
        (db.prepare(`SELECT COUNT(*) as c FROM ${table}`).get() as { c: number }).c;

      const result = {
        projects: count("projects"),
        l2Nodes: count("l2_nodes"),
        l3Nodes: count("l3_nodes"),
      };
      await appendCommandLogLine(this.workspaceRoot, STATUS_LOG_FILE_NAME, {
        event: "status.summary",
        ...result,
      }).catch(() => {});
      return result;
    } finally {
      db.close();
    }
  }
}
