import { execFile, type ExecFileOptions } from "child_process";
import { promisify } from "util";
import fs from "fs/promises";
import path from "path";
import {
  ChangedFileStatuses,
  DocuviaError,
  ErrorCodes,
  GIT_DEFAULT_REMOTE_NAME,
  UTF8_ENCODING,
  FS_FLAG_EXCLUSIVE_CREATE_WRITE,
  ERRNO_EEXIST,
  ERRNO_EPERM,
  ERRNO_EACCES,
  ERRNO_EBUSY,
  type ChangedFileEntry,
  type ChangedFileStatus,
  type DiffLineRange,
  type IGitProvider,
  type WorktreeEntry,
} from "@workspace/contracts";
import {
  buildFastImportData,
  collectDirectoryFiles,
  runFastImport,
} from "./fast-import.js";
import { DOCUVIA_GIT_IDENTITY } from "./constants/git-identity.js";
import { GIT_BRANCH_REF_PREFIX, GIT_HEAD_REF } from "./constants/git-refs.js";
import { GIT_BIN } from "./constants/git-cli.js";

const rawGitExecFileAsync = promisify(execFile);

/** Git's human-readable diagnostics (stderr especially, e.g. `fatal: couldn't find remote ref
 *  'docuvia-knowledge'`) are localized to the host's `LC_ALL`/`LANG`. Forcing a stable `C` locale
 *  here makes every git shell-out emit byte-identical output on every machine. Without it,
 *  `KnowledgeGitService.isRemoteRefMissingError`'s English substring match silently misses on
 *  non-English hosts (reproduced on a zh_TW macOS, where git reports
 *  `致命錯誤: 無法找到遠端引用` instead of `couldn't find remote ref`), and knowledge-branch
 *  reconciliation misclassifies a merely-missing remote ref as a network failure. */
const STABLE_GIT_LOCALE_ENV: Readonly<Record<string, string>> = {
  LC_ALL: "C",
  LANG: "C",
  LC_MESSAGES: "C",
};

const execFileAsync = (
  file: string,
  args: readonly string[],
  options: ExecFileOptions = {},
): Promise<{ stdout: string; stderr: string }> =>
  rawGitExecFileAsync(file, args, {
    ...options,
    encoding: "utf8",
    env: {
      ...process.env,
      ...(options.env ?? {}),
      ...STABLE_GIT_LOCALE_ENV,
    },
  });

/** Git subcommand names (the first positional argv element after `git`) this provider shells
 *  out to. */
const GIT_SUBCOMMAND = {
  REV_PARSE: "rev-parse",
  BRANCH: "branch",
  COMMIT_TREE: "commit-tree",
  UPDATE_REF: "update-ref",
  LS_FILES: "ls-files",
  LS_TREE: "ls-tree",
  DIFF: "diff",
  DIFF_TREE: "diff-tree",
  CAT_FILE: "cat-file",
  SHOW: "show",
  LOG: "log",
  REV_LIST: "rev-list",
  REMOTE: "remote",
  STATUS: "status",
  FETCH: "fetch",
  PUSH: "push",
  MERGE_BASE: "merge-base",
  WORKTREE: "worktree",
  /** `blame --porcelain` — per-line owning-commit attribution (see `getBlameLineOwners`). */
  BLAME: "blame",
} as const;

/** Git CLI flags/arguments (beyond the subcommand name itself) this provider shells out with. */
const GIT_ARG = {
  IS_INSIDE_WORK_TREE: "--is-inside-work-tree",
  LIST: "--list",
  /** `-D` — force-delete, regardless of merge status (see `deleteBranch`'s doc comment). */
  DELETE_FORCE: "-D",
  MESSAGE_FLAG: "-m",
  /** `ls-files -s` — list staged entries with their blob sha. */
  STAGED: "-s",
  OTHERS: "--others",
  EXCLUDE_STANDARD: "--exclude-standard",
  NAME_ONLY: "--name-only",
  BLOB: "blob",
  MAX_COUNT_FLAG: "-n",
  /** `%H` full sha, `%x01` field separator, `%B` raw body, `%x00` record separator — see
   *  `getCommitLog`'s comment on why these bytes were chosen. */
  LOG_FORMAT_SHA_AND_BODY: "--format=%H%x01%B%x00",
  GET_URL: "get-url",
  /** `--format=` with nothing after `=` — suppresses the commit line itself so `git log
   *  --name-only` output is purely the touched file paths. */
  EMPTY_FORMAT: "--format=",
  /** `worktree list` is a positional subcommand (`git worktree list --porcelain`), unlike
   *  `branch --list` which takes `--list` as a flag -- so it gets its own constant rather than
   *  reusing `GIT_ARG.LIST` (which would silently produce the invalid `git worktree --list`). */
  WORKTREE_LIST: "list",
  PORCELAIN: "--porcelain",
  NAME_STATUS: "--name-status",
  END_OF_OPTIONS: "--end-of-options",
  NO_COMMIT_ID: "--no-commit-id",
  RECURSIVE: "-r",
  VERIFY: "--verify",
  QUIET: "--quiet",
  IS_ANCESTOR: "--is-ancestor",
  /** Revision syntax suffix selecting a commit's tree object (`git rev-parse <rev>^{tree}`). */
  TREE_SUFFIX: "^{tree}",
  /** `show -s` — suppress the diff output, leaving only the requested `--format`. */
  SUPPRESS_DIFF: "-s",
  COMMIT_TIMESTAMP_FORMAT: "--format=%ct",
  PARENT_FLAG: "-p",
  /** `diff --unified=0` — hunk headers only, no context lines (see `getChangedLineRanges`). */
  UNIFIED_ZERO: "--unified=0",
  NO_COLOR: "--no-color",
  /** Bare `--` separating refs from a trailing pathspec. */
  PATHSPEC_SEPARATOR: "--",
  GIT_DIR_FLAG: "--git-dir",
  GIT_COMMON_DIR_FLAG: "--git-common-dir",
  /** `git rev-parse --git-path <path>` resolves a path under the *effective* git directory for
   *  this repo, honoring `core.hooksPath` when queried with `hooks` — unlike hardcoding
   *  `<git-common-dir>/hooks`, which silently ignores that config entirely (see
   *  `resolveHooksDir`'s doc comment for why this matters). */
  GIT_PATH_FLAG: "--git-path",
  /** `push --no-verify` — skips the local `pre-push` hook. `pushRef` is used by
   *  `KnowledgeGitService.pushQuietly` to push the `knowledge` branch from *inside* a hook
   *  invocation (`.husky/pre-push`'s Tier B batch runs `sync-knowledge`, which can call
   *  `pushRef`); without this flag that nested push re-triggers `.husky/pre-push`, which runs
   *  `sync-knowledge` again, which pushes again, recursing until the knowledge lock
   *  (`KNOWLEDGE_LOCK_FILE_NAME`) deadlocks against itself. */
  NO_VERIFY: "--no-verify",
} as const;

