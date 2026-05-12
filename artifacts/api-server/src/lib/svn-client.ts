import { execFile } from "child_process";
import { promisify } from "util";

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

function parseSvnLogXml(xml: string): SvnRevisionInfo[] {
  const entries: SvnRevisionInfo[] = [];
  const entryRegex = /<logentry\s+revision="(\d+)"[^>]*>([\s\S]*?)<\/logentry>/g;
  let match: RegExpExecArray | null;

  while ((match = entryRegex.exec(xml)) !== null) {
    const revision = parseInt(match[1], 10);
    const body = match[2];

    const author = (/<author>([\s\S]*?)<\/author>/.exec(body) ?? [])[1]?.trim() ?? "unknown";
    const date = (/<date>([\s\S]*?)<\/date>/.exec(body) ?? [])[1]?.trim() ?? "";
    const rawMsg = (/<msg>([\s\S]*?)<\/msg>/.exec(body) ?? [])[1]?.trim() ?? "";

    entries.push({ revision, author, date, message: rawMsg });
  }

  return entries;
}

/**
 * Fetch SVN log entries for the given revision range.
 * Uses `svn log --xml -r START:END URL` — arguments are passed as an array
 * to execFile, so user-supplied values cannot inject shell commands.
 */
export async function getSvnLog(
  svnUrl: string,
  startRevision: number,
  endRevision: number | "HEAD",
  username?: string,
  password?: string
): Promise<SvnRevisionInfo[]> {
  const authArgs = buildAuthArgs(username, password);
  const revRange = `${startRevision}:${endRevision}`;

  let stdout: string;
  try {
    const result = await execFileAsync("svn", [
      "log",
      "--xml",
      "-r",
      revRange,
      svnUrl,
      ...authArgs,
    ]);
    stdout = result.stdout;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("ENOENT") || msg.includes("not found")) {
      throw new Error(
        "SVN CLI is not installed or not in PATH. Please install Subversion and ensure `svn` is accessible."
      );
    }
    throw new Error(`svn log failed: ${msg}`);
  }

  return parseSvnLogXml(stdout);
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
