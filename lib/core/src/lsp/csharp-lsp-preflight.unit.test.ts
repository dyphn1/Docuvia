import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { checkCsharpLspPreflight } from "./csharp-lsp-preflight.js";
import { resolvePathNativeBinary } from "./lsp-binary-resolver-strategies.js";

vi.mock("./lsp-binary-resolver-strategies.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("./lsp-binary-resolver-strategies.js")
    >();
  return {
    ...actual,
    resolvePathNativeBinary: vi.fn(actual.resolvePathNativeBinary),
  };
});

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
    fs.writeFileSync(
      path.join(workspaceRoot, "test.csproj"),
      "<Project></Project>\n",
    );

    // Simulate csharp-ls not being resolvable on PATH, regardless of what's actually
    // installed on the machine running this test.
    vi.mocked(resolvePathNativeBinary).mockResolvedValueOnce({
      command: "csharp-ls",
      args: [],
      locallyResolved: false,
    });

    const result = await checkCsharpLspPreflight(workspaceRoot);

    expect(result.markerFileResolvable).toBe(true);
    expect(result.lspBinaryResolvable).toBe(false);
    expect(result.ready).toBe(false);
    expect(result.reason).toMatch(/csharp-ls is not resolvable/);
  });

  it("is ready when test.csproj is present and binary override resolves successfully", async () => {
    fs.writeFileSync(
      path.join(workspaceRoot, "test.csproj"),
      "<Project></Project>\n",
    );

    const result = await checkCsharpLspPreflight(workspaceRoot, {
      binary: "/fake/path/to/csharp-ls",
    });

    expect(result.markerFileResolvable).toBe(true);
    expect(result.lspBinaryResolvable).toBe(true);
    expect(result.ready).toBe(true);
  });

  it("recognizes a .slnx solution file (newer XML solution format) as a marker file", async () => {
    fs.writeFileSync(
      path.join(workspaceRoot, "Orleans.slnx"),
      "<Solution></Solution>\n",
    );

    const result = await checkCsharpLspPreflight(workspaceRoot, {
      binary: "/fake/path/to/csharp-ls",
    });

    expect(result.markerFileResolvable).toBe(true);
    expect(result.ready).toBe(true);
  });
});
