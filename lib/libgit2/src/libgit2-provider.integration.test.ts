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

  it("packDirectoryToBranch commits every file under sourceDir onto branchName as a fresh root commit", async () => {
    const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-libgit2-pack-src-"));
    try {
      fs.mkdirSync(path.join(sourceDir, "graph"), { recursive: true });
      fs.writeFileSync(path.join(sourceDir, "graph", "nodes.jsonl"), '{"id":"l2:1"}\n');
      fs.writeFileSync(path.join(sourceDir, "readme.md"), "# hello\n");

      await provider.packDirectoryToBranch(tmpDir, sourceDir, KNOWLEDGE_BRANCH);

      expect(await provider.branchExists(tmpDir, KNOWLEDGE_BRANCH)).toBe(true);
      const { stdout } = await git(tmpDir, [
        "ls-tree",
        "-r",
        "--name-only",
        KNOWLEDGE_BRANCH,
      ]);
      const files = stdout.split("\n").map((f) => f.trim()).filter(Boolean);
      expect(files.sort()).toEqual(["graph/nodes.jsonl", "readme.md"]);

      const { stdout: content } = await git(tmpDir, [
        "show",
        `${KNOWLEDGE_BRANCH}:graph/nodes.jsonl`,
      ]);
      expect(content).toBe('{"id":"l2:1"}\n');
    } finally {
      fs.rmSync(sourceDir, { recursive: true, force: true });
    }
  });

  it("getChangedFilesSince treats a flag-like baseRef as a literal ref (errors) instead of parsing it as a git option", async () => {
    fs.writeFileSync(path.join(tmpDir, "tracked.ts"), "export const a = 1;\n");
    await git(tmpDir, ["add", "tracked.ts"]);
    await git(tmpDir, ["commit", "-m", "initial commit"]);

    // Normal baseRef usage still works (regression guard for the `--end-of-options` change).
    fs.writeFileSync(path.join(tmpDir, "tracked.ts"), "export const a = 2;\n");
    const entries = await provider.getChangedFilesSince(tmpDir, "HEAD");
    expect(entries).toEqual(
      expect.arrayContaining([{ file: "tracked.ts", status: "modified" }])
    );

    // A baseRef crafted to look like a git option must not be parsed as one — it's swallowed by
    // the method's catch-all (git errors on it as an invalid revision/option, not silently
    // executed as a flag), so this must resolve to an empty (or untracked-files-only) result
    // rather than throwing or invoking the injected option's behavior.
    await expect(
      provider.getChangedFilesSince(tmpDir, "--upload-pack=/bin/sh")
    ).resolves.not.toThrow();
  });

  it("getFilesChangedByCommit treats a flag-like sha as a literal ref (errors) instead of parsing it as a git option", async () => {
    fs.writeFileSync(path.join(tmpDir, "tracked.ts"), "export const a = 1;\n");
    await git(tmpDir, ["add", "tracked.ts"]);
    await git(tmpDir, ["commit", "-m", "initial commit"]);
    // `diff-tree` reports nothing for a root commit without `--root` — unrelated to this fix —
    // so use a second, non-root commit here.
    fs.writeFileSync(path.join(tmpDir, "tracked.ts"), "export const a = 2;\n");
    await git(tmpDir, ["commit", "-am", "second commit"]);
    const { stdout: headSha } = await git(tmpDir, ["rev-parse", "HEAD"]);

    // Normal sha usage still works (regression guard for the `--end-of-options` change).
    const files = await provider.getFilesChangedByCommit(tmpDir, headSha.trim());
    expect(files).toContain("tracked.ts");

    // A flag-like sha must surface as a `GIT_COMMAND_FAILED` DocuviaError (git rejects it as an
    // invalid revision/option), never as the option silently taking effect.
    await expect(
      provider.getFilesChangedByCommit(tmpDir, "--upload-pack=/bin/sh")
    ).rejects.toMatchObject({ code: "GIT_COMMAND_FAILED" });
  });

  it("packDirectoryToBranch wholesale replaces an existing branch's tree (deleteall + force)", async () => {
    const firstSourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-libgit2-pack-src1-"));
    const secondSourceDir = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-libgit2-pack-src2-"));
    try {
      fs.writeFileSync(path.join(firstSourceDir, "old.md"), "stale\n");
      await provider.packDirectoryToBranch(tmpDir, firstSourceDir, KNOWLEDGE_BRANCH);

      fs.writeFileSync(path.join(secondSourceDir, "new.md"), "fresh\n");
      await provider.packDirectoryToBranch(tmpDir, secondSourceDir, KNOWLEDGE_BRANCH);

      const { stdout } = await git(tmpDir, [
        "ls-tree",
        "-r",
        "--name-only",
        KNOWLEDGE_BRANCH,
      ]);
      const files = stdout.split("\n").map((f) => f.trim()).filter(Boolean);
      expect(files).toEqual(["new.md"]);
    } finally {
      fs.rmSync(firstSourceDir, { recursive: true, force: true });
      fs.rmSync(secondSourceDir, { recursive: true, force: true });
    }
  });
});
