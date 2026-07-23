import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { checkGoLspPreflight } from "./go-lsp-preflight.js";
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

describe("checkGoLspPreflight()", () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-golsp-preflight-"),
    );
    vi.restoreAllMocks();
  });

  afterEach(() => {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("reports not ready with a reason when no go.mod is present", async () => {
    const result = await checkGoLspPreflight(workspaceRoot);

    expect(result.markerFileResolvable).toBe(false);
    expect(result.ready).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it("reports not ready when go.mod is present but gopls binary cannot be found", async () => {
    fs.writeFileSync(path.join(workspaceRoot, "go.mod"), "module test\n");

    // Simulate gopls not being resolvable on PATH, regardless of what's actually installed on
    // the machine running this test.
    vi.mocked(resolvePathNativeBinary).mockResolvedValueOnce({
      command: "gopls",
      args: [],
      locallyResolved: false,
    });

    const result = await checkGoLspPreflight(workspaceRoot);

    expect(result.markerFileResolvable).toBe(true);
    expect(result.lspBinaryResolvable).toBe(false);
    expect(result.ready).toBe(false);
    expect(result.reason).toMatch(/gopls is not resolvable/);
  });

  it("is ready when go.mod is present and binary override resolves successfully", async () => {
    fs.writeFileSync(path.join(workspaceRoot, "go.mod"), "module test\n");

    const result = await checkGoLspPreflight(workspaceRoot, {
      binary: "/fake/path/to/gopls",
    });

    expect(result.markerFileResolvable).toBe(true);
    expect(result.lspBinaryResolvable).toBe(true);
    expect(result.ready).toBe(true);
  });
});
