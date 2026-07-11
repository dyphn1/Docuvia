import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { WorkspaceGitService } from "./workspace-git.service.js";
import { GitConstants } from "../constants/git.js";

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]) {
  return execFileAsync("git", args, { cwd });
}

describe("WorkspaceGitService", () => {
  let tmpDir: string;
  let service: WorkspaceGitService;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-workspace-git-test-"));
    service = new WorkspaceGitService();
    await git(tmpDir, ["init"]);
    await git(tmpDir, ["config", "user.name", "Test User"]);
    await git(tmpDir, ["config", "user.email", "test@example.com"]);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("isGitRepository returns true inside a git repo and false otherwise", async () => {
    expect(await service.isGitRepository(tmpDir)).toBe(true);

    const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-non-git-test-"));
    try {
      expect(await service.isGitRepository(nonGitDir)).toBe(false);
    } finally {
      fs.rmSync(nonGitDir, { recursive: true, force: true });
    }
  });

  it("ensureKnowledgeBranch creates the branch on first call and is idempotent on the second", async () => {
    const first = await service.ensureKnowledgeBranch(tmpDir, GitConstants.KNOWLEDGE_ROOT);
    expect(first.created).toBe(true);

    const { stdout } = await git(tmpDir, ["branch", "--list", GitConstants.KNOWLEDGE_ROOT]);
    expect(stdout).toContain(GitConstants.KNOWLEDGE_ROOT);

    const second = await service.ensureKnowledgeBranch(tmpDir, GitConstants.KNOWLEDGE_ROOT);
    expect(second.created).toBe(false);
  });

  it("installPostCommitHook installs the hook once and does not duplicate it on re-run", async () => {
    const first = await service.installPostCommitHook(tmpDir);
    expect(first.installed).toBe(true);

    const hookPath = path.join(
      tmpDir,
      ...GitConstants.GIT_HOOKS_DIR,
      GitConstants.POST_COMMIT_HOOK_FILENAME
    );
    const content = fs.readFileSync(hookPath, "utf8");
    expect(content).toContain(GitConstants.POST_COMMIT_HOOK_MARKER);

    const second = await service.installPostCommitHook(tmpDir);
    expect(second.installed).toBe(false);

    const occurrences = content.split(GitConstants.POST_COMMIT_HOOK_MARKER).length - 1;
    expect(occurrences).toBe(1);
  });

  it("getRemoteUrl returns undefined when no origin remote is configured", async () => {
    expect(await service.getRemoteUrl(tmpDir)).toBeUndefined();
  });

  it("getRemoteUrl returns the configured origin URL", async () => {
    await git(tmpDir, ["remote", "add", "origin", "https://example.com/repo.git"]);
    expect(await service.getRemoteUrl(tmpDir)).toBe("https://example.com/repo.git");
  });

  it("listTrackedFilesWithBlobHash / listUntrackedFiles / listModifiedFiles reflect working tree state", async () => {
    fs.writeFileSync(path.join(tmpDir, "tracked.ts"), "export const a = 1;\n");
    await git(tmpDir, ["add", "tracked.ts"]);
    await git(tmpDir, ["commit", "-m", "initial commit"]);

    // Modify the tracked file and add an untracked file
    fs.writeFileSync(path.join(tmpDir, "tracked.ts"), "export const a = 2;\n");
    fs.writeFileSync(path.join(tmpDir, "untracked.ts"), "export const b = 1;\n");

    const tracked = await service.listTrackedFilesWithBlobHash(tmpDir);
    expect(tracked.has("tracked.ts")).toBe(true);

    const untracked = await service.listUntrackedFiles(tmpDir);
    expect(untracked).toContain("untracked.ts");

    const modified = await service.listModifiedFiles(tmpDir);
    expect(modified).toContain("tracked.ts");
  });

  it("readBlobContent returns the committed content for a blob sha", async () => {
    fs.writeFileSync(path.join(tmpDir, "tracked.ts"), "export const a = 1;\n");
    await git(tmpDir, ["add", "tracked.ts"]);
    await git(tmpDir, ["commit", "-m", "initial commit"]);

    const tracked = await service.listTrackedFilesWithBlobHash(tmpDir);
    const sha = tracked.get("tracked.ts")!;
    const content = await service.readBlobContent(tmpDir, sha);
    expect(content).toBe("export const a = 1;\n");
  });

  it("getRecentChangedFilePaths returns changed paths from recent commit history", async () => {
    fs.writeFileSync(path.join(tmpDir, "tracked.ts"), "export const a = 1;\n");
    await git(tmpDir, ["add", "tracked.ts"]);
    await git(tmpDir, ["commit", "-m", "initial commit"]);

    const paths = await service.getRecentChangedFilePaths(tmpDir, 10);
    expect(paths).toContain("tracked.ts");
  });

  it("getRecentChangedFilePaths gracefully returns [] when there are no commits yet", async () => {
    const paths = await service.getRecentChangedFilePaths(tmpDir, 10);
    expect(paths).toEqual([]);
  });
});
