import fs from "fs";
import path from "path";
import { AstWorkerPool } from "./ast-worker-pool.js";
import { logger } from "../utils/logger.js";

export class ExtractService {
  constructor(
    private workspaceRoot: string = process.cwd(),
    private workerPool?: AstWorkerPool
  ) {}

  public async extractDecisions(targetPath: string): Promise<{ decisions: string[] }> {
    logger.info({ targetPath }, "Extracting decisions");

    const resolvedPath = path.resolve(this.workspaceRoot, targetPath);
    if (!fs.existsSync(resolvedPath)) {
      throw new Error(`Path does not exist: ${targetPath}`);
    }

    // STUB implementation matching the fake logic
    return { decisions: ["Extracted sample decision 1", "Extracted sample decision 2"] };
  }
}
