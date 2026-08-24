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

/** Prefix marking the `child.stdin` write-failure cause inside a fast-import failure message. */
const FAST_IMPORT_STDIN_ERROR_PREFIX = "stdin write failed: " as const;

/** `runFastImport`'s failure message when the spawned `git fast-import` process exits non-zero.
 *  Git's own stderr wins when present; a recorded `child.stdin` write error (issue #186) is
 *  appended — or used as the fallback when stderr is empty — so callers see the real cause
 *  (EPIPE / `write EOF`) instead of just a bare exit code. Exported for unit testing. */
export const FAST_IMPORT_EXIT_ERROR_MESSAGE = (
  code: number,
  stderr: string,
  stdinError?: Error,
): string => {
  const details = [
    stderr,
    stdinError ? `${FAST_IMPORT_STDIN_ERROR_PREFIX}${stdinError.message}` : "",
  ]
    .filter(Boolean)
    .join("; ");
  return `git fast-import exited with code ${code}${details ? ": " + details : ""}`;
};

/** Default cap on how long a `git fast-import` child may run before it is killed (issue #100).
 *  The stream is fully buffered before spawning, so a run that outlives this is *stalled* (stdin
 *  deadlock, blocked disk I/O), not slow — without a timeout the child and its pipes would leak
 *  forever. Generous so genuinely huge trees still import; only a permanently hung process hits it. */
const FAST_IMPORT_TIMEOUT_MS = 5 * 60 * 1000;

/** POSIX signal sent to a `git fast-import` child that exceeded `FAST_IMPORT_TIMEOUT_MS`. */
const FAST_IMPORT_KILL_SIGNAL = "SIGTERM" as const;

/** `runFastImport`'s failure message when `git fast-import` is killed for exceeding its timeout. */
const FAST_IMPORT_TIMEOUT_ERROR_MESSAGE = (timeoutMs: number): string =>
  `git fast-import timed out after ${timeoutMs}ms and was terminated`;

/**
 * Raw `git fast-import` mechanics — pure wire-format encoding and directory reading, no
 * Docuvia-specific semantics (see `GitLocalProvider.packDirectoryToBranch()`, the only caller).
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
 *
 * `child.stdin` gets its own `"error"` listener, separate from `child`'s: when git rejects the
 * stream and exits early (e.g. `fatal: invalid path` on a still-in-flight commit — see
 * `snapshot-renderer.service.ts`'s Windows-reserved-device-name comment for a real one this
 * surfaced, go-cli-benchmark.md §1.1), the still-writing `.end()` call fails with `write EOF`
 * (Windows) / `EPIPE` (POSIX) on `child.stdin` -- a *distinct* `EventEmitter` from `child` itself.
 * An unhandled `"error"` event throws and crashes the whole process (this is what actually
 * happened: a hard, stack-trace crash, not a caught rejection) — the listener records the error
 * instead of discarding it (issue #186), and the `"close"` handler below turns it into a proper
 * rejection carrying git's stderr and/or the recorded stdin cause, which is what callers see.
 */
export function runFastImport(
  cwd: string,
  fastImportData: string,
  timeoutMs: number = FAST_IMPORT_TIMEOUT_MS,
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
    // Issue #100: a stalled fast-import (stdin deadlock, blocked disk I/O) must not leak the child
    // and its pipes forever. Kill it once it outlives `timeoutMs`; the rejection below is the one
    // callers see (the later "close" handler's own reject is a no-op on an already-rejected
    // promise, and its resolve branch only fires on a clean code-0 exit, which a killed process
    // never produces).
    const timeout = setTimeout(() => {
      child.kill(FAST_IMPORT_KILL_SIGNAL);
      reject(new Error(FAST_IMPORT_TIMEOUT_ERROR_MESSAGE(timeoutMs)));
    }, timeoutMs);
    // Don't let the timer itself hold the event loop open once the child has exited.
    timeout.unref();
    const stderrChunks: Buffer[] = [];
    let stdinWriteError: Error | undefined;
    child.stderr.on(CHILD_PROCESS_EVENT.DATA, (chunk: Buffer) =>
      stderrChunks.push(chunk),
    );
    (child as any).on(CHILD_PROCESS_EVENT.ERROR, reject);
    (child as any).on(CHILD_PROCESS_EVENT.CLOSE, (code: number) => {
      clearTimeout(timeout);
      if (code === 0) return resolve();
      const stderr = Buffer.concat(stderrChunks).toString(UTF8_ENCODING).trim();
      reject(
        new Error(
          FAST_IMPORT_EXIT_ERROR_MESSAGE(code, stderr, stdinWriteError),
        ),
      );
    });
    child.stdin.on(CHILD_PROCESS_EVENT.ERROR, (err: Error) => {
      // Issue #186: record -- don't discard -- stdin write failures (EPIPE / "write EOF"). The
      // listener must stay registered either way: without it Node turns an 'error' event into an
      // unhandled, process-crashing exception. The recorded cause surfaces through the "close"
      // rejection above whenever git exits non-zero without explaining itself on stderr.
      stdinWriteError = err;
    });
    child.stdin.end(fastImportData, UTF8_ENCODING);
  });
}
