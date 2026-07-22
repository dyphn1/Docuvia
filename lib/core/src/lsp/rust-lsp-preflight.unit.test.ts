import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import child_process from "node:child_process";
import { checkRustLspPreflight } from "./rust-lsp-preflight.js";

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

    // Spy on execFile to simulate failing when trying to probe rust-analyzer
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
