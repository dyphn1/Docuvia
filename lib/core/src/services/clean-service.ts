import fs from "fs/promises";
import path from "path";
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
}
