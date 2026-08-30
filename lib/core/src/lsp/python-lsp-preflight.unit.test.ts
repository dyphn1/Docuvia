import { describe, it, expect, afterEach, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { checkPythonLspPreflight } from "./python-lsp-preflight.js";
import { rmSyncRetrying } from "./windows-rm-retry.test-support.js";

/**
 * Mirrors `typescript-lsp-preflight.unit.test.ts`'s shape for TS -- the
 * `npx --no-install pyright --version` probe path is real (no network dependency,
 * `--no-install` refuses to hit the registry), so these tests are slower than pure unit tests but
 * not flaky when pyright isn't installed anywhere docuvia bundles.
 */
describe("checkPythonLspPreflight()", () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-pylsp-preflight-"),
    );
  });

  afterEach(async () => {
    await rmSyncRetrying(workspaceRoot);
  });

  it("reports not ready with a reason when no pyproject.toml/requirements.txt is present", async () => {
    const result = await checkPythonLspPreflight(workspaceRoot);

    expect(result.markerFileResolvable).toBe(false);
    expect(result.ready).toBe(false);
    expect(result.reason!.length).toBeGreaterThanOrEqual(1);
  }, 15000);

  it("accepts requirements.txt as an alternative marker to pyproject.toml", async () => {
    fs.writeFileSync(path.join(workspaceRoot, "requirements.txt"), "");

    const result = await checkPythonLspPreflight(workspaceRoot, {
      binary: "/fake/but/overridden",
    });

    expect(result.markerFileResolvable).toBe(true);
    expect(result.ready).toBe(true);
  }, 15000);

  it("is ready when an explicit binary override always resolves, regardless of npx", async () => {
    fs.writeFileSync(path.join(workspaceRoot, "pyproject.toml"), "[project]\n");

    const result = await checkPythonLspPreflight(workspaceRoot, {
      binary: "/fake/but/overridden",
    });

    expect(result.lspBinaryResolvable).toBe(true);
    expect(result.ready).toBe(true);
  }, 15000);

  it("reports the LSP binary as unresolvable when neither a local copy nor npx can find pyright", async () => {
    fs.writeFileSync(path.join(workspaceRoot, "pyproject.toml"), "[project]\n");

    const result = await checkPythonLspPreflight(workspaceRoot);

    expect(result.lspBinaryResolvable).toBe(false);
    expect(result.ready).toBe(false);
    expect(result.reason).toMatch(/not resolvable/);
  }, 15000);

  it("resolves locally when node_modules/.bin has a pyright-langserver copy", async () => {
    fs.writeFileSync(path.join(workspaceRoot, "pyproject.toml"), "[project]\n");
    const binDir = path.join(workspaceRoot, "node_modules", ".bin");
    fs.mkdirSync(binDir, { recursive: true });
    const binName =
      process.platform === "win32"
        ? "pyright-langserver.cmd"
        : "pyright-langserver";
    fs.writeFileSync(path.join(binDir, binName), "#!/bin/sh\n");

    const result = await checkPythonLspPreflight(workspaceRoot);

    expect(result.lspBinaryResolvable).toBe(true);
    expect(result.ready).toBe(true);
  }, 15000);
});
