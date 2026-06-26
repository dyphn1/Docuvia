import { execFile, spawn } from "child_process";
import * as readline from "readline";
import { promisify } from "util";
import fs from "fs/promises";
import os from "os";
import path from "path";
import crypto from "crypto";
import { logger } from "./logger.js";

const execFileAsync = promisify(execFile);

export interface GitCommitData {
  sha: string;
  message: string;
  author: string;
  date: string;
  diff?: string;
  branchName?: string;
}

export class LocalGitClient {
  private repoDir: string | null = null;

  constructor(private readonly repoUrl: string) {}

  async clone(branch = "main"): Promise<void> {
    this.repoDir = path.join(os.tmpdir(), `docuvia-git-${crypto.randomUUID()}`);
    logger.info({ repoDir: this.repoDir, repoUrl: this.repoUrl }, "Cloning repository");
    await execFileAsync("git", [
      "clone",
      "--depth=500",
      "--branch",
      branch,
      "--",
      this.repoUrl,
      this.repoDir,
    ]);
  }

  async getCommits(limit = 100, since?: Date, revisionRange?: string): Promise<GitCommitData[]> {
    if (!this.repoDir) throw new Error("Repository not cloned yet");

    const args = ["log", `--max-count=${limit}`, "--format=COMMIT_SEP%n%H%n%s%n%an%n%aI%n%b"];

    if (revisionRange) {
      args.push(revisionRange);
    }

    if (since) {
      args.push(`--since=${since.toISOString()}`);
    }

    const child = spawn("git", args, { cwd: this.repoDir });
    const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });

    const commits: GitCommitData[] = [];
    let currentCommit: Partial<GitCommitData> | null = null;
    let lineIdx = 0;
    let bodyLines: string[] = [];

    for await (const line of rl) {
      if (line === "COMMIT_SEP") {
        if (currentCommit && currentCommit.sha) {
          currentCommit.message =
            bodyLines.length > 0
              ? `${currentCommit.message}\n\n${bodyLines.join("\n")}`
              : currentCommit.message;
          commits.push(currentCommit as GitCommitData);
        }
        currentCommit = {};
        lineIdx = 0;
        bodyLines = [];
        continue;
      }

      if (currentCommit) {
        if (lineIdx === 0) currentCommit.sha = line;
        else if (lineIdx === 1) currentCommit.message = line;
        else if (lineIdx === 2) currentCommit.author = line;
        else if (lineIdx === 3) currentCommit.date = line;
        else bodyLines.push(line);
        lineIdx++;
      }
    }

    if (currentCommit && currentCommit.sha) {
      currentCommit.message =
        bodyLines.length > 0
          ? `${currentCommit.message}\n\n${bodyLines.join("\n")}`
          : currentCommit.message;
      commits.push(currentCommit as GitCommitData);
    }

    return new Promise((resolve, reject) => {
      child.on("close", (code) => {
        if (code !== 0 && code !== 141) reject(new Error(`Git log failed with code ${code}`));
        else resolve(commits);
      });
      child.on("error", reject);
    });
  }

  async getProjectedCommits(limit = 100, baseRef = "origin/main"): Promise<GitCommitData[]> {
    if (!this.repoDir) throw new Error("Repository not cloned yet");

    let revisionRange: string | undefined;
    try {
      const { stdout } = await execFileAsync("git", ["merge-base", "HEAD", baseRef], {
        cwd: this.repoDir,
      });
      const mergeBase = stdout.trim();
      if (mergeBase) {
        revisionRange = `${mergeBase}..HEAD`;
      }
    } catch (e) {
      logger.warn(
        { baseRef, err: e },
        "Failed to find git merge-base; falling back to full repository analysis"
      );
    }

    return this.getCommits(limit, undefined, revisionRange);
  }

  async getCurrentBranchName(): Promise<string | undefined> {
    if (!this.repoDir) throw new Error("Repository not cloned yet");

    try {
      const { stdout } = await execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
        cwd: this.repoDir,
      });
      const branchName = stdout.trim();
      return branchName && branchName !== "HEAD" ? branchName : undefined;
    } catch (e) {
      logger.warn({ err: e }, "Failed to read current git branch name");
      return undefined;
    }
  }

  async getModifiedFiles(sha: string): Promise<string[]> {
    if (!this.repoDir) throw new Error("Repository not cloned yet");
    try {
      const { stdout } = await execFileAsync("git", ["show", "--name-only", "--format=", sha], {
        cwd: this.repoDir,
      });
      return stdout.trim().split("\n").filter(Boolean);
    } catch (e) {
      logger.warn({ sha, err: e }, "Failed to get modified files for commit");
      return [];
    }
  }

  async getDiff(sha: string): Promise<string> {
    if (!this.repoDir) throw new Error("Repository not cloned yet");

    return new Promise((resolve, reject) => {
      const child = spawn("git", ["show", "--format=", sha], { cwd: this.repoDir! });
      const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });

      let diffOutput = "";

      // We manually read from readline to prevent buffering huge outputs into memory at once
      // For this simple string return, we're still returning a string, but avoiding V8's execFile limits.
      rl.on("line", (line) => {
        diffOutput += line + "\n";
        // To fully prevent OOM we would stream this back, but returning string via spawn is safer than execFile
      });

      child.on("close", (code) => {
        if (code !== 0 && code !== 141) {
          logger.warn({ sha, code }, "Failed to get diff for commit");
          resolve("");
        } else {
          resolve(diffOutput);
        }
      });
      child.on("error", (e) => {
        logger.warn({ sha, err: e }, "Failed to get diff for commit");
        resolve("");
      });
    });
  }

  async cleanup(): Promise<void> {
    if (this.repoDir) {
      try {
        await fs.rm(this.repoDir, { recursive: true, force: true });
      } catch (e) {
        logger.error({ repoDir: this.repoDir, err: e }, "Failed to cleanup repo dir");
      }
    }
  }
}