/** Line prefixes in `git worktree list --porcelain` output that `listWorktrees` parses —
 *  `worktree <path>` (always first in a record) and `branch refs/heads/<name>` (present only
 *  when the worktree has a checked-out branch, not a detached HEAD). */
const WORKTREE_PORCELAIN_PREFIX = {
  PATH: "worktree ",
  BRANCH: "branch ",
} as const;

/** Raw control-character separators `getCommitLog`'s `%x01`/`%x00` `--format` placeholders
 *  (see `GIT_ARG.LOG_FORMAT_SHA_AND_BODY`) actually print into the log output — effectively
 *  never appear in a real commit message, so parsing on them survives multi-line messages
 *  intact (unlike splitting the whole log on `\n`). */
const GIT_LOG_RECORD_SEPARATOR = "\x00" as const;
const GIT_LOG_FIELD_SEPARATOR = "\x01" as const;

/** `git diff --name-status`'s single-letter status codes this provider parses into
 *  `ChangedFileEntry["status"]` (see `getChangedFilesSince`). */
const GIT_DIFF_STATUS_CODE = {
  RENAMED: "R",
  ADDED: "A",
  DELETED: "D",
} as const;

/** The well-known empty-tree SHA — identical in every git repository. */
const EMPTY_TREE_SHA = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const GIT_DIR_NAME = ".git";
const GIT_HOOKS_DIR_NAME = "hooks";

/** husky v9's fixed, hardcoded `core.hooksPath` value's basename (`.husky/_`) — confirmed by
 *  reading `.husky/_/h`'s own dispatch logic: it re-derives the *user-editable* hook file as
 *  `dirname(dirname($0))/$(basename $0)`, i.e. one directory up from `_`, and silently no-ops
 *  (`exit 0`) if that file doesn't exist. `.husky/_/<hookName>` itself is husky-owned plumbing —
 *  writing there is invisible to husky's own dispatch and easily clobbered by husky's tooling.
 *  Found via dogfooding: Docuvia's own post-commit/pre-push hooks were silently never invoked by
 *  real `git commit`/`git push` on this repo (which uses husky) because nothing here ever
 *  consulted `core.hooksPath` at all (2026-07-21). */
const HUSKY_SHIM_DIR_NAME = "_";

const KNOWLEDGE_LOCK_FILE_NAME = "docuvia-knowledge.lock";
const KNOWLEDGE_LOCK_MAX_WAIT_MS = 10_000;
const KNOWLEDGE_LOCK_RETRY_INTERVAL_MS = 100;
const KNOWLEDGE_LOCK_STALE_MS = 60_000;

/** `fetchRef`/`pushRef` — the only two shell-outs in this provider that touch the network rather
 *  than the local repo — used to hardcode a 30s bound here (mirroring `GitDiagnosticRunner`'s
 *  `NETWORK_CHECK_TIMEOUT_MS` `err.killed`-on-timeout pattern) so a stalled remote failed fast
 *  instead of hanging the calling command indefinitely. Dropped 2026-07-23: real-world
 *  `sync-knowledge` pushes on Docuvia2 itself routinely exceed 60s (a real transfer of actual
 *  objects, not just ref names), so a fixed bound was cutting off healthy pushes, not just hung
 *  ones. `fetchRef`/`pushRef` now take an explicit optional `timeoutMs` (undefined = no `timeout`
 *  option passed to `execFileAsync` at all, i.e. wait for the transfer to finish, however long
 *  that takes); the caller (`KnowledgeGitService`, config-tunable via `docuviaMemory` /
 *  `DOCUVIA_PUSH_TIMEOUT_MS` — see `docuvia-api.ts`'s `syncKnowledge()`) opts back into a bound if
 *  it wants one. */

const TYPE_OBJECT = "object";
const ERR_PROP_CODE = "code";

/** Failure messages for each raw git shell-out this provider wraps, passed to `DocuviaError.wrap`
 *  as the user-facing/log context (see the class doc comment on why every failure is wrapped). */
const GIT_PROVIDER_ERROR_MESSAGES = {
  BRANCH_LIST_FAILED: "git branch --list failed",
  BRANCH_DELETE_FAILED: "git branch -D failed",
  COMMIT_TREE_FAILED: "git commit-tree failed",
  UPDATE_REF_FAILED: "git update-ref failed",
  HOOK_FILE_WRITE_FAILED: "Writing hook file failed",
  HOOK_FILE_CHMOD_FAILED: "chmod on hook file failed",
  LS_FILES_STAGED_FAILED: "git ls-files -s failed",
  LS_FILES_OTHERS_FAILED: "git ls-files --others failed",
  DIFF_NAME_ONLY_FAILED: "git diff --name-only failed",
  CAT_FILE_BLOB_FAILED: "git cat-file blob failed",
  STATUS_PORCELAIN_FAILED: "git status --porcelain failed",
  DIFF_TREE_FAILED: "git diff-tree failed",
  FAST_IMPORT_FAILED: "git fast-import failed",
  FETCH_FAILED: "git fetch failed",
  PUSH_FAILED: "git push failed",
  MERGE_BASE_IS_ANCESTOR_FAILED: "git merge-base --is-ancestor failed",
  REV_PARSE_TREE_FAILED: "git rev-parse ^{tree} failed",
  SHOW_COMMIT_TIMESTAMP_FAILED: "git show --format=%ct failed",
  COMMIT_TREE_MERGE_FAILED: "git commit-tree (merge) failed",
  KNOWLEDGE_LOCK_ACQUIRE_FAILED: "Failed to acquire knowledge lock",
  KNOWLEDGE_LOCK_TIMED_OUT: (lockPath: string) =>
    `Timed out waiting for the knowledge branch lock at ${lockPath} — another Docuvia process may be stuck`,
} as const;

