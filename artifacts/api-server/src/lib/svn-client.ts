import { spawn, execFile } from "child_process";
import { promisify } from "util";
import * as sax from "sax";

const execFileAsync = promisify(execFile);

export interface SvnRevisionInfo {
  revision: number;
  author: string;
  date: string;
  message: string;
}

function buildAuthArgs(username?: string, password?: string): string[] {
  if (username) {
    return [
      "--username",
      username,
      "--password",
      password ?? "",
      "--no-auth-cache",
      "--non-interactive",
    ];
  }
  return ["--non-interactive"];
}

/**
 * Fetch SVN log entries for the given revision range.
 * Uses `svn log --xml -r START:END URL` — arguments are passed as an array
 * to spawn, so user-supplied values cannot inject shell commands.
 */
export async function* getSvnLog(
  svnUrl: string,
  startRevision: number,
  endRevision: number | "HEAD",
  username?: string,
  password?: string
): AsyncGenerator<SvnRevisionInfo, void, unknown> {
  const authArgs = buildAuthArgs(username, password);
  const revRange = `${startRevision}:${endRevision}`;

  const abortController = new AbortController();
  const svnProcess = spawn(
    "svn",
    ["log", "--xml", "-r", revRange, svnUrl, ...authArgs],
    { signal: abortController.signal }
  );

  let resolveNext: (() => void) | null = null;
  let rejectNext: ((err: Error) => void) | null = null;
  const queue: SvnRevisionInfo[] = [];
  let isDone = false;
  let error: Error | null = null;

  const pushItem = (item: SvnRevisionInfo) => {
    queue.push(item);
    if (resolveNext) {
      resolveNext();
      resolveNext = null;
      rejectNext = null;
    }
  };

  const markDone = () => {
    isDone = true;
    if (resolveNext) {
      resolveNext();
      resolveNext = null;
      rejectNext = null;
    }
  };

  const reportError = (err: Error) => {
    error = err;
    if (rejectNext) {
      rejectNext(err);
      resolveNext = null;
      rejectNext = null;
    }
  };

  const parser = sax.createStream(true);

  let currentEntry: Partial<SvnRevisionInfo> | null = null;
  let currentText = "";

  parser.on("opentag", (node) => {
    currentText = "";
    if (node.name === "logentry") {
      currentEntry = {
        revision: parseInt(node.attributes.revision as string, 10),
        author: "unknown",
        date: "",
        message: "",
      };
    }
  });

  parser.on("text", (text) => {
    currentText += text;
  });

  parser.on("cdata", (text) => {
    currentText += text;
  });

  parser.on("closetag", (tagName) => {
    if (currentEntry) {
      if (tagName === "author") {
        currentEntry.author = currentText.trim() || "unknown";
      } else if (tagName === "date") {
        currentEntry.date = currentText.trim();
      } else if (tagName === "msg") {
        currentEntry.message = currentText.trim();
      } else if (tagName === "logentry") {
        pushItem(currentEntry as SvnRevisionInfo);
        currentEntry = null;
      }
    }
  });

  parser.on("error", (err) => {
    reportError(err);
  });

  svnProcess.stdout.pipe(parser);

  svnProcess.on("error", (err) => {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("ENOENT") || msg.includes("not found")) {
      reportError(
        new Error(
          "SVN CLI is not installed or not in PATH. Please install Subversion and ensure `svn` is accessible."
        )
      );
    } else {
      reportError(new Error(`svn log failed: ${msg}`));
    }
  });

  svnProcess.on("close", (code) => {
    if (code !== 0 && code !== null) {
      reportError(new Error(`svn process exited with code ${code}`));
    } else {
      markDone();
    }
  });

  try {
    while (true) {
      if (queue.length > 0) {
        yield queue.shift()!;
      } else if (error) {
        throw error;
      } else if (isDone) {
        break;
      } else {
        await new Promise<void>((resolve, reject) => {
          resolveNext = resolve;
          rejectNext = reject;
        });
      }
    }
  } finally {
    abortController.abort();
    svnProcess.kill();
  }
}

/**
 * Fetch the unified diff for a single SVN revision.
 * Uses `svn diff -c REVISION URL` — all arguments are passed as an array.
 */
export async function getSvnDiff(
  svnUrl: string,
  revision: number,
  username?: string,
  password?: string
): Promise<string> {
  const authArgs = buildAuthArgs(username, password);

  try {
    const result = await execFileAsync("svn", [
      "diff",
      "-c",
      String(revision),
      svnUrl,
      ...authArgs,
    ]);
    return result.stdout;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("ENOENT") || msg.includes("not found")) {
      throw new Error(
        "SVN CLI is not installed or not in PATH. Please install Subversion and ensure `svn` is accessible."
      );
    }
    throw new Error(`svn diff -c ${revision} failed: ${msg}`);
  }
}
