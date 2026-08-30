import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { checkCppLspPreflight } from "./cpp-lsp-preflight.js";
import { resolvePathNativeBinary } from "./lsp-binary-resolver-strategies.js";

vi.mock("./lsp-binary-resolver-strategies.js", () => ({
  resolvePathNativeBinary: vi.fn(),
}));

describe("checkCppLspPreflight()", () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-cpplsp-preflight-"),
    );
    vi.restoreAllMocks();
    // Default: binary not resolvable. Avoids depending on whether the probe machine
    // happens to have `clangd` on PATH (issue #6).
    vi.mocked(resolvePathNativeBinary).mockResolvedValue({
      command: "clangd",
      args: [],
      locallyResolved: false,
    } as Awaited<ReturnType<typeof resolvePathNativeBinary>>);
  });

  afterEach(() => {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("reports not ready with a reason when no markers are present", async () => {
    const result = await checkCppLspPreflight(workspaceRoot);

    expect(result.markerFileResolvable).toBe(false);
    expect(result.ready).toBe(false);
    expect(result.reason!.length).toBeGreaterThanOrEqual(1);
  });

  it("reports not ready when markers are present but clangd binary cannot be found", async () => {
    fs.writeFileSync(
      path.join(workspaceRoot, "CMakeLists.txt"),
      "project(test)\n",
    );

    vi.mocked(resolvePathNativeBinary).mockResolvedValue({
      command: "clangd",
      args: [],
      locallyResolved: false,
    } as Awaited<ReturnType<typeof resolvePathNativeBinary>>);

    const result = await checkCppLspPreflight(workspaceRoot);

    expect(result.markerFileResolvable).toBe(true);
    expect(result.lspBinaryResolvable).toBe(false);
    expect(result.ready).toBe(false);
    expect(result.reason).toMatch(/clangd is not resolvable/);
  });

  it("is ready when CMakeLists.txt is present and binary override resolves successfully", async () => {
    fs.writeFileSync(
      path.join(workspaceRoot, "CMakeLists.txt"),
      "project(test)\n",
    );

    vi.mocked(resolvePathNativeBinary).mockResolvedValue({
      command: "/fake/path/to/clangd",
      args: [],
      locallyResolved: true,
    } as Awaited<ReturnType<typeof resolvePathNativeBinary>>);

    const result = await checkCppLspPreflight(workspaceRoot, {
      binary: "/fake/path/to/clangd",
    });

    expect(result.markerFileResolvable).toBe(true);
    expect(result.lspBinaryResolvable).toBe(true);
    expect(result.ready).toBe(true);
  });
});
