import { AstWorkerPool } from "./ast-worker-pool.js";
import { logger } from "../utils/logger.js";

export class ExtractService {
  constructor(
    private workspaceRoot: string = process.cwd(),
    private workerPool?: AstWorkerPool
  ) {}

  public async extractDecisions(targetPath: string): Promise<{ decisions: string[] }> {
    logger.info({ targetPath }, "Extracting decisions");
    // STUB implementation matching the fake logic
    return { decisions: ["Extracted sample decision 1", "Extracted sample decision 2"] };
  }
}
