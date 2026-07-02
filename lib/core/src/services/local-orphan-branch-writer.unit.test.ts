import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LocalOrphanBranchWriter } from "./local-orphan-branch-writer";
import fs from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import * as child_process from "node:child_process";

vi.mock("node:child_process", () => ({
  execFile: (cmd: string, args: string[], opts: any, cb: any) =>
    cb(null, { stdout: "git version" }),
  spawn: vi.fn(() => ({
    stderr: { on: vi.fn() },
    on: vi.fn((event, cb) => {
      if (event === "close") cb(0);
    }),
    stdin: { end: vi.fn() },
  })),
}));

describe("LocalOrphanBranchWriter", () => {
  const workspaceRoot = "/mock/workspace_orphan";
  const sourceDirectory = "/mock/workspace_orphan/temp_graph";

  beforeEach(async () => {
    await fs.mkdir(sourceDirectory, { recursive: true });
    await fs.writeFile(path.join(sourceDirectory, "test.md"), "test content", "utf8");
    await fs.mkdir(path.join(sourceDirectory, "nested"), { recursive: true });
    await fs.writeFile(
      path.join(sourceDirectory, "nested", "data.json"),
      '{"hello":"world"}',
      "utf8"
    );
  });

  afterEach(async () => {
    if (existsSync(sourceDirectory)) {
      await fs.rm(sourceDirectory, { recursive: true, force: true });
    }
    vi.clearAllMocks();
  });

  it("should pack the directory to git fast-import", async () => {
    const writer = new LocalOrphanBranchWriter(workspaceRoot);
    await writer.packDirectoryToBranch(sourceDirectory);

    const spawnMock = vi.mocked(child_process.spawn);
    expect(spawnMock).toHaveBeenCalled();
    const spawnCall = spawnMock.mock.calls[0];
    const stdinEndCall = (spawnMock.mock.results[0].value as any).stdin.end.mock.calls[0];
    const fastImportData = stdinEndCall[0] as string;

    expect(fastImportData).toContain("test.md");
    expect(fastImportData).toContain("test content");
    expect(fastImportData).toContain("nested/data.json");
    expect(fastImportData).toContain('{"hello":"world"}');
  });
});
