import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import child_process from "node:child_process";
import { checkJavaLspPreflight } from "./java-lsp-preflight.js";

describe("checkJavaLspPreflight()", () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-javalsp-preflight-"),
    );
    vi.restoreAllMocks();
  });

  afterEach(() => {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("reports not ready with a reason when no markers are present", async () => {
    const result = await checkJavaLspPreflight(workspaceRoot);

    expect(result.markerFileResolvable).toBe(false);
    expect(result.ready).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it("reports not ready when markers are present but jdtls binary cannot be found", async () => {
    fs.writeFileSync(
      path.join(workspaceRoot, "pom.xml"),
      "<project></project>\n",
    );

    // Spy on execFile to simulate failing when trying to probe jdtls
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

    const result = await checkJavaLspPreflight(workspaceRoot);

    expect(result.markerFileResolvable).toBe(true);
    expect(result.lspBinaryResolvable).toBe(false);
    expect(result.ready).toBe(false);
    expect(result.reason).toMatch(/jdtls is not resolvable/);
  });

  it("is ready when pom.xml is present and binary override resolves successfully", async () => {
    fs.writeFileSync(
      path.join(workspaceRoot, "pom.xml"),
      "<project></project>\n",
    );

    const result = await checkJavaLspPreflight(workspaceRoot, {
      binary: "/fake/path/to/jdtls",
    });

    expect(result.markerFileResolvable).toBe(true);
    expect(result.lspBinaryResolvable).toBe(true);
    expect(result.ready).toBe(true);
  });
});
