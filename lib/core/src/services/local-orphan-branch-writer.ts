import fs from "fs/promises";
import path from "path";
import { logger } from "../utils/logger.js";
import { buildFastImportData, runGitFastImport } from "../utils/git-fast-import-helper.js";

export class LocalOrphanBranchWriter {
  constructor(private workspaceRoot: string = process.cwd()) {}

  public async packDirectoryToBranch(sourceDir: string, branchName: string): Promise<void> {
    logger.info({ sourceDir, branchName }, "Packing directory to branch");

    const files = await this.collectFiles(sourceDir);
    const now = Math.floor(Date.now() / 1000);
    const fastImportData = buildFastImportData(
      branchName,
      files,
      now,
      `chore: local snapshot of ${branchName}`
    );

    // Each snapshot fully replaces the branch tree (`deleteall` in buildFastImportData) as a
    // fresh root commit, so the ref update must be forced past any existing (unrelated) history.
    await runGitFastImport(this.workspaceRoot, fastImportData, true);

    logger.info({ branchName, fileCount: files.size }, "Packed directory to local orphan branch");
  }

  private async collectFiles(sourceDir: string): Promise<Map<string, string>> {
    const files = new Map<string, string>();

    const walk = async (dir: string): Promise<void> => {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (entry.isFile()) {
          const relPath = path.relative(sourceDir, fullPath);
          const content = await fs.readFile(fullPath, "utf-8");
          files.set(relPath, content);
        }
      }
    };

    await walk(sourceDir);
    return files;
  }
}
