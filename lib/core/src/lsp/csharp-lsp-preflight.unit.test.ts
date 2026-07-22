import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import child_process from "node:child_process";
import { checkCsharpLspPreflight } from "./csharp-lsp-preflight.js";

describe("checkCsharpLspPreflight()", () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-csharplsp-preflight-"),
    );
    vi.restoreAllMocks();
  });

  afterEach(() => {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("reports not ready with a reason when no solution or csproj file is present", async () => {
    const result = await checkCsharpLspPreflight(workspaceRoot);

    expect(result.markerFileResolvable).toBe(false);
    expect(result.ready).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it("reports not ready when csproj is present but csharp-ls binary cannot be found", async () => {
    fs.writeFileSync(path.join(workspaceRoot, "test.csproj"), "<Project></Project>\n");

    // Spy on execFile to simulate failing when trying to probe csharp-ls
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

    const result = await checkCsharpLspPreflight(workspaceRoot);

    expect(result.markerFileResolvable).toBe(true);
    expect(result.lspBinaryResolvable).toBe(false);
    expect(result.ready).toBe(false);
    expect(result.reason).toMatch(/csharp-ls is not resolvable/);
  });

  it("is ready when test.csproj is present and binary override resolves successfully", async () => {
    fs.writeFileSync(path.join(workspaceRoot, "test.csproj"), "<Project></Project>\n");

    const result = await checkCsharpLspPreflight(workspaceRoot, {
      binary: "/fake/path/to/csharp-ls",
    });

    expect(result.markerFileResolvable).toBe(true);
    expect(result.lspBinaryResolvable).toBe(true);
    expect(result.ready).toBe(true);
  });
});
