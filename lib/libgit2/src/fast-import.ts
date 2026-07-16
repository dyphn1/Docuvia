import { spawn } from "node:child_process";
import fs from "fs/promises";
import path from "path";
import os from "os";
import pLimit from "p-limit";
import { UTF8_ENCODING } from "@workspace/contracts";
import { DOCUVIA_GIT_IDENTITY } from "./constants/git-identity.js";
import { GIT_BRANCH_REF_PREFIX } from "./constants/git-refs.js";
import { GIT_BIN } from "./constants/git-cli.js";

/** `git fast-import` subcommand/flag this module invokes (see `runFastImport`). */
const GIT_FAST_IMPORT_SUBCOMMAND = "fast-import" as const;
const GIT_FAST_IMPORT_QUIET_FLAG = "--quiet" as const;

/** `child_process.spawn`'s stdio config values used for the `git fast-import` child process. */
const CHILD_PROCESS_STDIO_MODE = {
  PIPE: "pipe",
  IGNORE: "ignore",
} as const;

/** `ChildProcess` event names this module listens for. */
const CHILD_PROCESS_EVENT = {
  DATA: "data",
  ERROR: "error",
  CLOSE: "close",
} as const;

/**
 * `git fast-import` stream format keywords this builder emits (see `git help fast-import`).
 * Each is a bare command verb; callers append the rest of the line themselves.
 */
const FAST_IMPORT_COMMAND = {
  COMMIT: "commit",
  COMMITTER: "committer",
  DATA: "data",
  FROM: "from",
  DELETE_ALL: "deleteall",
  MODIFY: "M",
} as const;

/** Git tree-entry file mode for a plain (non-executable, non-symlink) regular file. */
const GIT_FILE_MODE_REGULAR = "100644" as const;

/** `fast-import`'s inline data mode — file content follows immediately in the stream, as
 *  opposed to referencing an already-known blob mark/sha. */
const FAST_IMPORT_DATA_MODE_INLINE = "inline" as const;

/** Fixed UTC (`+0000`) offset stamped on synthetic Docuvia commits — `DOCUVIA_GIT_IDENTITY`
 *  never reflects local git config, so there is no real timezone to report. */
const UTC_TIMEZONE_OFFSET = "+0000" as const;

/** `runFastImport`'s failure message when the spawned `git fast-import` process exits non-zero. */
const FAST_IMPORT_EXIT_ERROR_MESSAGE = (code: number, stderr: string): string =>
  `git fast-import exited with code ${code}${stderr ? ": " + stderr : ""}`;

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

export async function collectDirectoryFiles(
  sourceDir: string,
): Promise<Map<string, string>> {
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
          const content = await limit(() =>
            fs.readFile(fullPath, UTF8_ENCODING),
          );
          files.set(relPath, content);
        }
      }),
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
  parentCommitSha?: string,
): string {
  const lines: string[] = [];
  lines.push(`${FAST_IMPORT_COMMAND.COMMIT} ${GIT_BRANCH_REF_PREFIX}${branch}`);
  lines.push(
    `${FAST_IMPORT_COMMAND.COMMITTER} ${DOCUVIA_GIT_IDENTITY.NAME} <${DOCUVIA_GIT_IDENTITY.EMAIL}> ${nowUnix} ${UTC_TIMEZONE_OFFSET}`,
  );
  lines.push(
    `${FAST_IMPORT_COMMAND.DATA} ${Buffer.byteLength(commitMessage, UTF8_ENCODING)}`,
  );
  lines.push(commitMessage);

  // Parenting on the branch's current tip (STOR-001 point 2 — "continuous stacking") is what
  // keeps prior commits reachable; omitted only for the branch's very first commit, which is
  // necessarily a root commit.
  if (parentCommitSha) {
    lines.push(`${FAST_IMPORT_COMMAND.FROM} ${parentCommitSha}`);
  }

  lines.push(FAST_IMPORT_COMMAND.DELETE_ALL);

  for (const [filePath, content] of files) {
    const contentBytes = Buffer.from(content, UTF8_ENCODING);
    const posixPath = filePath.split(path.sep).join(path.posix.sep);
    lines.push(
      `${FAST_IMPORT_COMMAND.MODIFY} ${GIT_FILE_MODE_REGULAR} ${FAST_IMPORT_DATA_MODE_INLINE} ${posixPath}`,
    );
    lines.push(`${FAST_IMPORT_COMMAND.DATA} ${contentBytes.length}`);
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
export function runFastImport(
  cwd: string,
  fastImportData: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      GIT_BIN,
      [GIT_FAST_IMPORT_SUBCOMMAND, GIT_FAST_IMPORT_QUIET_FLAG],
      {
        cwd,
        stdio: [
          CHILD_PROCESS_STDIO_MODE.PIPE,
          CHILD_PROCESS_STDIO_MODE.IGNORE,
          CHILD_PROCESS_STDIO_MODE.PIPE,
        ],
      },
    );
    const stderrChunks: Buffer[] = [];
    child.stderr.on(CHILD_PROCESS_EVENT.DATA, (chunk: Buffer) =>
      stderrChunks.push(chunk),
    );
    (child as any).on(CHILD_PROCESS_EVENT.ERROR, reject);
    (child as any).on(CHILD_PROCESS_EVENT.CLOSE, (code: number) => {
      if (code === 0) return resolve();
      const stderr = Buffer.concat(stderrChunks).toString(UTF8_ENCODING).trim();
      reject(new Error(FAST_IMPORT_EXIT_ERROR_MESSAGE(code, stderr)));
    });
    child.stdin.end(fastImportData, UTF8_ENCODING);
  });
}
