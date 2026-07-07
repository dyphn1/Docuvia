import { spawn } from "node:child_process";
import path from "path";

export function buildFastImportData(
  branch: string,
  files: Map<string, string>,
  nowUnix: number,
  commitMessage: string
): string {
  const lines: string[] = [];
  lines.push(`commit refs/heads/${branch}`);
  lines.push(`committer Docuvia <docuvia@localhost> ${nowUnix} +0000`);
  lines.push(`data ${Buffer.byteLength(commitMessage, "utf8")}`);
  lines.push(commitMessage);

  lines.push(`deleteall`);

  for (const [filePath, content] of files) {
    const contentBytes = Buffer.from(content, "utf8");
    const posixPath = filePath.split(path.sep).join(path.posix.sep);
    lines.push(`M 100644 inline ${posixPath}`);
    lines.push(`data ${contentBytes.length}`);
    lines.push(content);
  }

  lines.push("");
  return lines.join("\n");
}

export function runGitFastImport(
  workspaceRoot: string | undefined,
  fastImportData: string,
  force: boolean = false
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cwd = workspaceRoot || process.env.DOCUVIA_KNOWLEDGE_REPO_PATH || process.cwd();
    const args = ["fast-import", "--quiet"];
    if (force) {
      args.push("--force");
    }
    const child = spawn("git", args, {
      cwd,
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
