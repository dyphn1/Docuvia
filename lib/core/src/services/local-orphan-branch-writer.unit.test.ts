import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs/promises";
import os from "os";
import path from "path";

const { buildFastImportDataMock, runGitFastImportMock } = vi.hoisted(() => ({
  buildFastImportDataMock: vi.fn().mockReturnValue({ commands: "" }),
  runGitFastImportMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../utils/git-fast-import-helper.js", () => ({
  buildFastImportData: buildFastImportDataMock,
  runGitFastImport: runGitFastImportMock,
}));

import { LocalOrphanBranchWriter } from "./local-orphan-branch-writer.js";

describe("LocalOrphanBranchWriter.collectFiles (via packDirectoryToBranch)", () => {
  let sourceDir: string;

  beforeEach(async () => {
    sourceDir = await fs.mkdtemp(path.join(os.tmpdir(), "docuvia-orphan-branch-writer-test-"));
    buildFastImportDataMock.mockClear();
    runGitFastImportMock.mockClear();
  });

  afterEach(async () => {
    await fs.rm(sourceDir, { recursive: true, force: true });
  });

  it("collects every file's content into a Map<relPath, content>, walking nested directories in parallel", async () => {
    await fs.writeFile(path.join(sourceDir, "root.md"), "root content", "utf8");
    await fs.mkdir(path.join(sourceDir, "a", "b"), { recursive: true });
    await fs.writeFile(path.join(sourceDir, "a", "one.md"), "one content", "utf8");
    await fs.writeFile(path.join(sourceDir, "a", "b", "two.md"), "two content", "utf8");
    await fs.mkdir(path.join(sourceDir, "c"), { recursive: true });
    for (let i = 0; i < 25; i++) {
      await fs.writeFile(path.join(sourceDir, "c", `f${i}.md`), `content-${i}`, "utf8");
    }

    const writer = new LocalOrphanBranchWriter(sourceDir);
    await writer.packDirectoryToBranch(sourceDir, "docuvia-knowledge");

    expect(buildFastImportDataMock).toHaveBeenCalledTimes(1);
    const filesArg: Map<string, string> = buildFastImportDataMock.mock.calls[0][1];

    expect(filesArg).toBeInstanceOf(Map);
    expect(filesArg.size).toBe(28); // root.md + a/one.md + a/b/two.md + 25 files in c/

    expect(filesArg.get("root.md")).toBe("root content");
    expect(filesArg.get(path.join("a", "one.md"))).toBe("one content");
    expect(filesArg.get(path.join("a", "b", "two.md"))).toBe("two content");
    for (let i = 0; i < 25; i++) {
      expect(filesArg.get(path.join("c", `f${i}.md`))).toBe(`content-${i}`);
    }

    expect(runGitFastImportMock).toHaveBeenCalledTimes(1);
  });

  it("returns an empty Map for an empty source directory", async () => {
    const writer = new LocalOrphanBranchWriter(sourceDir);
    await writer.packDirectoryToBranch(sourceDir, "docuvia-knowledge");

    const filesArg: Map<string, string> = buildFastImportDataMock.mock.calls[0][1];
    expect(filesArg.size).toBe(0);
  });
});
