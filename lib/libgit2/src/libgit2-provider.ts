import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import { DocuviaError, ErrorCodes, type ChangedFileEntry, type IGitProvider } from "@workspace/contracts";

const execFileAsync = promisify(execFile);

/** The well-known empty-tree SHA — identical in every git repository. */
const EMPTY_TREE_SHA = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const GIT_HOOKS_DIR = [".git", "hooks"] as const;

/**
 * Raw Git technology provider — every method here is a thin, single git shell-out with no
 * Docuvia-specific semantics (see docs/gitbook/architecture/virtual-contracts-architecture.md's
 * Technology Provider section; the "knowledge branch"/"post-commit hook" domain logic built on
 * top of these primitives lives in `lib/core/git`). A Silent Worker — takes no `ILogger`
 * (docs/gitbook/architecture/logging-architecture.md) — and never leaks a native error; every
 * failure is caught and wrapped as `DocuviaError`. All shell-outs use `execFile` with argument
 * arrays (no shell string interpolation).
 */
export class Libgit2Provider implements IGitProvider {
  public async isGitRepository(cwd: string): Promise<boolean> {
    try {
      await execFileAsync("git", ["rev-parse", "--is-inside-work-tree"], { cwd });
      return true;
    } catch {
      return false;
    }
  }

  public async branchExists(cwd: string, branchName: string): Promise<boolean> {
    try {
      const { stdout } = await execFileAsync("git", ["branch", "--list", branchName], { cwd });
      return stdout.trim().length > 0;
    } catch (err) {
      throw DocuviaError.wrap(ErrorCodes.GIT_COMMAND_FAILED, "git branch --list failed", err);
    }
  }

  public async commitEmptyTree(cwd: string, message: string): Promise<string> {
    try {
      const { stdout } = await execFileAsync(
        "git",
        ["commit-tree", EMPTY_TREE_SHA, "-m", message],
        { cwd }
      );
      return stdout.trim();
    } catch (err) {
      throw DocuviaError.wrap(ErrorCodes.GIT_BRANCH_CREATE_FAILED, "git commit-tree failed", err);
    }
  }

  public async updateBranchRef(cwd: string, branchName: string, commitSha: string): Promise<void> {
    try {
      await execFileAsync("git", ["update-ref", `refs/heads/${branchName}`, commitSha], { cwd });
    } catch (err) {
      throw DocuviaError.wrap(ErrorCodes.GIT_BRANCH_CREATE_FAILED, "git update-ref failed", err);
    }
  }

  public async hooksDirExists(cwd: string): Promise<boolean> {
    try {
      await fs.access(path.join(cwd, ...GIT_HOOKS_DIR));
      return true;
    } catch {
      return false;
    }
  }

  public async readHookFile(cwd: string, hookName: string): Promise<string | undefined> {
    try {
      return await fs.readFile(path.join(cwd, ...GIT_HOOKS_DIR, hookName), "utf8");
    } catch {
      return undefined;
    }
  }

  public async appendHookFile(cwd: string, hookName: string, content: string): Promise<void> {
    try {
      await fs.appendFile(path.join(cwd, ...GIT_HOOKS_DIR, hookName), content);
    } catch (err) {
      throw DocuviaError.wrap(ErrorCodes.GIT_HOOK_INSTALL_FAILED, "Writing hook file failed", err);
    }
  }

  public async makeHookExecutable(cwd: string, hookName: string): Promise<void> {
    try {
      await fs.chmod(path.join(cwd, ...GIT_HOOKS_DIR, hookName), 0o755);
    } catch (err) {
      throw DocuviaError.wrap(ErrorCodes.GIT_HOOK_INSTALL_FAILED, "chmod on hook file failed", err);
    }
  }

  public async listTrackedFilesWithBlobHash(cwd: string): Promise<Map<string, string>> {
    const blobHashes = new Map<string, string>();
    try {
      const { stdout } = await execFileAsync("git", ["ls-files", "-s"], { cwd });
      for (const line of stdout.split("\n")) {
        if (!line.trim()) continue;
        const [info, file] = line.split("\t");
        const blobSha = info.split(" ")[1];
        if (file && blobSha) blobHashes.set(file, blobSha);
      }
      return blobHashes;
    } catch (err) {
      throw DocuviaError.wrap(ErrorCodes.GIT_COMMAND_FAILED, "git ls-files -s failed", err);
    }
  }

  public async listUntrackedFiles(cwd: string): Promise<string[]> {
    try {
      const { stdout } = await execFileAsync(
        "git",
        ["ls-files", "--others", "--exclude-standard"],
        { cwd }
      );
      return stdout
        .split("\n")
        .map((f) => f.trim())
        .filter(Boolean);
    } catch (err) {
      throw DocuviaError.wrap(ErrorCodes.GIT_COMMAND_FAILED, "git ls-files --others failed", err);
    }
  }

  public async listModifiedFiles(cwd: string): Promise<string[]> {
    try {
      const { stdout } = await execFileAsync("git", ["diff", "--name-only"], { cwd });
      return stdout
        .split("\n")
        .map((f) => f.trim())
        .filter(Boolean);
    } catch (err) {
      throw DocuviaError.wrap(ErrorCodes.GIT_COMMAND_FAILED, "git diff --name-only failed", err);
    }
  }

  public async readBlobContent(cwd: string, sha: string): Promise<string> {
    try {
      const { stdout } = await execFileAsync("git", ["cat-file", "blob", sha], {
        cwd,
        maxBuffer: 10 * 1024 * 1024,
      });
      return stdout;
    } catch (err) {
      throw DocuviaError.wrap(ErrorCodes.GIT_COMMAND_FAILED, "git cat-file blob failed", err);
    }
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
    try {
      const { stdout } = await execFileAsync("git", ["status", "--porcelain"], { cwd });
      return stdout.trim().length > 0;
    } catch (err) {
      throw DocuviaError.wrap(ErrorCodes.GIT_COMMAND_FAILED, "git status --porcelain failed", err);
    }
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
    try {
      const { stdout } = await execFileAsync(
        "git",
        ["diff-tree", "--no-commit-id", "--name-only", "-r", sha],
        { cwd }
      );
      return stdout
        .split("\n")
        .map((f) => f.trim())
        .filter(Boolean);
    } catch (err) {
      throw DocuviaError.wrap(ErrorCodes.GIT_COMMAND_FAILED, "git diff-tree failed", err);
    }
  }
}
