import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import path from "path";
import fs from "fs/promises";
import { existsSync } from "fs";

const execFileAsync = promisify(execFile);

function buildFastImportData(branch: string, files: Map<string, string>, nowUnix: number): string {
  const lines: string[] = [];
  lines.push(`commit refs/heads/${branch}`);
  lines.push(`committer Docuvia <docuvia@localhost> ${nowUnix} +0000`);
  const msg = `chore: pack knowledge graph to branch`;
  lines.push(`data ${Buffer.byteLength(msg, "utf8")}`);
  lines.push(msg);

  // Delete and recreate project subtree
  lines.push(`deleteall`);

  for (const [filePath, content] of files) {
    const contentBytes = Buffer.from(content, "utf8");
    // Ensure posix path separators for git fast-import
    const posixPath = filePath.split(path.sep).join(path.posix.sep);
    lines.push(`M 100644 inline ${posixPath}`);
    lines.push(`data ${contentBytes.length}`);
    lines.push(content);
  }

  lines.push("");
  return lines.join("\n");
}

function runGitFastImport(workspaceRoot: string, fastImportData: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["fast-import", "--quiet", "--force"], {
      cwd: workspaceRoot,
      stdio: ["pipe", "ignore", "pipe"],
    });
    const stderrChunks: Buffer[] = [];
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) return resolve();
      const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
      reject(new Error(`git fast-import exited with code ${code}${stderr ? ": " + stderr : ""}`));
    });
    child.stdin.end(fastImportData, "utf8");
  });
}

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
    const fastImportData = buildFastImportData(branch, files, now);

    await runGitFastImport(this.workspaceRoot, fastImportData);
  }
}
