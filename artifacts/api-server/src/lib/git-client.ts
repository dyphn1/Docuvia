import { execFile } from "child_process";
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
    await execFileAsync("git", ["clone", "--depth=500", "--branch", branch, this.repoUrl, this.repoDir]);
  }

  async getCommits(limit = 100, since?: Date, revisionRange?: string): Promise<GitCommitData[]> {
    if (!this.repoDir) throw new Error("Repository not cloned yet");

    const args = [
      "log",
      `--max-count=${limit}`,
      "--format=COMMIT_SEP%n%H%n%s%n%an%n%aI%n%b",
    ];

    if (revisionRange) {
      args.push(revisionRange);
    }

    if (since) {
      args.push(`--since=${since.toISOString()}`);
    }

    const { stdout } = await execFileAsync("git", args, { cwd: this.repoDir });

    const commits: GitCommitData[] = [];
    const blocks = stdout.split("COMMIT_SEP\n").filter((b) => b.trim().length > 0);

    for (const block of blocks) {
      const lines = block.trim().split("\n");
      const sha = lines[0];
      const subject = lines[1];
      const author = lines[2];
      const date = lines[3];
      const body = lines.slice(4).join("\n");

      commits.push({
        sha,
        message: body ? `${subject}\n\n${body}` : subject,
        author,
        date,
      });
    }

    return commits;
  }

  async getProjectedCommits(limit = 100, baseRef = "origin/main"): Promise<GitCommitData[]> {
    if (!this.repoDir) throw new Error("Repository not cloned yet");

    let revisionRange: string | undefined;
    try {
      const { stdout } = await execFileAsync("git", ["merge-base", "HEAD", baseRef], { cwd: this.repoDir });
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
      const { stdout } = await execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: this.repoDir });
      const branchName = stdout.trim();
      return branchName && branchName !== "HEAD" ? branchName : undefined;
    } catch (e) {
      logger.warn({ err: e }, "Failed to read current git branch name");
      return undefined;
    }
  }

  async getDiff(sha: string): Promise<string> {
    if (!this.repoDir) throw new Error("Repository not cloned yet");
    
    try {
      const { stdout } = await execFileAsync("git", ["show", "--format=", sha], { cwd: this.repoDir });
      return stdout;
    } catch (e) {
      logger.warn({ sha, err: e }, "Failed to get diff for commit");
      return "";
    }
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
