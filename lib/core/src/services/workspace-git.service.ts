import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import { GitConstants } from "../constants/git.js";
import { ChangedFileEntry, IWorkspaceGitService } from "../interfaces/workspace-git.interfaces.js";

const execFileAsync = promisify(execFile);

/**
 * Dedicated, single-responsibility object for every local-workspace `git` shell-out.
 * Replaces what used to be independently duplicated `child_process.exec` calls in
 * InitService, FileDiscoveryService, and VcsScannerService. All methods use
 * `execFile` with argument arrays (no shell string interpolation).
 */
export class WorkspaceGitService implements IWorkspaceGitService {
  public async isGitRepository(cwd: string): Promise<boolean> {
    try {
      await execFileAsync("git", ["rev-parse", "--is-inside-work-tree"], { cwd });
      return true;
    } catch {
      return false;
    }
  }

  public async ensureKnowledgeBranch(
    cwd: string,
    branchName: string = GitConstants.KNOWLEDGE_ROOT
  ): Promise<{ created: boolean }> {
    try {
      const { stdout } = await execFileAsync("git", ["branch", "--list", branchName], { cwd });
      if (stdout.trim().length > 0) {
        return { created: false };
      }
    } catch {
      // git branch --list failing is unexpected but non-fatal; fall through and attempt creation
    }

    try {
      const { stdout: commitHash } = await execFileAsync(
        "git",
        [
          "commit-tree",
          GitConstants.EMPTY_TREE_SHA,
          "-m",
          GitConstants.KNOWLEDGE_BRANCH_COMMIT_MESSAGE,
        ],
        { cwd }
      );
      await execFileAsync("git", ["update-ref", `refs/heads/${branchName}`, commitHash.trim()], {
        cwd,
      });
      return { created: true };
    } catch (err: any) {
      throw new Error(`Failed to create branch: ${err.message}`);
    }
  }

  public async installPostCommitHook(cwd: string): Promise<{ installed: boolean }> {
    try {
      const gitHookDir = path.join(cwd, ...GitConstants.GIT_HOOKS_DIR);
      const postCommitPath = path.join(gitHookDir, GitConstants.POST_COMMIT_HOOK_FILENAME);

      let hookDirExists = false;
      try {
        await fs.access(gitHookDir);
        hookDirExists = true;
      } catch {}

      if (!hookDirExists) {
        return { installed: false };
      }

      let shouldWriteHook = true;
      try {
        const existingHook = await fs.readFile(postCommitPath, "utf8");
        if (existingHook.includes(GitConstants.POST_COMMIT_HOOK_MARKER)) {
          shouldWriteHook = false;
        }
      } catch {
        // File does not exist, safe to write
      }

      if (!shouldWriteHook) {
        return { installed: false };
      }

      await fs.appendFile(postCommitPath, GitConstants.POST_COMMIT_HOOK_CONTENT);
      await fs.chmod(postCommitPath, 0o755);
      return { installed: true };
    } catch {
      // Fail silently for hook installation (non-fatal to init)
      return { installed: false };
    }
  }

  public async listTrackedFilesWithBlobHash(cwd: string): Promise<Map<string, string>> {
    const blobHashes = new Map<string, string>();
    const { stdout } = await execFileAsync("git", ["ls-files", "-s"], { cwd });
    for (const line of stdout.split("\n")) {
      if (!line.trim()) continue;
      const [info, file] = line.split("\t");
      const blobSha = info.split(" ")[1];
      if (file && blobSha) blobHashes.set(file, blobSha);
    }
    return blobHashes;
  }

  public async listUntrackedFiles(cwd: string): Promise<string[]> {
    const { stdout } = await execFileAsync("git", ["ls-files", "--others", "--exclude-standard"], {
      cwd,
    });
    return stdout
      .split("\n")
      .map((f) => f.trim())
      .filter(Boolean);
  }

  public async listModifiedFiles(cwd: string): Promise<string[]> {
    const { stdout } = await execFileAsync("git", ["diff", "--name-only"], { cwd });
    return stdout
      .split("\n")
      .map((f) => f.trim())
      .filter(Boolean);
  }

  public async readBlobContent(cwd: string, sha: string): Promise<string> {
    const { stdout } = await execFileAsync("git", ["cat-file", "blob", sha], {
      cwd,
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout;
  }

  public async getRemoteUrl(cwd: string): Promise<string | undefined> {
    try {
      const { stdout } = await execFileAsync("git", ["remote", "get-url", "origin"], { cwd });
      const url = stdout.trim();
      return url.length > 0 ? url : undefined;
    } catch {
      return undefined;
    }
  }

  public async getRecentChangedFilePaths(cwd: string, maxCommits = 100): Promise<string[]> {
    try {
      const { stdout } = await execFileAsync(
        "git",
        ["log", "-n", String(maxCommits), "--name-only", "--format="],
        { cwd }
      );
      return stdout
        .split("\n")
        .map((f) => f.trim())
        .filter(Boolean);
    } catch {
      // No commits yet, or git unavailable; gracefully return no changed paths
      return [];
    }
  }

  public async hasUncommittedChanges(cwd: string): Promise<boolean> {
    const { stdout } = await execFileAsync("git", ["status", "--porcelain"], { cwd });
    return stdout.trim().length > 0;
  }

  /**
   * Files changed relative to `baseRef` (deliberately diffed straight against the working
   * tree, not `<baseRef>...HEAD`, so uncommitted edits are included) or, with no `baseRef`,
   * working-tree changes against HEAD merged with untracked files (which `git diff` never
   * reports). Parses git's `--name-status` letters into a stable status enum; for renames
   * (`R###\told\tnew`) the new path is used.
   */
  public async getChangedFilesSince(cwd: string, baseRef?: string): Promise<ChangedFileEntry[]> {
    const entries: ChangedFileEntry[] = [];
    const seen = new Set<string>();

    try {
      const { stdout } = await execFileAsync("git", ["diff", "--name-status", baseRef ?? "HEAD"], {
        cwd,
      });

      for (const line of stdout.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        const parts = trimmed.split("\t");
        const statusCode = parts[0] ?? "";
        let file: string | undefined;
        let status: ChangedFileEntry["status"];

        if (statusCode.startsWith("R")) {
          status = "renamed";
          file = parts[2] ?? parts[1];
        } else if (statusCode.startsWith("A")) {
          status = "added";
          file = parts[1];
        } else if (statusCode.startsWith("D")) {
          status = "deleted";
          file = parts[1];
        } else {
          status = "modified";
          file = parts[1];
        }

        if (file && !seen.has(file)) {
          seen.add(file);
          entries.push({ file, status });
        }
      }
    } catch {
      // No commits yet, baseRef doesn't exist, or git is unavailable; fall through so
      // untracked files (when no baseRef was given) can still be reported honestly.
    }

    if (!baseRef) {
      const untracked = await this.listUntrackedFiles(cwd);
      for (const file of untracked) {
        if (!seen.has(file)) {
          seen.add(file);
          entries.push({ file, status: "added" });
        }
      }
    }

    return entries;
  }

  /**
   * Files touched by a specific commit sha, run directly against the local workspace
   * (mirrors the command `LocalGitClient.getModifiedFiles()` uses against a cloned repo).
   */
  public async getFilesChangedByCommit(cwd: string, sha: string): Promise<string[]> {
    const { stdout } = await execFileAsync(
      "git",
      ["diff-tree", "--no-commit-id", "--name-only", "-r", sha],
      { cwd }
    );
    return stdout
      .split("\n")
      .map((f) => f.trim())
      .filter(Boolean);
  }
}
