import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { l2NodesTable, l3NodesTable, projectsTable } from "@workspace/db/schema";
import { count } from "drizzle-orm";
import path from "path";
import fs from "fs";
import { logger } from "../utils/logger.js";

export class StatusService {
  constructor(private workspaceRoot: string) {}

  public async getStatus() {
    const dbPath = path.join(this.workspaceRoot, ".docuvia", "local.db");
    if (!fs.existsSync(dbPath)) {
      throw new Error('Local database not found. Please run "docuvia init".');
    }
    const sqlite = new Database(dbPath);
    const db = drizzle(sqlite);

    const [l2NodesCount] = await db.select({ value: count() }).from(l2NodesTable);
    const [l3NodesCount] = await db.select({ value: count() }).from(l3NodesTable);
    // projectsTable might not be in local.db, but I'll query it if it's defined
    let projectsCountValue = 0;
    try {
      const [projectsCount] = await db.select({ value: count() }).from(projectsTable);
      projectsCountValue = projectsCount.value;
    } catch (e: any) {
      // Ignore if projects table is not in local sqlite
      logger.debug({ err: e }, "projects table missing in local status check");
    }

    return {
      l2Nodes: l2NodesCount.value,
      l3Nodes: l3NodesCount.value,
      projects: projectsCountValue,
    };
  }
}
