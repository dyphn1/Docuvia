import { describe, it, expect, afterEach, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { resolveLspBinary } from "./lsp-binary-resolver.js";

describe("resolveLspBinary()", () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-lsp-binres-"),
    );
  });

  afterEach(() => {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("prefers an explicit override over any other resolution", () => {
    const resolved = resolveLspBinary(workspaceRoot, {
      binary: "/custom/path/to/server",
      args: ["--custom-flag"],
    });

    expect(resolved).toEqual({
      command: "/custom/path/to/server",
      args: ["--custom-flag"],
      locallyResolved: true,
    });
  });

  it("defaults an override's args to --stdio when none are given", () => {
    const resolved = resolveLspBinary(workspaceRoot, {
      binary: "/custom/server",
    });
    expect(resolved.args).toEqual(["--stdio"]);
  });

  it("resolves a project-local node_modules/.bin copy when present", () => {
    const binDir = path.join(workspaceRoot, "node_modules", ".bin");
    fs.mkdirSync(binDir, { recursive: true });
    const binName =
      process.platform === "win32"
        ? "typescript-language-server.cmd"
        : "typescript-language-server";
    fs.writeFileSync(path.join(binDir, binName), "#!/bin/sh\n");

    const resolved = resolveLspBinary(workspaceRoot);

    expect(resolved.locallyResolved).toBe(true);
    expect(resolved.command).toBe(path.join(binDir, binName));
    expect(resolved.args).toEqual(["--stdio"]);
  });

  it("falls back to npx --no-install when no local copy is resolvable", () => {
    const resolved = resolveLspBinary(workspaceRoot);

    expect(resolved.locallyResolved).toBe(false);
    expect(resolved.command).toBe("npx");
    expect(resolved.args).toEqual([
      "--no-install",
      "typescript-language-server",
      "--stdio",
    ]);
  });
});
