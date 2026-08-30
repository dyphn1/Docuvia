import { describe, expect, it, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import {
  FAST_IMPORT_EXIT_ERROR_MESSAGE,
  buildFastImportData,
  collectDirectoryFiles,
  runFastImport,
} from "../src/fast-import.js";
import { SUBPROCESS_TEST_TIMEOUT_MS } from "@workspace/contracts/testing/timeouts";

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]) {
  return execFileAsync("git", args, { cwd });
}

describe("FAST_IMPORT_EXIT_ERROR_MESSAGE", () => {
  it("falls back to the recorded stdin write error when git produced no stderr (issue #186)", () => {
    const message = FAST_IMPORT_EXIT_ERROR_MESSAGE(
      1,
      "",
      new Error("write EPIPE"),
    );
    expect(message).toBe(
      "git fast-import exited with code 1: stdin write failed: write EPIPE",
    );
  });

  it("prefers git's stderr and still appends a distinct stdin write error when both exist (issue #186)", () => {
    const message = FAST_IMPORT_EXIT_ERROR_MESSAGE(
      128,
      "fatal: invalid path '.git/internal.md'",
      new Error("write EOF"),
    );
    expect(message).toBe(
      "git fast-import exited with code 128: fatal: invalid path '.git/internal.md'; stdin write failed: write EOF",
    );
  });

  it("keeps the historical shape when neither stderr nor a stdin error is available", () => {
    expect(FAST_IMPORT_EXIT_ERROR_MESSAGE(1, "")).toBe(
      "git fast-import exited with code 1",
    );
  });
});

describe("buildFastImportData", () => {
  it("produces a valid fast-import stream with commit, committer, data, and file entries", () => {
    const files = new Map<string, string>([
      ["readme.md", "# Hello\n"],
      ["src/index.ts", "export const x = 1;\n"],
    ]);
    const stream = buildFastImportData(
      "docuvia-knowledge",
      files,
      Math.floor(Date.now() / 1000),
      "Snapshot [test]",
    );

    expect(stream).toContain("commit refs/heads/docuvia-knowledge");
    expect(stream).toContain("committer");
    expect(stream).toContain("data");
    expect(stream).toContain("deleteall");
    expect(stream).toContain("M 100644 inline readme.md");
    expect(stream).toContain("M 100644 inline src/index.ts");
    expect(stream).toContain("# Hello\n");
    expect(stream).toContain("export const x = 1;\n");
  });

  it("includes a 'from' line when parentCommitSha is provided (continuous stacking)", () => {
    const files = new Map<string, string>([["a.md", "content\n"]]);
    const parentSha = "a".repeat(40);
    const stream = buildFastImportData(
      "docuvia-knowledge",
      files,
      Math.floor(Date.now() / 1000),
      "Snapshot [parent]",
      parentSha,
    );

    expect(stream).toContain(`from ${parentSha}`);
  });

  it("omits the 'from' line for a root commit (no parent)", () => {
    const files = new Map<string, string>([["a.md", "content\n"]]);
    const stream = buildFastImportData(
      "docuvia-knowledge",
      files,
      Math.floor(Date.now() / 1000),
      "Snapshot [root]",
    );

    expect(stream).not.toMatch(/^from /m);
  });
});

describe("collectDirectoryFiles", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-fast-import-collect-"),
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("recursively collects all files with their relative paths and content", async () => {
    fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "readme.md"), "# Hello\n");
    fs.writeFileSync(
      path.join(tmpDir, "src", "index.ts"),
      "export const x = 1;\n",
    );
    fs.writeFileSync(
      path.join(tmpDir, "src", "util.ts"),
      "export const y = 2;\n",
    );

    const files = await collectDirectoryFiles(tmpDir, tmpDir);

    expect(files.size).toBe(3);
    expect(files.has("readme.md")).toBe(true);
    expect(
      files.has(path.join("src", "index.ts")) || files.has("src/index.ts"),
    ).toBe(true);
    expect(
      files.has(path.join("src", "util.ts")) || files.has("src/util.ts"),
    ).toBe(true);
    expect(files.get("readme.md")).toBe("# Hello\n");
  });

  it("returns an empty map for an empty directory", async () => {
    const files = await collectDirectoryFiles(tmpDir, tmpDir);
    expect(files.size).toBe(0);
  });

  it("throws FS_PATH_TRAVERSAL when sourceDir escapes allowed root", async () => {
    const outsideDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-fast-import-outside-"),
    );
    fs.writeFileSync(path.join(outsideDir, "secret.txt"), "secret\n");

    await expect(collectDirectoryFiles(outsideDir, tmpDir)).rejects.toThrow(
      /escapes allowed root/,
    );
    await expect(
      collectDirectoryFiles(outsideDir, tmpDir),
    ).rejects.toMatchObject({
      code: "FS_PATH_TRAVERSAL",
    });

    fs.rmSync(outsideDir, { recursive: true, force: true });
  });

  it("throws FS_PATH_TRAVERSAL for relative path traversal attempts", async () => {
    const subDir = path.join(tmpDir, "sub");
    fs.mkdirSync(subDir, { recursive: true });
    fs.writeFileSync(path.join(subDir, "file.txt"), "content\n");

    // Try to escape using relative path
    await expect(
      collectDirectoryFiles(path.join(subDir, "..", ".."), tmpDir),
    ).rejects.toThrow(/escapes allowed root/);
  });
});

