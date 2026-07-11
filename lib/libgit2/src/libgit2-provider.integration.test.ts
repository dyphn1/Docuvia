import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { Libgit2Provider } from "./libgit2-provider.js";

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]) {
  return execFileAsync("git", args, { cwd });
}

const KNOWLEDGE_BRANCH = "docuvia-knowledge";
const HOOK_NAME = "post-commit";
const HOOK_MARKER = "docuvia snapshot";

describe("Libgit2Provider (integration, real git shell-outs)", () => {
  let tmpDir: string;
  let provider: Libgit2Provider;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-libgit2-test-"));
    provider = new Libgit2Provider();
    await git(tmpDir, ["init"]);
    await git(tmpDir, ["config", "user.name", "Test User"]);
    await git(tmpDir, ["config", "user.email", "test@example.com"]);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("isGitRepository returns true inside a git repo and false otherwise", async () => {
    expect(await provider.isGitRepository(tmpDir)).toBe(true);

    const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-non-git-test-"));
    try {
      expect(await provider.isGitRepository(nonGitDir)).toBe(false);
    } finally {
      fs.rmSync(nonGitDir, { recursive: true, force: true });
    }
  });

  it("branchExists / commitEmptyTree / updateBranchRef create a branch pointing at a rootless commit", async () => {
    expect(await provider.branchExists(tmpDir, KNOWLEDGE_BRANCH)).toBe(false);

    const sha = await provider.commitEmptyTree(tmpDir, "chore: initialize empty knowledge graph");
    await provider.updateBranchRef(tmpDir, KNOWLEDGE_BRANCH, sha);

    expect(await provider.branchExists(tmpDir, KNOWLEDGE_BRANCH)).toBe(true);
    const { stdout } = await git(tmpDir, ["branch", "--list", KNOWLEDGE_BRANCH]);
    expect(stdout).toContain(KNOWLEDGE_BRANCH);
  });

  it("hooksDirExists / readHookFile / appendHookFile / makeHookExecutable install a working hook", async () => {
    expect(await provider.hooksDirExists(tmpDir)).toBe(true);
    expect(await provider.readHookFile(tmpDir, HOOK_NAME)).toBeUndefined();

    await provider.appendHookFile(tmpDir, HOOK_NAME, `#!/bin/bash\n# ${HOOK_MARKER}\n`);
    // Must not throw — the POSIX executable bit itself isn't portably assertable here
    // (chmod is a no-op on Windows filesystems).
    await expect(provider.makeHookExecutable(tmpDir, HOOK_NAME)).resolves.not.toThrow();

    const content = await provider.readHookFile(tmpDir, HOOK_NAME);
    expect(content).toContain(HOOK_MARKER);
  });

  it("getRemoteUrl returns undefined when no origin remote is configured, and the URL once one is added", async () => {
    expect(await provider.getRemoteUrl(tmpDir)).toBeUndefined();

    await git(tmpDir, ["remote", "add", "origin", "https://example.com/repo.git"]);
    expect(await provider.getRemoteUrl(tmpDir)).toBe("https://example.com/repo.git");
  });

  it("listTrackedFilesWithBlobHash / listUntrackedFiles / listModifiedFiles reflect working tree state", async () => {
    fs.writeFileSync(path.join(tmpDir, "tracked.ts"), "export const a = 1;\n");
    await git(tmpDir, ["add", "tracked.ts"]);
    await git(tmpDir, ["commit", "-m", "initial commit"]);

    fs.writeFileSync(path.join(tmpDir, "tracked.ts"), "export const a = 2;\n");
    fs.writeFileSync(path.join(tmpDir, "untracked.ts"), "export const b = 1;\n");

    const tracked = await provider.listTrackedFilesWithBlobHash(tmpDir);
    expect(tracked.has("tracked.ts")).toBe(true);

    const untracked = await provider.listUntrackedFiles(tmpDir);
    expect(untracked).toContain("untracked.ts");

    const modified = await provider.listModifiedFiles(tmpDir);
    expect(modified).toContain("tracked.ts");
  });

  it("readBlobContent returns the committed content for a blob sha", async () => {
    fs.writeFileSync(path.join(tmpDir, "tracked.ts"), "export const a = 1;\n");
    await git(tmpDir, ["add", "tracked.ts"]);
    await git(tmpDir, ["commit", "-m", "initial commit"]);

    const tracked = await provider.listTrackedFilesWithBlobHash(tmpDir);
    const sha = tracked.get("tracked.ts")!;
    const content = await provider.readBlobContent(tmpDir, sha);
    expect(content).toBe("export const a = 1;\n");
  });

  it("getRecentChangedFilePaths returns changed paths from recent commit history, and [] with no commits yet", async () => {
    expect(await provider.getRecentChangedFilePaths(tmpDir, 10)).toEqual([]);

    fs.writeFileSync(path.join(tmpDir, "tracked.ts"), "export const a = 1;\n");
    await git(tmpDir, ["add", "tracked.ts"]);
    await git(tmpDir, ["commit", "-m", "initial commit"]);

    const paths = await provider.getRecentChangedFilePaths(tmpDir, 10);
    expect(paths).toContain("tracked.ts");
  });
});
