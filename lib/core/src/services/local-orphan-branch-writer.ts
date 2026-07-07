import { buildFastImportData, runGitFastImport } from "../utils/git-fast-import-helper.js";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import path from "path";
import fs from "fs/promises";
import { existsSync } from "fs";

const execFileAsync = promisify(execFile);

export class LocalOrphanBranchWriter {
  constructor(private workspaceRoot: string) {}

  public async packDirectoryToBranch(
    sourceDirectory: string,
    branch: string = "docuvia-knowledge"
  ): Promise<void> {
    if (!existsSync(sourceDirectory)) {
      throw new Error(`Source directory not found at ${sourceDirectory}`);
    }

    try {
      await execFileAsync("git", ["--version"], { cwd: this.workspaceRoot });
    } catch {
      throw new Error("git CLI not available or not in a git repository");
    }

    const files: Map<string, string> = new Map();

    async function walk(dir: string, base: string) {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        const relPath = path.relative(base, fullPath);
        if (entry.isDirectory()) {
          await walk(fullPath, base);
        } else {
          const content = await fs.readFile(fullPath, "utf8");
          files.set(relPath, content);
        }
      }
    }

    await walk(sourceDirectory, sourceDirectory);

    const now = Math.floor(Date.now() / 1000);
    const fastImportData = buildFastImportData(
      branch,
      files,
      now,
      "chore: pack knowledge graph to branch"
    );

    await runGitFastImport(this.workspaceRoot, fastImportData, true);
  }
}
