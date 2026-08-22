import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { describe, it, expect, afterEach } from "vitest";
import { DOCUVIA_DIR_NAME } from "@workspace/contracts";
import { resolveOutDir } from "./export-topology.js";

const tempDirs: string[] = [];

function makeWorkspaceRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-export-out-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => fs.promises.rm(dir, { recursive: true, force: true })),
  );
});

describe("resolveOutDir()", () => {
  it("resolves a normal relative --out against the workspace root", () => {
    const root = makeWorkspaceRoot();

    expect(resolveOutDir("out/graphs", root)).toBe(
      path.join(root, "out", "graphs"),
    );
  });

  it("defaults to .docuvia directly under the workspace root when --out is omitted", () => {
    const root = makeWorkspaceRoot();

    expect(resolveOutDir(undefined, root)).toBe(
      path.join(root, DOCUVIA_DIR_NAME),
    );
  });

  it("throws FS_PATH_TRAVERSAL when the resolved path escapes the workspace root", () => {
    const root = makeWorkspaceRoot();

    expect(() => resolveOutDir("../../elsewhere", root)).toThrowError(
      /escapes workspace root/,
    );
    expect(() =>
      resolveOutDir(path.join(os.tmpdir(), "outside"), root),
    ).toThrowError(/escapes workspace root/);
  });
});