/**
 * Raw Git technology provider — every method here is a thin, single git shell-out with no
 * Docuvia-specific semantics (see docs/gitbook/architecture/virtual-contracts-architecture.md's
 * Technology Provider section; the "knowledge branch"/"post-commit hook" domain logic built on
 * top of these primitives lives in `lib/core/git`). A Silent Worker — takes no `ILogger`
 * (docs/gitbook/architecture/logging-architecture.md) — and never leaks a native error; every
 * failure is caught and wrapped as `DocuviaError`. All shell-outs use `execFile` with argument
 * arrays (no shell string interpolation).
 */
export class GitLocalProvider implements IGitProvider {
  private async getGitDir(cwd: string): Promise<string> {
    try {
      const { stdout } = await execFileAsync(
        GIT_BIN,
        [GIT_SUBCOMMAND.REV_PARSE, GIT_ARG.GIT_DIR_FLAG],
        { cwd },
      );
      return path.resolve(cwd, stdout.trim());
    } catch {
      return path.join(cwd, GIT_DIR_NAME);
    }
  }

  private async getGitCommonDir(cwd: string): Promise<string> {
    try {
      const { stdout } = await execFileAsync(
        GIT_BIN,
        [GIT_SUBCOMMAND.REV_PARSE, GIT_ARG.GIT_COMMON_DIR_FLAG],
        { cwd },
      );
      return path.resolve(cwd, stdout.trim());
    } catch {
      return path.join(cwd, GIT_DIR_NAME);
    }
  }

  /**
   * Resolves the directory hook files actually belong in — via `git rev-parse --git-path hooks`,
   * which (unlike hardcoding `<git-common-dir>/hooks`) honors `core.hooksPath`. A repo managed by
   * husky (or any tool that repoints `core.hooksPath`) would otherwise have every hook Docuvia
   * installs silently ignored by real `git commit`/`git push`, with no error anywhere — exactly
   * what dogfooding found on this repo itself (2026-07-21). When the resolved directory is
   * husky's fixed `_` shim dir, redirects one level up to the sibling file husky's own shim
   * actually dispatches to (`HUSKY_SHIM_DIR_NAME`'s doc comment) — writing into `_` itself would
   * be invisible to husky's dispatch and liable to being clobbered by husky's own tooling.
   */
  public async resolveHooksDir(cwd: string): Promise<string> {
    let resolved: string;
    try {
      const { stdout } = await execFileAsync(
        GIT_BIN,
        [GIT_SUBCOMMAND.REV_PARSE, GIT_ARG.GIT_PATH_FLAG, GIT_HOOKS_DIR_NAME],
        { cwd },
      );
      resolved = path.resolve(cwd, stdout.trim());
    } catch {
      const commonDir = await this.getGitCommonDir(cwd);
      resolved = path.join(commonDir, GIT_HOOKS_DIR_NAME);
    }

    return path.basename(resolved) === HUSKY_SHIM_DIR_NAME
      ? path.dirname(resolved)
      : resolved;
  }

  public async isGitRepository(cwd: string): Promise<boolean> {
    try {
      await execFileAsync(
        GIT_BIN,
        [GIT_SUBCOMMAND.REV_PARSE, GIT_ARG.IS_INSIDE_WORK_TREE],
        { cwd },
      );
      return true;
    } catch {
      return false;
    }
  }

