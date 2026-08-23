import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { GitLocalProvider } from "./git-local-provider.js";

const execFileAsync = promisify(execFile);

export const KNOWLEDGE_BRANCH = "docuvia-knowledge";
export const HOOK_NAME = "post-commit";
export const HOOK_MARKER = "docuvia snapshot";

export async function git(cwd: string, args: string[]) {
  return execFileAsync("git", args, { cwd });
}

/** Retries a flaky fs-touching operation with backoff — covers a known git-for-Windows race
 *  (antivirus/real-time-protection lock contention on freshly-created files) that only surfaces
 *  under heavy concurrent test-suite I/O, never when a suite runs in isolation. Every test that
 *  writes then immediately reads/chmods a file inside a repo (hook files above all — see
 *  issue #188) must route its fs-touching calls through this, not just the worktree setup. */
export async function retryTransientFsRace<T>(
  fn: () => Promise<T>,
  attempts = 8,
  delayMs = 500,
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastErr;
}

export interface TempGitRepo {
  dir: string;
  provider: GitLocalProvider;
  /** Writes `name` with `content`, stages it, and commits it on the current branch. */
  commitFile(name: string, content: string): Promise<void>;
}

/** Creates a fresh temporary git repository with an identity configured (so commits work
 *  regardless of the machine's global git config). Consolidates the five near-identical
 *  beforeEach fixtures this suite previously duplicated (issue #188). */
export async function createTempGitRepo(
  prefix: string,
  options?: { initialCommit?: boolean },
): Promise<TempGitRepo> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  await git(dir, ["init"]);
  await git(dir, ["config", "user.name", "Test User"]);
  await git(dir, ["config", "user.email", "test@example.com"]);
  if (options?.initialCommit) {
    fs.writeFileSync(path.join(dir, "README.md"), "# test\n");
    await git(dir, ["add", "."]);
    await git(dir, ["commit", "-m", "chore: initial commit"]);
  }
  return {
    dir,
    provider: new GitLocalProvider(),
    async commitFile(name: string, content: string) {
      fs.writeFileSync(path.join(dir, name), content);
      await git(dir, ["add", name]);
      await git(dir, ["commit", "-m", `commit ${name}`]);
    },
  };
}
