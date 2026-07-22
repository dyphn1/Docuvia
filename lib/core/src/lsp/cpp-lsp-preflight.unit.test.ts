import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import child_process from "node:child_process";
import { checkCppLspPreflight } from "./cpp-lsp-preflight.js";

describe("checkCppLspPreflight()", () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-cpplsp-preflight-"),
    );
    vi.restoreAllMocks();
  });

  afterEach(() => {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("reports not ready with a reason when no markers are present", async () => {
    const result = await checkCppLspPreflight(workspaceRoot);

    expect(result.markerFileResolvable).toBe(false);
    expect(result.ready).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it("reports not ready when markers are present but clangd binary cannot be found", async () => {
    fs.writeFileSync(path.join(workspaceRoot, "CMakeLists.txt"), "project(test)\n");

    // Spy on execFile to simulate failing when trying to probe clangd
    vi.spyOn(child_process, "execFile").mockImplementation(((
      _file: any,
      _args: any,
      _options: any,
      callback: any,
    ) => {
      if (typeof callback === "function") {
        callback(new Error("not found"), "", "");
      }
      return {} as any;
    }) as any);

    const result = await checkCppLspPreflight(workspaceRoot);

    expect(result.markerFileResolvable).toBe(true);
    // Since PATH-native has no locallyResolved = false fallback command (like npx), it'll be false
    expect(result.lspBinaryResolvable).toBe(false);
    expect(result.ready).toBe(false);
    expect(result.reason).toMatch(/clangd is not resolvable/);
  });

  it("is ready when CMakeLists.txt is present and binary override resolves successfully", async () => {
    fs.writeFileSync(path.join(workspaceRoot, "CMakeLists.txt"), "project(test)\n");

    const result = await checkCppLspPreflight(workspaceRoot, {
      binary: "/fake/path/to/clangd",
    });

    expect(result.markerFileResolvable).toBe(true);
    expect(result.lspBinaryResolvable).toBe(true);
    expect(result.ready).toBe(true);
  });
});
