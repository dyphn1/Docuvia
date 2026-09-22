import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { checkJavaLspPreflight } from "./java-lsp-preflight.js";
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

  it("derives Chocolatey candidates from the injected host view (issue #440)", async () => {
    vi.mocked(resolvePathNativeBinary).mockResolvedValueOnce({
      command: "jdtls",
      args: [],
      locallyResolved: false,
    });

    await checkJavaLspPreflight(workspaceRoot, undefined, {
      platform: "win32",
      env: { ChocolateyInstall: "D:\\InjectedChocolatey" },
    });

    expect(resolvePathNativeBinary).toHaveBeenCalledWith(
      expect.objectContaining({
        extraCandidateDirs: expect.arrayContaining([
          path.join("D:\\InjectedChocolatey", "bin"),
        ]),
      }),
      undefined,
    );
  });

  it("reports not ready with a reason when no markers are present", async () => {
    const result = await checkJavaLspPreflight(workspaceRoot);

    expect(result.markerFileResolvable).toBe(false);
    expect(result.ready).toBe(false);
    expect(result.reason!.length).toBeGreaterThanOrEqual(1);
  });

  it("reports not ready when markers are present but jdtls binary cannot be found", async () => {
    fs.writeFileSync(
      path.join(workspaceRoot, "pom.xml"),
      "<project></project>\n",
    );

    vi.mocked(resolvePathNativeBinary).mockResolvedValueOnce({
      command: "jdtls",
      args: [],
      locallyResolved: false,
    });

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