  public async branchExists(cwd: string, branchName: string): Promise<boolean> {
    try {
      const { stdout } = await execFileAsync(
        GIT_BIN,
        [GIT_SUBCOMMAND.BRANCH, GIT_ARG.LIST, branchName],
        { cwd },
      );
      return stdout.trim().length > 0;
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.GIT_COMMAND_FAILED,
        GIT_PROVIDER_ERROR_MESSAGES.BRANCH_LIST_FAILED,
        err,
      );
    }
  }

  public async deleteBranch(cwd: string, branchName: string): Promise<void> {
    try {
      await execFileAsync(
        GIT_BIN,
        [GIT_SUBCOMMAND.BRANCH, GIT_ARG.DELETE_FORCE, branchName],
        { cwd },
      );
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.GIT_COMMAND_FAILED,
        GIT_PROVIDER_ERROR_MESSAGES.BRANCH_DELETE_FAILED,
        err,
      );
    }
  }

  public async commitEmptyTree(cwd: string, message: string): Promise<string> {
    try {
      const { stdout } = await execFileAsync(
        GIT_BIN,
        [
          GIT_SUBCOMMAND.COMMIT_TREE,
          EMPTY_TREE_SHA,
          GIT_ARG.MESSAGE_FLAG,
          message,
        ],
        { cwd },
      );
      return stdout.trim();
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.GIT_BRANCH_CREATE_FAILED,
        GIT_PROVIDER_ERROR_MESSAGES.COMMIT_TREE_FAILED,
        err,
      );
    }
  }

  public async updateBranchRef(
    cwd: string,
    branchName: string,
    commitSha: string,
  ): Promise<void> {
    try {
      await execFileAsync(
        GIT_BIN,
        [
          GIT_SUBCOMMAND.UPDATE_REF,
          `${GIT_BRANCH_REF_PREFIX}${branchName}`,
          commitSha,
        ],
        { cwd },
      );
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.GIT_BRANCH_CREATE_FAILED,
        GIT_PROVIDER_ERROR_MESSAGES.UPDATE_REF_FAILED,
        err,
      );
    }
  }

  public async hooksDirExists(cwd: string): Promise<boolean> {
    try {
      const hooksDir = await this.resolveHooksDir(cwd);
      await fs.access(hooksDir);
      return true;
    } catch {
      return false;
    }
  }

  public async readHookFile(
    cwd: string,
    hookName: string,
  ): Promise<string | undefined> {
    try {
      const hooksDir = await this.resolveHooksDir(cwd);
      return await fs.readFile(path.join(hooksDir, hookName), UTF8_ENCODING);
    } catch {
      return undefined;
    }
  }

  public async appendHookFile(
    cwd: string,
    hookName: string,
    content: string,
  ): Promise<void> {
    try {
      const hooksDir = await this.resolveHooksDir(cwd);
      await fs.appendFile(path.join(hooksDir, hookName), content);
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.GIT_HOOK_INSTALL_FAILED,
        GIT_PROVIDER_ERROR_MESSAGES.HOOK_FILE_WRITE_FAILED,
        err,
      );
    }
  }

  public async writeHookFile(
    cwd: string,
    hookName: string,
    content: string,
  ): Promise<void> {
    try {
      const hooksDir = await this.resolveHooksDir(cwd);
      await fs.writeFile(path.join(hooksDir, hookName), content);
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.GIT_HOOK_INSTALL_FAILED,
        GIT_PROVIDER_ERROR_MESSAGES.HOOK_FILE_WRITE_FAILED,
        err,
      );
    }
  }

  public async makeHookExecutable(
    cwd: string,
    hookName: string,
  ): Promise<void> {
    try {
      const hooksDir = await this.resolveHooksDir(cwd);
      await fs.chmod(path.join(hooksDir, hookName), 0o755);
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.GIT_HOOK_INSTALL_FAILED,
        GIT_PROVIDER_ERROR_MESSAGES.HOOK_FILE_CHMOD_FAILED,
        err,
      );
    }
  }

  public async listTrackedFilesWithBlobHash(
    cwd: string,
  ): Promise<Map<string, string>> {
    const blobHashes = new Map<string, string>();
    try {
      const { stdout } = await execFileAsync(
        GIT_BIN,
        [GIT_SUBCOMMAND.LS_FILES, GIT_ARG.STAGED],
        { cwd, maxBuffer: 64 * 1024 * 1024 },
      );
      for (const line of stdout.split("\n")) {
        if (!line.trim()) continue;
        const [info, file] = line.split("\t");
        const blobSha = info.split(" ")[1];
        if (file && blobSha) blobHashes.set(file, blobSha);
      }
      return blobHashes;
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.GIT_COMMAND_FAILED,
        GIT_PROVIDER_ERROR_MESSAGES.LS_FILES_STAGED_FAILED,
        err,
      );
    }
  }

  public async listUntrackedFiles(cwd: string): Promise<string[]> {
    try {
      const { stdout } = await execFileAsync(
        GIT_BIN,
        [GIT_SUBCOMMAND.LS_FILES, GIT_ARG.OTHERS, GIT_ARG.EXCLUDE_STANDARD],
        { cwd, maxBuffer: 64 * 1024 * 1024 },
      );
      return stdout
        .split("\n")
        .map((f) => f.trim())
        .filter(Boolean);
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.GIT_COMMAND_FAILED,
        GIT_PROVIDER_ERROR_MESSAGES.LS_FILES_OTHERS_FAILED,
        err,
      );
    }
  }

  public async listModifiedFiles(cwd: string): Promise<string[]> {
    try {
      const { stdout } = await execFileAsync(
        GIT_BIN,
        [GIT_SUBCOMMAND.DIFF, GIT_ARG.NAME_ONLY],
        { cwd },
      );
      return stdout
        .split("\n")
        .map((f) => f.trim())
        .filter(Boolean);
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.GIT_COMMAND_FAILED,
        GIT_PROVIDER_ERROR_MESSAGES.DIFF_NAME_ONLY_FAILED,
        err,
      );
    }
  }

  public async readBlobContent(cwd: string, sha: string): Promise<string> {
    try {
      const { stdout } = await execFileAsync(
        GIT_BIN,
        [GIT_SUBCOMMAND.CAT_FILE, GIT_ARG.BLOB, sha],
        {
          cwd,
          maxBuffer: 10 * 1024 * 1024,
        },
      );
      return stdout;
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.GIT_COMMAND_FAILED,
        GIT_PROVIDER_ERROR_MESSAGES.CAT_FILE_BLOB_FAILED,
        err,
      );
    }
  }

  public async readFileAtRef(
    cwd: string,
    ref: string,
    filePath: string,
  ): Promise<string | undefined> {
    try {
      const posixPath = filePath.split(path.sep).join(path.posix.sep);
      const { stdout } = await execFileAsync(
        GIT_BIN,
        [GIT_SUBCOMMAND.SHOW, `${ref}:${posixPath}`],
        {
          cwd,
          maxBuffer: 64 * 1024 * 1024,
        },
      );
      return stdout;
    } catch {
      // Ref or path doesn't exist — a normal, expected outcome (e.g. hydrating a knowledge
      // branch that hasn't been snapshotted yet), not a fatal error.
      return undefined;
    }
  }

  public async listFilesAtRef(
    cwd: string,
    ref: string,
    dirPath: string,
  ): Promise<string[]> {
    try {
      // `git ls-tree <ref> -- <dirPath>` (no trailing slash) reports the directory's own tree
      // entry as a single line, not its contents — a trailing `/` on the pathspec is what makes
      // it list the directory's immediate children instead, which is the "list files in this
      // dir" behavior this method promises.
      const posixDirPath = dirPath.split(path.sep).join(path.posix.sep);
      const dirPathspec = posixDirPath.endsWith("/")
        ? posixDirPath
        : `${posixDirPath}/`;
      const { stdout } = await execFileAsync(
        GIT_BIN,
        [
          GIT_SUBCOMMAND.LS_TREE,
          GIT_ARG.NAME_ONLY,
          ref,
          GIT_ARG.PATHSPEC_SEPARATOR,
          dirPathspec,
        ],
        { cwd },
      );
      return stdout
        .split("\n")
        .map((f) => f.trim())
        .filter(Boolean);
    } catch {
      // Ref or dirPath doesn't exist — a normal, expected outcome (e.g. a knowledge branch with
      // no L3 cards packed yet), not a fatal error.
      return [];
    }
  }

  public async getCommitLog(
    cwd: string,
    ref: string,
    maxCount = 1000,
  ): Promise<Array<{ sha: string; message: string }>> {
    try {
      // See `GIT_LOG_RECORD_SEPARATOR`/`GIT_LOG_FIELD_SEPARATOR`'s doc comment on why the log is
      // parsed on these separators rather than split on `\n`.
      const { stdout } = await execFileAsync(
        GIT_BIN,
        [
          GIT_SUBCOMMAND.LOG,
          ref,
          GIT_ARG.MAX_COUNT_FLAG,
          String(maxCount),
          GIT_ARG.LOG_FORMAT_SHA_AND_BODY,
        ],
        { cwd, maxBuffer: 64 * 1024 * 1024 },
      );
      return stdout
        .split(GIT_LOG_RECORD_SEPARATOR)
        .map((record) => record.trim())
        .filter(Boolean)
        .map((record) => {
          const sepIndex = record.indexOf(GIT_LOG_FIELD_SEPARATOR);
          return {
            sha: record.slice(0, sepIndex),
            message: record.slice(sepIndex + 1),
          };
        });
    } catch {
      // Ref doesn't exist / no commits yet.
      return [];
    }
  }

  public async getCommitAncestry(
    cwd: string,
    ref: string,
    maxCount = 1000,
  ): Promise<string[]> {
    try {
      const { stdout } = await execFileAsync(
        GIT_BIN,
        [
          GIT_SUBCOMMAND.REV_LIST,
          ref,
          GIT_ARG.MAX_COUNT_FLAG,
          String(maxCount),
        ],
        { cwd },
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
      const { stdout } = await execFileAsync(
        GIT_BIN,
        [GIT_SUBCOMMAND.REMOTE, GIT_ARG.GET_URL, GIT_DEFAULT_REMOTE_NAME],
        { cwd },
      );
      const url = stdout.trim();
      return url.length > 0 ? url : undefined;
    } catch {
      return undefined;
    }
  }

  public async getRecentChangedFilePaths(
    cwd: string,
    maxCommits = 100,
  ): Promise<string[]> {
    try {
      const { stdout } = await execFileAsync(
        GIT_BIN,
        [
          GIT_SUBCOMMAND.LOG,
          GIT_ARG.MAX_COUNT_FLAG,
          String(maxCommits),
          GIT_ARG.NAME_ONLY,
          GIT_ARG.EMPTY_FORMAT,
        ],
        { cwd },
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
      const { stdout } = await execFileAsync(
        GIT_BIN,
        [GIT_SUBCOMMAND.STATUS, GIT_ARG.PORCELAIN],
        { cwd },
      );
      return stdout.trim().length > 0;
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.GIT_COMMAND_FAILED,
        GIT_PROVIDER_ERROR_MESSAGES.STATUS_PORCELAIN_FAILED,
        err,
      );
    }
  }

  /**
   * With no `toRef`: files changed relative to `baseRef` (deliberately diffed straight against
   * the working tree, not `<baseRef>...HEAD`, so uncommitted edits are included) or, with no
   * `baseRef` either, working-tree changes against HEAD merged with untracked files (which `git
   * diff` never reports) — the original, commit-to-working-tree semantics every pre-existing
   * caller relies on. With `toRef` also given: a strict two-ref diff (`git diff --name-status
   * <baseRef> <toRef>`), no working-tree/untracked merging — the commit-to-commit semantics
   * `analyze` auto mode's delta ingestion needs. Parses git's `--name-status` letters into a
   * stable status enum; for renames (`R###\told\tnew`) the new path is used, with `oldFile`
   * carrying the old one.
   */
  public async getChangedFilesSince(
    cwd: string,
    baseRef?: string,
    toRef?: string,
  ): Promise<ChangedFileEntry[]> {
    const entries: ChangedFileEntry[] = [];
    const seen = new Set<string>();

    try {
      // `--end-of-options` stops option parsing for the trailing ref argument(s) so a
      // caller-supplied ref beginning with `-` (e.g. `--upload-pack=...`) can't be parsed as a
      // flag — unlike a bare `--`, it does not reclassify the following argument as a pathspec,
      // so this preserves normal `git diff --name-status <ref> [<ref>]` semantics for legitimate
      // refs.
      const diffArgs = [
        GIT_SUBCOMMAND.DIFF,
        GIT_ARG.NAME_STATUS,
        GIT_ARG.END_OF_OPTIONS,
        baseRef ?? GIT_HEAD_REF,
        ...(toRef ? [toRef] : []),
      ];
      const { stdout } = await execFileAsync(GIT_BIN, diffArgs, { cwd });

      this.collectNameStatusEntries(stdout, entries, seen);
    } catch {
      // No commits yet, a ref doesn't exist, or git is unavailable; fall through so
      // untracked files (when no baseRef/toRef was given) can still be reported honestly.
    }

    if (!baseRef && !toRef) {
      await this.mergeUntrackedFiles(cwd, entries, seen);
    }

    return entries;
  }

  /** Parses `git diff --name-status` output lines into `entries`/`seen` — the line-parsing core
   *  of `getChangedFilesSince`. Mutates both in place to share the same dedup set as the
   *  untracked-files merge step. */
  private collectNameStatusEntries(
    stdout: string,
    entries: ChangedFileEntry[],
    seen: Set<string>,
  ): void {
    for (const line of stdout.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      const parts = trimmed.split("\t");
      const statusCode = parts[0] ?? "";
      const { file, status, oldFile } = this.parseNameStatusLine(
        statusCode,
        parts,
      );

      if (file && !seen.has(file)) {
        seen.add(file);
        entries.push(
          oldFile !== undefined ? { file, status, oldFile } : { file, status },
        );
      }
    }
  }

  /** Maps a single `git diff --name-status` line's status letter + tab-separated `parts` into a
   *  `ChangedFileEntry`'s file/status — see `getChangedFilesSince`'s doc comment on renames
   *  (`oldFile` carries the `old` half of an `R###\told\tnew` line, undefined otherwise). */
  private parseNameStatusLine(
    statusCode: string,
    parts: string[],
  ): {
    file: string | undefined;
    status: ChangedFileStatus;
    oldFile?: string;
  } {
    if (statusCode.startsWith(GIT_DIFF_STATUS_CODE.RENAMED)) {
      return {
        status: ChangedFileStatuses.RENAMED,
        file: parts[2] ?? parts[1],
        oldFile: parts[1],
      };
    }
    if (statusCode.startsWith(GIT_DIFF_STATUS_CODE.ADDED)) {
      return { status: ChangedFileStatuses.ADDED, file: parts[1] };
    }
    if (statusCode.startsWith(GIT_DIFF_STATUS_CODE.DELETED)) {
      return { status: ChangedFileStatuses.DELETED, file: parts[1] };
    }
    return { status: ChangedFileStatuses.MODIFIED, file: parts[1] };
  }

  /** `!baseRef` branch of `getChangedFilesSince` — folds in untracked files (which `git diff`
   *  never reports) as `ADDED`, deduped against the same `seen` set as the diff output. */
  private async mergeUntrackedFiles(
    cwd: string,
    entries: ChangedFileEntry[],
    seen: Set<string>,
  ): Promise<void> {
    const untracked = await this.listUntrackedFiles(cwd);
    for (const file of untracked) {
      if (!seen.has(file)) {
        seen.add(file);
        entries.push({ file, status: ChangedFileStatuses.ADDED });
      }
    }
  }

  /**
   * 0-indexed line ranges (tree-sitter convention) touched by `fromRef -> toRef`'s diff of a
   * single file, parsed from `git diff --unified=0`'s hunk headers (`@@ -oldStart,oldLines
   * +newStart,newLines @@`). Only the "new file" (`+`) side is used, since callers diff old vs.
   * new content by ref, not by patching. A hunk with `newLines === 0` (a pure deletion — nothing
   * added at this position in the new file) is represented as a zero-width anchor range at the
   * insertion point, so a deletion-only change still produces a locatable range rather than being
   * silently dropped.
   */
  public async getChangedLineRanges(
    cwd: string,
    fromRef: string,
    toRef: string,
    filePath: string,
  ): Promise<DiffLineRange[]> {
    const ranges: DiffLineRange[] = [];
    try {
      // See getChangedFilesSince()'s comment above on `--end-of-options` vs a bare `--`; here a
      // literal `--` is also needed regardless, to separate the two refs from the trailing
      // pathspec.
      const { stdout } = await execFileAsync(
        GIT_BIN,
        [
          GIT_SUBCOMMAND.DIFF,
          GIT_ARG.UNIFIED_ZERO,
          GIT_ARG.NO_COLOR,
          GIT_ARG.END_OF_OPTIONS,
          fromRef,
          toRef,
          GIT_ARG.PATHSPEC_SEPARATOR,
          filePath,
        ],
        { cwd },
      );

      const hunkHeader = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;
      for (const line of stdout.split("\n")) {
        const match = hunkHeader.exec(line);
        if (!match) continue;

        const newStart = Number(match[1]);
        const newLines = match[2] === undefined ? 1 : Number(match[2]);

        if (newLines === 0) {
          const anchor = Math.max(newStart - 1, 0);
          ranges.push({ startRow: anchor, endRow: anchor });
        } else {
          ranges.push({
            startRow: newStart - 1,
            endRow: newStart - 1 + newLines - 1,
          });
        }
      }
    } catch {
      // A ref/path that doesn't exist, or git being unavailable, just yields no ranges — callers
      // treat this as "nothing to classify for this file", never a fatal error.
    }
    return ranges;
  }

  /**
   * Files touched by a specific commit sha, run directly against the local workspace
   * (mirrors the command `LocalGitClient.getModifiedFiles()` uses against a cloned repo).
   */
  public async getFilesChangedByCommit(
    cwd: string,
    sha: string,
  ): Promise<string[]> {
    try {
      // See `getChangedFilesSince()`'s comment above on `--end-of-options` vs a bare `--`.
      const { stdout } = await execFileAsync(
        GIT_BIN,
        [
          GIT_SUBCOMMAND.DIFF_TREE,
          GIT_ARG.NO_COMMIT_ID,
          GIT_ARG.NAME_ONLY,
          GIT_ARG.RECURSIVE,
          GIT_ARG.END_OF_OPTIONS,
          sha,
        ],
        { cwd },
      );
      return stdout
        .split("\n")
        .map((f) => f.trim())
        .filter(Boolean);
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.GIT_COMMAND_FAILED,
        GIT_PROVIDER_ERROR_MESSAGES.DIFF_TREE_FAILED,
        err,
      );
    }
  }

  public async getHeadSha(cwd: string): Promise<string | undefined> {
    try {
      const { stdout } = await execFileAsync(
        GIT_BIN,
        [GIT_SUBCOMMAND.REV_PARSE, GIT_HEAD_REF],
        { cwd },
      );
      const sha = stdout.trim();
      return sha.length > 0 ? sha : undefined;
    } catch {
      // Unborn HEAD (no commits yet) or not a git repo — callers treat this as "no source commit
      // to stamp", not a fatal error.
      return undefined;
    }
  }

  /**
   * Issue #137: every live worktree of the repo `cwd` belongs to, including `cwd` itself —
   * parses `git worktree list --porcelain`'s blank-line-delimited records. A detached-HEAD
   * worktree has no `branch` line; a porcelain record always carries a `worktree <path>` line
   * first. Degrades to `[]` on a non-repo / pre-worktree git (mirrors `getHeadSha`'s
   * never-throws-for-environment posture) — but a git command that *ran* and failed is wrapped
   * as `DocuviaError`, never silently swallowed.
   */
  public async listWorktrees(cwd: string): Promise<WorktreeEntry[]> {
    let stdout: string;
    try {
      const result = await execFileAsync(
        GIT_BIN,
        [GIT_SUBCOMMAND.WORKTREE, GIT_ARG.WORKTREE_LIST, GIT_ARG.PORCELAIN],
        { cwd },
      );
      stdout = result.stdout;
    } catch {
      return [];
    }

    const entries: WorktreeEntry[] = [];
    for (const record of stdout.split("\n\n")) {
      const lines = record.split("\n").filter((l) => l.trim().length > 0);
      if (lines.length === 0) continue;
      const pathLine = lines.find((l) =>
        l.startsWith(WORKTREE_PORCELAIN_PREFIX.PATH),
      );
      if (!pathLine) continue;
      const branchLine = lines.find((l) =>
        l.startsWith(WORKTREE_PORCELAIN_PREFIX.BRANCH),
      );
      entries.push({
        path: pathLine.slice(WORKTREE_PORCELAIN_PREFIX.PATH.length),
        branch: branchLine
          ? branchLine
              .slice(WORKTREE_PORCELAIN_PREFIX.BRANCH.length)
              .replace(GIT_BRANCH_REF_PREFIX, "")
          : undefined,
      });
    }
    return entries;
  }

  public async getBranchTipSha(
    cwd: string,
    branchName: string,
  ): Promise<string | undefined> {
    try {
      const { stdout } = await execFileAsync(
        GIT_BIN,
        [
          GIT_SUBCOMMAND.REV_PARSE,
          GIT_ARG.VERIFY,
          GIT_ARG.QUIET,
          `${GIT_BRANCH_REF_PREFIX}${branchName}`,
        ],
        { cwd },
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
    commitMessage: string,
    timestamp?: number,
    /** When true (internal operations like snapshot), allows sourceDir outside workspace root. */
    allowOutsideWorkspace = false,
  ): Promise<void> {
    try {
      const files = await collectDirectoryFiles(
        sourceDir,
        allowOutsideWorkspace ? undefined : cwd,
      );
      const now =
        timestamp !== undefined ? timestamp : Math.floor(Date.now() / 1000);
      const parentCommitSha = await this.getBranchTipSha(cwd, branchName);
      const fastImportData = buildFastImportData(
        branchName,
        files,
        now,
        commitMessage,
        parentCommitSha,
      );
      await runFastImport(cwd, fastImportData);
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.GIT_FAST_IMPORT_FAILED,
        GIT_PROVIDER_ERROR_MESSAGES.FAST_IMPORT_FAILED,
        err,
      );
    }
  }

  public async fetchRef(
    cwd: string,
    remote: string,
    ref: string,
    timeoutMs?: number,
  ): Promise<void> {
    try {
      await execFileAsync(GIT_BIN, [GIT_SUBCOMMAND.FETCH, remote, ref], {
        cwd,
        ...(timeoutMs !== undefined ? { timeout: timeoutMs } : {}),
      });
    } catch (err) {
      throw this.wrapNetworkOperationError(
        err,
        GIT_PROVIDER_ERROR_MESSAGES.FETCH_FAILED,
      );
    }
  }

  public async pushRef(
    cwd: string,
    remote: string,
    branchName: string,
    timeoutMs?: number,
  ): Promise<void> {
    try {
      const branchRef = `${GIT_BRANCH_REF_PREFIX}${branchName}`;
      await execFileAsync(
        GIT_BIN,
        [
          GIT_SUBCOMMAND.PUSH,
          GIT_ARG.NO_VERIFY,
          remote,
          `${branchRef}:${branchRef}`,
        ],
        {
          cwd,
          ...(timeoutMs !== undefined ? { timeout: timeoutMs } : {}),
        },
      );
    } catch (err) {
      throw this.wrapNetworkOperationError(
        err,
        GIT_PROVIDER_ERROR_MESSAGES.PUSH_FAILED,
      );
    }
  }

  /** Shared classification for `fetchRef`/`pushRef` failures: `execFileAsync`'s `timeout` option
   *  reports a killed-on-timeout child process via `err.killed` (mirrors `GitDiagnosticRunner`'s
   *  identical `err.killed` check) -- surfaced as `ErrorCodes.GIT_NETWORK_TIMEOUT` so callers
   *  (`KnowledgeGitService.tryFetchRemoteBranch`/`pushQuietly`, `doctor`'s reachability
   *  diagnostic) can tell "the network hung" apart from any other git failure. */
  private wrapNetworkOperationError(
    err: unknown,
    message: string,
  ): DocuviaError {
    const code =
      typeof err === TYPE_OBJECT &&
      err !== null &&
      (err as { killed?: boolean }).killed
        ? ErrorCodes.GIT_NETWORK_TIMEOUT
        : ErrorCodes.GIT_COMMAND_FAILED;
    return DocuviaError.wrap(code, message, err);
  }

  public async getRefSha(
    cwd: string,
    ref: string,
  ): Promise<string | undefined> {
    try {
      const { stdout } = await execFileAsync(
        GIT_BIN,
        [GIT_SUBCOMMAND.REV_PARSE, GIT_ARG.VERIFY, GIT_ARG.QUIET, ref],
        {
          cwd,
        },
      );
      const sha = stdout.trim();
      return sha.length > 0 ? sha : undefined;
    } catch {
      return undefined;
    }
  }

  public async isAncestor(
    cwd: string,
    ancestorSha: string,
    descendantSha: string,
  ): Promise<boolean> {
    try {
      await execFileAsync(
        GIT_BIN,
        [
          GIT_SUBCOMMAND.MERGE_BASE,
          GIT_ARG.IS_ANCESTOR,
          ancestorSha,
          descendantSha,
        ],
        {
          cwd,
        },
      );
      return true;
    } catch (err) {
      // Exit code 1 means "not an ancestor" — a normal, expected outcome, not a failure. Any
      // other exit code (invalid sha, unrelated histories git can't even compare) is a real error.
      if (
        err &&
        typeof err === TYPE_OBJECT &&
        ERR_PROP_CODE in (err as Record<string, unknown>) &&
        (err as { [ERR_PROP_CODE]: unknown })[ERR_PROP_CODE] === 1
      ) {
        return false;
      }
      throw DocuviaError.wrap(
        ErrorCodes.GIT_COMMAND_FAILED,
        GIT_PROVIDER_ERROR_MESSAGES.MERGE_BASE_IS_ANCESTOR_FAILED,
        err,
      );
    }
  }

  public async getTreeSha(cwd: string, commitish: string): Promise<string> {
    try {
      const { stdout } = await execFileAsync(
        GIT_BIN,
        [GIT_SUBCOMMAND.REV_PARSE, `${commitish}${GIT_ARG.TREE_SUFFIX}`],
        { cwd },
      );
      return stdout.trim();
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.GIT_COMMAND_FAILED,
        GIT_PROVIDER_ERROR_MESSAGES.REV_PARSE_TREE_FAILED,
        err,
      );
    }
  }

  public async getCommitTimestamp(cwd: string, sha: string): Promise<number> {
    try {
      const { stdout } = await execFileAsync(
        GIT_BIN,
        [
          GIT_SUBCOMMAND.SHOW,
          GIT_ARG.SUPPRESS_DIFF,
          GIT_ARG.COMMIT_TIMESTAMP_FORMAT,
          sha,
        ],
        { cwd },
      );
      return Number(stdout.trim());
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.GIT_COMMAND_FAILED,
        GIT_PROVIDER_ERROR_MESSAGES.SHOW_COMMIT_TIMESTAMP_FAILED,
        err,
      );
    }
  }

  public async createMergeCommit(
    cwd: string,
    treeSha: string,
    parentShas: string[],
    message: string,
  ): Promise<string> {
    try {
      const parentArgs = parentShas.flatMap((sha) => [
        GIT_ARG.PARENT_FLAG,
        sha,
      ]);
      const { stdout } = await execFileAsync(
        GIT_BIN,
        [
          GIT_SUBCOMMAND.COMMIT_TREE,
          treeSha,
          ...parentArgs,
          GIT_ARG.MESSAGE_FLAG,
          message,
        ],
        {
          cwd,
          env: {
            ...process.env,
            GIT_AUTHOR_NAME: DOCUVIA_GIT_IDENTITY.NAME,
            GIT_AUTHOR_EMAIL: DOCUVIA_GIT_IDENTITY.EMAIL,
            GIT_COMMITTER_NAME: DOCUVIA_GIT_IDENTITY.NAME,
            GIT_COMMITTER_EMAIL: DOCUVIA_GIT_IDENTITY.EMAIL,
          },
        },
      );
      return stdout.trim();
    } catch (err) {
      throw DocuviaError.wrap(
        ErrorCodes.GIT_COMMAND_FAILED,
        GIT_PROVIDER_ERROR_MESSAGES.COMMIT_TREE_MERGE_FAILED,
        err,
      );
    }
  }

  public async acquireKnowledgeLock(cwd: string): Promise<void> {
    const gitDir = await this.getGitDir(cwd);
    const lockPath = path.join(gitDir, KNOWLEDGE_LOCK_FILE_NAME);
    const deadline = Date.now() + KNOWLEDGE_LOCK_MAX_WAIT_MS;

    for (;;) {
      try {
        const handle = await fs.open(lockPath, FS_FLAG_EXCLUSIVE_CREATE_WRITE);
        await handle.close();
        return;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (
          code !== ERRNO_EEXIST &&
          code !== ERRNO_EPERM &&
          code !== ERRNO_EACCES &&
          code !== ERRNO_EBUSY
        ) {
          throw DocuviaError.wrap(
            ErrorCodes.GIT_COMMAND_FAILED,
            GIT_PROVIDER_ERROR_MESSAGES.KNOWLEDGE_LOCK_ACQUIRE_FAILED,
            err,
          );
        }

        const stat = await fs.stat(lockPath).catch(() => undefined);
        if (stat && Date.now() - stat.mtimeMs > KNOWLEDGE_LOCK_STALE_MS) {
          await fs.rm(lockPath, { force: true });
          continue;
        }

        if (Date.now() > deadline) {
          throw new DocuviaError(
            ErrorCodes.GIT_COMMAND_FAILED,
            GIT_PROVIDER_ERROR_MESSAGES.KNOWLEDGE_LOCK_TIMED_OUT(lockPath),
          );
        }
        await new Promise((resolve) =>
          setTimeout(resolve, KNOWLEDGE_LOCK_RETRY_INTERVAL_MS),
        );
      }
    }
  }

  public async releaseKnowledgeLock(cwd: string): Promise<void> {
    const gitDir = await this.getGitDir(cwd);
    const lockPath = path.join(gitDir, KNOWLEDGE_LOCK_FILE_NAME);
    await fs.rm(lockPath, { force: true });
  }

  public async getBlameLineOwners(
    cwd: string,
    filePath: string,
  ): Promise<Map<number, string>> {
    const owners = new Map<number, string>();
    try {
      // `--porcelain` (machine-readable, stable across git versions and locales; LC_ALL=C is
      // pinned by execFileAsync anyway) over `-l`: the long form is for humans. Each line entry
      // reads `<sha> <origLine> <finalLine>[ <count>]`; a count N means this sha owns final
      // lines finalLine..finalLine+N-1.
      const { stdout } = await execFileAsync(
        GIT_BIN,
        [
          GIT_SUBCOMMAND.BLAME,
          GIT_ARG.PORCELAIN,
          GIT_ARG.PATHSPEC_SEPARATOR,
          filePath,
        ],
        { cwd },
      );

      // Optional `^` prefix marks a boundary commit (blame's history walk limit) -- still a
      // real owning commit, so strip it rather than dropping those lines as unknown.
      const entryRe = /^\^?([0-9a-f]{40}) (\d+) (\d+)(?: (\d+))?$/;
      for (const line of stdout.split("\n")) {
        const match = entryRe.exec(line);
        if (!match) continue;
        const sha = match[1];
        const firstFinalLine = Number(match[3]);
        const count = match[4] === undefined ? 1 : Number(match[4]);
        if (!owners.has(firstFinalLine)) {
          owners.set(firstFinalLine, sha);
        }
        for (let l = firstFinalLine + 1; l < firstFinalLine + count; l++) {
          if (!owners.has(l)) owners.set(l, sha);
        }
      }
    } catch {
      // A nonexistent file/path or unavailable git yields no ownership data — callers treat
      // that as "unknown", never a fatal error (mirrors getChangedLineRanges' contract).
    }
    return owners;
  }
}
