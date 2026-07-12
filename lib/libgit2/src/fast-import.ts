import { spawn } from "node:child_process";
import fs from "fs/promises";
import path from "path";
import os from "os";
import pLimit from "p-limit";

/**
 * Raw `git fast-import` mechanics — pure wire-format encoding and directory reading, no
 * Docuvia-specific semantics (see `Libgit2Provider.packDirectoryToBranch()`, the only caller).
 */

// Bounded concurrency for the per-file reads below, mirroring old Docuvia's
// `LocalOrphanBranchWriter.collectFiles()`: an earlier, fully-unbounded walk (every `fs.readFile`
// across the whole tree in flight at once) crashed with `EMFILE: too many open files` on a
// ~18k-file tree. Directory recursion (`fs.readdir`) is left unbounded; only the leaf file reads
// go through `limit()`.
const COLLECT_FILES_READ_CONCURRENCY = os.cpus().length * 4;

export async function collectDirectoryFiles(sourceDir: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const limit = pLimit(COLLECT_FILES_READ_CONCURRENCY);

  const walk = async (dir: string): Promise<void> => {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    await Promise.all(
      entries.map(async (entry) => {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (entry.isFile()) {
          const relPath = path.relative(sourceDir, fullPath);
          const content = await limit(() => fs.readFile(fullPath, "utf-8"));
          files.set(relPath, content);
        }
      })
    );
  };

  await walk(sourceDir);
  return files;
}

export function buildFastImportData(
  branch: string,
  files: Map<string, string>,
  nowUnix: number,
  commitMessage: string,
  parentCommitSha?: string
): string {
  const lines: string[] = [];
  lines.push(`commit refs/heads/${branch}`);
  lines.push(`committer Docuvia <docuvia@localhost> ${nowUnix} +0000`);
  lines.push(`data ${Buffer.byteLength(commitMessage, "utf8")}`);
  lines.push(commitMessage);

  // Parenting on the branch's current tip (STOR-001 point 2 — "continuous stacking") is what
  // keeps prior commits reachable; omitted only for the branch's very first commit, which is
  // necessarily a root commit.
  if (parentCommitSha) {
    lines.push(`from ${parentCommitSha}`);
  }

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

/**
 * Spawns `git fast-import --quiet` and streams `fastImportData` to its stdin. `--force` is
 * deliberately NOT passed: `buildFastImportData` always parents a new commit on the branch's
 * current tip (see its `from` line), so every import is a fast-forward. If the caller ever
 * computes a stale parent, fast-import failing loudly here is correct — silently forcing past it
 * would orphan history (STOR-001 point 2).
 */
export function runFastImport(cwd: string, fastImportData: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["fast-import", "--quiet"], {
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
