import { describe, it, expect, afterEach, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { checkPhpLspPreflight } from "./php-lsp-preflight.js";
import { rmSyncRetrying } from "./windows-rm-retry.test-support.js";

describe("checkPhpLspPreflight()", () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-phplsp-preflight-"),
    );
  });

  afterEach(async () => {
    await rmSyncRetrying(workspaceRoot);
  });

  it("reports not ready with a reason when no composer.json is present", async () => {
    const result = await checkPhpLspPreflight(workspaceRoot);

    expect(result.markerFileResolvable).toBe(false);
    expect(result.ready).toBe(false);
    expect(result.reason!.length).toBeGreaterThanOrEqual(1);
  }, 15000);

  it("is ready when composer.json is present and binary override resolves successfully", async () => {
    fs.writeFileSync(path.join(workspaceRoot, "composer.json"), "{}\n");

    const result = await checkPhpLspPreflight(workspaceRoot, {
      binary: "/fake/path/to/intelephense",
    });

    expect(result.markerFileResolvable).toBe(true);
    expect(result.lspBinaryResolvable).toBe(true);
    expect(result.ready).toBe(true);
  });

  it("reports the LSP binary as unresolvable when neither a local copy nor npx can find intelephense", async () => {
    fs.writeFileSync(path.join(workspaceRoot, "composer.json"), "{}\n");

    const result = await checkPhpLspPreflight(workspaceRoot);

    expect(result.lspBinaryResolvable).toBe(false);
    expect(result.ready).toBe(false);
    expect(result.reason).toMatch(/not resolvable/);
  }, 15000);
});
