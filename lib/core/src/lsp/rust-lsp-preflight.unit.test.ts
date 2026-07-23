import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { checkRustLspPreflight } from "./rust-lsp-preflight.js";
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

describe("checkRustLspPreflight()", () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-rustlsp-preflight-"),
    );
    vi.restoreAllMocks();
  });

  afterEach(() => {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("reports not ready with a reason when no Cargo.toml is present", async () => {
    const result = await checkRustLspPreflight(workspaceRoot);

    expect(result.markerFileResolvable).toBe(false);
    expect(result.ready).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it("reports not ready when Cargo.toml is present but rust-analyzer binary cannot be found", async () => {
    fs.writeFileSync(path.join(workspaceRoot, "Cargo.toml"), "[package]\n");

    // Simulate rust-analyzer not being resolvable on PATH, regardless of what's actually
    // installed on the machine running this test.
    vi.mocked(resolvePathNativeBinary).mockResolvedValueOnce({
      command: "rust-analyzer",
      args: [],
      locallyResolved: false,
    });

    const result = await checkRustLspPreflight(workspaceRoot);

    expect(result.markerFileResolvable).toBe(true);
    expect(result.lspBinaryResolvable).toBe(false);
    expect(result.ready).toBe(false);
    expect(result.reason).toMatch(/rust-analyzer is not resolvable/);
  });

  it("is ready when Cargo.toml is present and binary override resolves successfully", async () => {
    fs.writeFileSync(path.join(workspaceRoot, "Cargo.toml"), "[package]\n");

    const result = await checkRustLspPreflight(workspaceRoot, {
      binary: "/fake/path/to/rust-analyzer",
    });

    expect(result.markerFileResolvable).toBe(true);
    expect(result.lspBinaryResolvable).toBe(true);
    expect(result.ready).toBe(true);
  });
});
