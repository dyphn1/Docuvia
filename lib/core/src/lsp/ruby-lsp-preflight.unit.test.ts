import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import child_process from "node:child_process";
import { checkRubyLspPreflight } from "./ruby-lsp-preflight.js";

describe("checkRubyLspPreflight()", () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-rubylsp-preflight-"),
    );
    vi.restoreAllMocks();
  });

  afterEach(() => {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("reports not ready with a reason when no Gemfile/Gemfile.lock is present", async () => {
    const result = await checkRubyLspPreflight(workspaceRoot);

    expect(result.markerFileResolvable).toBe(false);
    expect(result.ready).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it("reports not ready when Gemfile is present but ruby-lsp binary cannot be found", async () => {
    fs.writeFileSync(path.join(workspaceRoot, "Gemfile"), "source 'https://rubygems.org'\n");

    // Spy on execFile to simulate failing when trying to probe ruby-lsp
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

    const result = await checkRubyLspPreflight(workspaceRoot);

    expect(result.markerFileResolvable).toBe(true);
    expect(result.lspBinaryResolvable).toBe(false);
    expect(result.ready).toBe(false);
    expect(result.reason).toMatch(/ruby-lsp is not resolvable/);
  });

  it("is ready when Gemfile is present and binary override resolves successfully", async () => {
    fs.writeFileSync(path.join(workspaceRoot, "Gemfile"), "source 'https://rubygems.org'\n");

    const result = await checkRubyLspPreflight(workspaceRoot, {
      binary: "/fake/path/to/ruby-lsp",
    });

    expect(result.markerFileResolvable).toBe(true);
    expect(result.lspBinaryResolvable).toBe(true);
    expect(result.ready).toBe(true);
  });
});
