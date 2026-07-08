import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import { GitConstants } from "../constants/git.js";
import { IWorkspaceGitService } from "../interfaces/workspace-git.interfaces.js";

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
}
