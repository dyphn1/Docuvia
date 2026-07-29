import { describe, it, expect, afterEach, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { checkLspPreflight } from "./lsp-preflight.js";
import { rmSyncRetrying } from "./windows-rm-retry.test-support.js";

/**
 * The `npx --no-install typescript-language-server --version` probe path is real (no network
 * dependency -- `--no-install` refuses to hit the registry), so these tests are slower than pure
 * unit tests but not flaky; they mirror this workspace's own confirmed behavior (the package is
 * not installed anywhere docuvia bundles, so the probe reliably reports unavailable).
 */
describe("checkLspPreflight()", () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-lsp-preflight-"),
    );
  });

  afterEach(async () => {
    await rmSyncRetrying(workspaceRoot);
  });

  it("reports not ready with a reason when node_modules is missing", async () => {
    const result = await checkLspPreflight(workspaceRoot);

    expect(result.nodeModulesPresent).toBe(false);
    expect(result.ready).toBe(false);
    expect(result.reason).toBeTruthy();
  }, 15000);

  it("reports not ready when node_modules exists but no tsconfig/jsconfig does", async () => {
    fs.mkdirSync(path.join(workspaceRoot, "node_modules"));

    const result = await checkLspPreflight(workspaceRoot);

    expect(result.nodeModulesPresent).toBe(true);
    expect(result.tsconfigResolvable).toBe(false);
    expect(result.ready).toBe(false);
  }, 15000);

  it("is ready when an explicit binary override always resolves, regardless of npx", async () => {
    fs.mkdirSync(path.join(workspaceRoot, "node_modules"));
    fs.writeFileSync(path.join(workspaceRoot, "tsconfig.json"), "{}");

    const result = await checkLspPreflight(workspaceRoot, {
      binary: "/fake/but/overridden",
    });

    expect(result.lspBinaryResolvable).toBe(true);
    expect(result.ready).toBe(true);
  }, 15000);

  it("reports the LSP binary as unresolvable when neither a local copy nor npx can find it", async () => {
    fs.mkdirSync(path.join(workspaceRoot, "node_modules"));
    fs.writeFileSync(path.join(workspaceRoot, "tsconfig.json"), "{}");

    const result = await checkLspPreflight(workspaceRoot);

    expect(result.lspBinaryResolvable).toBe(false);
    expect(result.ready).toBe(false);
    expect(result.reason).toMatch(/not resolvable/);
  }, 15000);
});