describe("runFastImport — git tree structure verification", () => {
  let repoDir: string;
  let sourceDir: string;

  beforeEach(async () => {
    repoDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-fast-import-repo-"),
    );
    sourceDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-fast-import-src-"),
    );
    await git(repoDir, ["init"]);
    await git(repoDir, ["config", "user.name", "Test User"]);
    await git(repoDir, ["config", "user.email", "test@example.com"]);
  }, SUBPROCESS_TEST_TIMEOUT_MS);

  afterEach(async () => {
    await fs.promises.rm(repoDir, {
      recursive: true,
      force: true,
      maxRetries: 8,
      retryDelay: 250,
    });
    await fs.promises.rm(sourceDir, {
      recursive: true,
      force: true,
      maxRetries: 8,
      retryDelay: 250,
    });
  });

  it("creates a branch with the expected files and content after a root import", async () => {
    fs.writeFileSync(path.join(sourceDir, "graph.md"), "card a\n");
    fs.writeFileSync(path.join(sourceDir, "readme.md"), "# Project\n");

    const files = await collectDirectoryFiles(sourceDir, sourceDir);
    const stream = buildFastImportData(
      "docuvia-knowledge",
      files,
      Math.floor(Date.now() / 1000),
      "Snapshot [root]",
    );
    await runFastImport(repoDir, stream);

    const { stdout: branchExists } = await git(repoDir, [
      "branch",
      "--list",
      "docuvia-knowledge",
    ]);
    expect(branchExists.trim()).toBe("docuvia-knowledge");

    const { stdout: lsOutput } = await git(repoDir, [
      "ls-tree",
      "-r",
      "--name-only",
      "docuvia-knowledge",
    ]);
    const treeFiles = lsOutput.trim().split("\n").filter(Boolean);
    expect(treeFiles.sort()).toEqual(["graph.md", "readme.md"]);

    const { stdout: graphContent } = await git(repoDir, [
      "show",
      "docuvia-knowledge:graph.md",
    ]);
    expect(graphContent).toBe("card a\n");

    const { stdout: readmeContent } = await git(repoDir, [
      "show",
      "docuvia-knowledge:readme.md",
    ]);
    expect(readmeContent).toBe("# Project\n");

    const { stdout: commitMessage } = await git(repoDir, [
      "log",
      "-1",
      "--format=%B",
      "docuvia-knowledge",
    ]);
    expect(commitMessage.trim()).toBe("Snapshot [root]");
  });

  it("parents a second import on the previous tip (continuous stacking) and replaces the tree wholesale", async () => {
    fs.writeFileSync(path.join(sourceDir, "old.md"), "stale\n");
    let files = await collectDirectoryFiles(sourceDir);
    let stream = buildFastImportData(
      "docuvia-knowledge",
      files,
      Math.floor(Date.now() / 1000),
      "Snapshot [first]",
    );
    await runFastImport(repoDir, stream);
    const { stdout: firstShaOut } = await git(repoDir, [
      "rev-parse",
      "docuvia-knowledge",
    ]);
    const firstSha = firstShaOut.trim();

    fs.rmSync(path.join(sourceDir, "old.md"));
    fs.writeFileSync(path.join(sourceDir, "new.md"), "fresh\n");
    files = await collectDirectoryFiles(sourceDir);
    stream = buildFastImportData(
      "docuvia-knowledge",
      files,
      Math.floor(Date.now() / 1000),
      "Snapshot [second]",
      firstSha,
    );
    await runFastImport(repoDir, stream);

    const { stdout: lsOutput } = await git(repoDir, [
      "ls-tree",
      "-r",
      "--name-only",
      "docuvia-knowledge",
    ]);
    expect(lsOutput.trim().split("\n").filter(Boolean)).toEqual(["new.md"]);

    const { stdout: parentOutput } = await git(repoDir, [
      "log",
      "-1",
      "--format=%P",
      "docuvia-knowledge",
    ]);
    expect(parentOutput.trim()).toBe(firstSha);

    const { stdout: logOutput } = await git(repoDir, [
      "log",
      "--format=%H",
      "docuvia-knowledge",
    ]);
    expect(logOutput.trim().split("\n")).toHaveLength(2);
  });

  it("preserves nested directory structure in the tree", async () => {
    fs.mkdirSync(path.join(sourceDir, "knowledge", "_l3"), { recursive: true });
    fs.writeFileSync(
      path.join(sourceDir, "knowledge", "_l3", "aaa.md"),
      "card a\n",
    );
    fs.writeFileSync(
      path.join(sourceDir, "knowledge", "_l3", "bbb.md"),
      "card b\n",
    );

    const files = await collectDirectoryFiles(sourceDir, sourceDir);
    const stream = buildFastImportData(
      "docuvia-knowledge",
      files,
      Math.floor(Date.now() / 1000),
      "Snapshot [nested]",
    );
    await runFastImport(repoDir, stream);

    const { stdout: lsOutput } = await git(repoDir, [
      "ls-tree",
      "-r",
      "--name-only",
      "docuvia-knowledge",
    ]);
    const treeFiles = lsOutput.trim().split("\n").filter(Boolean);
    expect(treeFiles.sort()).toEqual([
      "knowledge/_l3/aaa.md",
      "knowledge/_l3/bbb.md",
    ]);

    const { stdout: content } = await git(repoDir, [
      "show",
      "docuvia-knowledge:knowledge/_l3/aaa.md",
    ]);
    expect(content).toBe("card a\n");
  });
});
