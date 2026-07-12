import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import { DocuviaError, ErrorCodes, type ChangedFileEntry, type IGitProvider } from "@workspace/contracts";
import { buildFastImportData, collectDirectoryFiles, runFastImport } from "./fast-import.js";

const execFileAsync = promisify(execFile);

/** The well-known empty-tree SHA — identical in every git repository. */
const EMPTY_TREE_SHA = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const GIT_DIR_NAME = ".git";
const GIT_HOOKS_DIR = [GIT_DIR_NAME, "hooks"] as const;

const KNOWLEDGE_LOCK_FILE_NAME = "docuvia-knowledge.lock";
const KNOWLEDGE_LOCK_MAX_WAIT_MS = 10_000;
const KNOWLEDGE_LOCK_RETRY_INTERVAL_MS = 100;
const KNOWLEDGE_LOCK_STALE_MS = 60_000;

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

  public async readFileAtRef(cwd: string, ref: string, filePath: string): Promise<string | undefined> {
    try {
      const posixPath = filePath.split(path.sep).join(path.posix.sep);
      const { stdout } = await execFileAsync("git", ["show", `${ref}:${posixPath}`], {
        cwd,
        maxBuffer: 64 * 1024 * 1024,
      });
      return stdout;
    } catch {
      // Ref or path doesn't exist — a normal, expected outcome (e.g. hydrating a knowledge
      // branch that hasn't been snapshotted yet), not a fatal error.
      return undefined;
    }
  }

  public async getCommitLog(
    cwd: string,
    ref: string,
    maxCount = 1000
  ): Promise<Array<{ sha: string; message: string }>> {
    try {
      // `%x01` separates sha/body within a record, `%x00` separates records — both effectively
      // never appear in a real commit message, so this survives multi-line messages intact
      // (unlike splitting the whole log on `\n`).
      const { stdout } = await execFileAsync(
        "git",
        ["log", ref, "-n", String(maxCount), "--format=%H%x01%B%x00"],
        { cwd, maxBuffer: 64 * 1024 * 1024 }
      );
      return stdout
        .split("\x00")
        .map((record) => record.trim())
        .filter(Boolean)
        .map((record) => {
          const sepIndex = record.indexOf("\x01");
          return { sha: record.slice(0, sepIndex), message: record.slice(sepIndex + 1) };
        });
    } catch {
      // Ref doesn't exist / no commits yet.
      return [];
    }
  }

  public async getCommitAncestry(cwd: string, ref: string, maxCount = 1000): Promise<string[]> {
    try {
      const { stdout } = await execFileAsync(
        "git",
        ["rev-list", ref, "-n", String(maxCount)],
        { cwd }
      );
      return stdout
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
    } catch {
      return [];
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
      // `--end-of-options` stops option parsing for the trailing `baseRef` argument so a
      // caller-supplied ref beginning with `-` (e.g. `--upload-pack=...`) can't be parsed as a
      // flag — unlike a bare `--`, it does not reclassify the following argument as a pathspec,
      // so this preserves normal `git diff --name-status <ref>` semantics for legitimate refs.
      const { stdout } = await execFileAsync(
        "git",
        ["diff", "--name-status", "--end-of-options", baseRef ?? "HEAD"],
        { cwd }
      );

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
      // See `getChangedFilesSince()`'s comment above on `--end-of-options` vs a bare `--`.
      const { stdout } = await execFileAsync(
        "git",
        ["diff-tree", "--no-commit-id", "--name-only", "-r", "--end-of-options", sha],
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

  public async getHeadSha(cwd: string): Promise<string | undefined> {
    try {
      const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd });
      const sha = stdout.trim();
      return sha.length > 0 ? sha : undefined;
    } catch {
      // Unborn HEAD (no commits yet) or not a git repo — callers treat this as "no source commit
      // to stamp", not a fatal error.
      return undefined;
    }
  }

  public async getBranchTipSha(cwd: string, branchName: string): Promise<string | undefined> {
    try {
      const { stdout } = await execFileAsync(
        "git",
        ["rev-parse", "--verify", "--quiet", `refs/heads/${branchName}`],
        { cwd }
      );
      const sha = stdout.trim();
      return sha.length > 0 ? sha : undefined;
    } catch {
      return undefined;
    }
  }

  public async packDirectoryToBranch(
    cwd: string,
    sourceDir: string,
    branchName: string,
    commitMessage: string
  ): Promise<void> {
    try {
      const files = await collectDirectoryFiles(sourceDir);
      const now = Math.floor(Date.now() / 1000);
      const parentCommitSha = await this.getBranchTipSha(cwd, branchName);
      const fastImportData = buildFastImportData(
        branchName,
        files,
        now,
        commitMessage,
        parentCommitSha
      );
      await runFastImport(cwd, fastImportData);
    } catch (err) {
      throw DocuviaError.wrap(ErrorCodes.GIT_FAST_IMPORT_FAILED, "git fast-import failed", err);
    }
  }

  public async fetchRef(cwd: string, remote: string, ref: string): Promise<void> {
    try {
      await execFileAsync("git", ["fetch", remote, ref], { cwd });
    } catch (err) {
      throw DocuviaError.wrap(ErrorCodes.GIT_COMMAND_FAILED, "git fetch failed", err);
    }
  }

  public async pushRef(cwd: string, remote: string, branchName: string): Promise<void> {
    try {
      await execFileAsync(
        "git",
        ["push", remote, `refs/heads/${branchName}:refs/heads/${branchName}`],
        { cwd }
      );
    } catch (err) {
      throw DocuviaError.wrap(ErrorCodes.GIT_COMMAND_FAILED, "git push failed", err);
    }
  }

  public async getRefSha(cwd: string, ref: string): Promise<string | undefined> {
    try {
      const { stdout } = await execFileAsync("git", ["rev-parse", "--verify", "--quiet", ref], {
        cwd,
      });
      const sha = stdout.trim();
      return sha.length > 0 ? sha : undefined;
    } catch {
      return undefined;
    }
  }

  public async isAncestor(cwd: string, ancestorSha: string, descendantSha: string): Promise<boolean> {
    try {
      await execFileAsync("git", ["merge-base", "--is-ancestor", ancestorSha, descendantSha], {
        cwd,
      });
      return true;
    } catch (err) {
      // Exit code 1 means "not an ancestor" — a normal, expected outcome, not a failure. Any
      // other exit code (invalid sha, unrelated histories git can't even compare) is a real error.
      if (typeof err === "object" && err !== null && "code" in err && (err as { code: unknown }).code === 1) {
        return false;
      }
      throw DocuviaError.wrap(ErrorCodes.GIT_COMMAND_FAILED, "git merge-base --is-ancestor failed", err);
    }
  }

  public async getTreeSha(cwd: string, commitish: string): Promise<string> {
    try {
      const { stdout } = await execFileAsync("git", ["rev-parse", `${commitish}^{tree}`], { cwd });
      return stdout.trim();
    } catch (err) {
      throw DocuviaError.wrap(ErrorCodes.GIT_COMMAND_FAILED, "git rev-parse ^{tree} failed", err);
    }
  }

  public async getCommitTimestamp(cwd: string, sha: string): Promise<number> {
    try {
      const { stdout } = await execFileAsync("git", ["show", "-s", "--format=%ct", sha], { cwd });
      return Number(stdout.trim());
    } catch (err) {
      throw DocuviaError.wrap(ErrorCodes.GIT_COMMAND_FAILED, "git show --format=%ct failed", err);
    }
  }

  public async createMergeCommit(
    cwd: string,
    treeSha: string,
    parentShas: string[],
    message: string
  ): Promise<string> {
    try {
      const parentArgs = parentShas.flatMap((sha) => ["-p", sha]);
      const { stdout } = await execFileAsync(
        "git",
        ["commit-tree", treeSha, ...parentArgs, "-m", message],
        {
          cwd,
          env: {
            ...process.env,
            GIT_AUTHOR_NAME: "Docuvia",
            GIT_AUTHOR_EMAIL: "docuvia@localhost",
            GIT_COMMITTER_NAME: "Docuvia",
            GIT_COMMITTER_EMAIL: "docuvia@localhost",
          },
        }
      );
      return stdout.trim();
    } catch (err) {
      throw DocuviaError.wrap(ErrorCodes.GIT_COMMAND_FAILED, "git commit-tree (merge) failed", err);
    }
  }

  public async acquireKnowledgeLock(cwd: string): Promise<void> {
    const lockPath = path.join(cwd, GIT_DIR_NAME, KNOWLEDGE_LOCK_FILE_NAME);
    const deadline = Date.now() + KNOWLEDGE_LOCK_MAX_WAIT_MS;

    for (;;) {
      try {
        const handle = await fs.open(lockPath, "wx");
        await handle.close();
        return;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") {
          throw DocuviaError.wrap(ErrorCodes.GIT_COMMAND_FAILED, "Failed to acquire knowledge lock", err);
        }

        const stat = await fs.stat(lockPath).catch(() => undefined);
        if (stat && Date.now() - stat.mtimeMs > KNOWLEDGE_LOCK_STALE_MS) {
          await fs.rm(lockPath, { force: true });
          continue;
        }

        if (Date.now() > deadline) {
          throw new DocuviaError(
            ErrorCodes.GIT_COMMAND_FAILED,
            `Timed out waiting for the knowledge branch lock at ${lockPath} — another Docuvia process may be stuck`
          );
        }
        await new Promise((resolve) => setTimeout(resolve, KNOWLEDGE_LOCK_RETRY_INTERVAL_MS));
      }
    }
  }

  public async releaseKnowledgeLock(cwd: string): Promise<void> {
    const lockPath = path.join(cwd, GIT_DIR_NAME, KNOWLEDGE_LOCK_FILE_NAME);
    await fs.rm(lockPath, { force: true });
  }
}
