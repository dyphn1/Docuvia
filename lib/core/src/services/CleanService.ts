import fs from "fs/promises";
import path from "path";

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
}
