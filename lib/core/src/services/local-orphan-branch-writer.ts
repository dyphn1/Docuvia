import { logger } from "../utils/logger.js";

export class LocalOrphanBranchWriter {
  constructor(private workspaceRoot: string = process.cwd()) {}

  public async packDirectoryToBranch(sourceDir: string, branchName: string): Promise<void> {
    logger.info({ sourceDir, branchName }, "Packing directory to branch");
    // STUB
  }
}
