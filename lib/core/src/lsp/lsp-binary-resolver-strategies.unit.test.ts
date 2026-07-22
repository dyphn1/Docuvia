import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { promisify } from "node:util";

const execFileMock = vi.fn();

/**
 * Node's real `child_process.execFile` has a `util.promisify.custom` implementation baked in
 * (resolves `{ stdout, stderr }`, not just the bare first callback arg) -- the generic
 * `promisify()` fallback our mock would otherwise get only forwards the first non-error callback
 * arg, which doesn't match what `lsp-binary-resolver-strategies.ts`'s `probePathForBinary()`
 * destructures. Replicating the same `promisify.custom` shape here keeps this test double
 * faithful to the real module's contract.
 */
vi.mock("node:child_process", () => {
  function execFile(...args: unknown[]) {
    return execFileMock(...args);
  }
  Object.defineProperty(execFile, promisify.custom, {
    value: (file: string, fileArgs: string[], options: unknown) =>
      new Promise((resolve, reject) => {
        execFileMock(
          file,
          fileArgs,
          options,
          (err: Error | null, stdout: string, stderr: string) => {
            if (err) reject(err);
            else resolve({ stdout, stderr });
          },
        );
      }),
  });
  return { execFile };
});

import {
  resolveNpmNpxBinary,
  resolvePathNativeBinary,
  resolveLocalManifestBinary,
} from "./lsp-binary-resolver-strategies.js";

/** Last arg of a node-style `execFile(file, args, options, callback)` call -- the promisified
 *  wrapper always calls with all four, matching what `resolvePathNativeBinary`'s live PATH probe
 *  invokes internally. */
function invokeCallback(
  mockCall: unknown[],
  err: Error | null,
  stdout = "",
): void {
  const callback = mockCall[mockCall.length - 1] as (
    err: Error | null,
    stdout: string,
    stderr: string,
  ) => void;
  callback(err, stdout, "");
}

describe("resolveNpmNpxBinary()", () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-lsp-npmnpx-"),
    );
  });

  afterEach(() => {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("prefers an explicit override over any other resolution", () => {
    const resolved = resolveNpmNpxBinary(
      workspaceRoot,
      { packageName: "typescript-language-server", defaultArgs: ["--stdio"] },
      { binary: "/custom/server", args: ["--custom-flag"] },
    );

    expect(resolved).toEqual({
      command: "/custom/server",
      args: ["--custom-flag"],
      locallyResolved: true,
    });
  });

  it("resolves a project-local node_modules/.bin copy when the bin name matches the package name", () => {
    const binDir = path.join(workspaceRoot, "node_modules", ".bin");
    fs.mkdirSync(binDir, { recursive: true });
    const binName =
      process.platform === "win32"
        ? "typescript-language-server.cmd"
        : "typescript-language-server";
    fs.writeFileSync(path.join(binDir, binName), "#!/bin/sh\n");

    const resolved = resolveNpmNpxBinary(workspaceRoot, {
      packageName: "typescript-language-server",
      defaultArgs: ["--stdio"],
    });

    expect(resolved.locallyResolved).toBe(true);
    expect(resolved.command).toBe(path.join(binDir, binName));
    expect(resolved.args).toEqual(["--stdio"]);
  });

  it("falls back to npx --no-install <package> when the bin name matches the package name", () => {
    const resolved = resolveNpmNpxBinary(workspaceRoot, {
      packageName: "typescript-language-server",
      defaultArgs: ["--stdio"],
    });

    expect(resolved).toEqual({
      command: "npx",
      args: ["--no-install", "typescript-language-server", "--stdio"],
      locallyResolved: false,
    });
  });

  it("resolves a project-local node_modules/.bin copy under the distinct binaryName, not the package name (pyright/pyright-langserver)", () => {
    const binDir = path.join(workspaceRoot, "node_modules", ".bin");
    fs.mkdirSync(binDir, { recursive: true });
    const binName =
      process.platform === "win32"
        ? "pyright-langserver.cmd"
        : "pyright-langserver";
    fs.writeFileSync(path.join(binDir, binName), "#!/bin/sh\n");
    // A same-named `pyright` bin would also exist alongside it in real installs -- must not be
    // picked in preference to the distinct `binaryName`.
    fs.writeFileSync(path.join(binDir, "pyright"), "#!/bin/sh\n");

    const resolved = resolveNpmNpxBinary(workspaceRoot, {
      packageName: "pyright",
      binaryName: "pyright-langserver",
      defaultArgs: ["--stdio"],
    });

    expect(resolved.locallyResolved).toBe(true);
    expect(resolved.command).toBe(path.join(binDir, binName));
    expect(resolved.args).toEqual(["--stdio"]);
  });

  it("falls back to npx --no-install --package <package> <binaryName> when the bin name differs from the package name", () => {
    const resolved = resolveNpmNpxBinary(workspaceRoot, {
      packageName: "pyright",
      binaryName: "pyright-langserver",
      defaultArgs: ["--stdio"],
    });

    expect(resolved).toEqual({
      command: "npx",
      args: [
        "--no-install",
        "--package",
        "pyright",
        "pyright-langserver",
        "--stdio",
      ],
      locallyResolved: false,
    });
  });
});

describe("resolvePathNativeBinary()", () => {
  beforeEach(() => {
    execFileMock.mockReset();
  });

  it("prefers an explicit override over any PATH probe", async () => {
    const resolved = await resolvePathNativeBinary(
      { binaryName: "gopls", defaultArgs: ["serve"] },
      { binary: "/custom/gopls", args: ["--custom-flag"] },
    );

    expect(resolved).toEqual({
      command: "/custom/gopls",
      args: ["--custom-flag"],
      locallyResolved: true,
    });
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("resolves the binary found by a live PATH probe (where/command -v)", async () => {
    execFileMock.mockImplementation((...args: unknown[]) => {
      const stdout =
        process.platform === "win32"
          ? "C:\tools\gopls.exe\r\n"
          : "/usr/local/bin/gopls\n";
      invokeCallback(args, null, stdout);
    });

    const resolved = await resolvePathNativeBinary({
      binaryName: "gopls",
      defaultArgs: ["serve"],
    });

    expect(resolved.locallyResolved).toBe(true);
    expect(resolved.command).toBe(
      process.platform === "win32"
        ? "C:\tools\gopls.exe"
        : "/usr/local/bin/gopls",
    );
    expect(resolved.args).toEqual(["serve"]);
  });

  it("falls back to an extra candidate dir when the PATH probe finds nothing", async () => {
    execFileMock.mockImplementation((...args: unknown[]) => {
      invokeCallback(args, new Error("not found"));
    });

    const extraDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-lsp-pathnative-"),
    );
    const binName = process.platform === "win32" ? "gopls.exe" : "gopls";
    fs.writeFileSync(path.join(extraDir, binName), "#!/bin/sh\n");

    try {
      const resolved = await resolvePathNativeBinary({
        binaryName: "gopls",
        defaultArgs: ["serve"],
        extraCandidateDirs: [extraDir],
      });

      expect(resolved.locallyResolved).toBe(true);
      expect(resolved.command).toBe(path.join(extraDir, binName));
    } finally {
      fs.rmSync(extraDir, { recursive: true, force: true });
    }
  });

  it("reports unresolved (bare binary name, locallyResolved: false) when neither PATH nor any extra dir has it", async () => {
    execFileMock.mockImplementation((...args: unknown[]) => {
      invokeCallback(args, new Error("not found"));
    });

    const resolved = await resolvePathNativeBinary({
      binaryName: "gopls",
      defaultArgs: ["serve"],
    });

    expect(resolved.locallyResolved).toBe(false);
    expect(resolved.command).toBe("gopls");
    expect(resolved.args).toEqual(["serve"]);
  });
});

describe("resolveLocalManifestBinary()", () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-lsp-localmanifest-"),
    );
  });

  afterEach(() => {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("prefers an explicit override over the manifest/global checks", () => {
    const resolved = resolveLocalManifestBinary(
      workspaceRoot,
      {
        manifestFilename: ".config/dotnet-tools.json",
        buildManifestCommand: (defaultArgs) => ({
          command: "dotnet",
          args: ["tool", "run", "csharp-ls", ...defaultArgs],
        }),
        globalBinaryName: "csharp-ls",
        defaultArgs: ["--stdio"],
      },
      { binary: "/custom/csharp-ls", args: ["--custom-flag"] },
    );

    expect(resolved).toEqual({
      command: "/custom/csharp-ls",
      args: ["--custom-flag"],
      locallyResolved: true,
    });
  });

  it("runs via the manifest command when a project-local tool manifest is present", () => {
    fs.mkdirSync(path.join(workspaceRoot, ".config"), { recursive: true });
    fs.writeFileSync(
      path.join(workspaceRoot, ".config", "dotnet-tools.json"),
      "{}",
    );

    const resolved = resolveLocalManifestBinary(workspaceRoot, {
      manifestFilename: ".config/dotnet-tools.json",
      buildManifestCommand: (defaultArgs) => ({
        command: "dotnet",
        args: ["tool", "run", "csharp-ls", ...defaultArgs],
      }),
      globalBinaryName: "csharp-ls",
      defaultArgs: ["--stdio"],
    });

    expect(resolved).toEqual({
      command: "dotnet",
      args: ["tool", "run", "csharp-ls", "--stdio"],
      locallyResolved: true,
    });
  });

  it("falls back to the global binary name (locallyResolved: false) when no manifest is present", () => {
    const resolved = resolveLocalManifestBinary(workspaceRoot, {
      manifestFilename: ".config/dotnet-tools.json",
      buildManifestCommand: (defaultArgs) => ({
        command: "dotnet",
        args: ["tool", "run", "csharp-ls", ...defaultArgs],
      }),
      globalBinaryName: "csharp-ls",
      defaultArgs: ["--stdio"],
    });

    expect(resolved).toEqual({
      command: "csharp-ls",
      args: ["--stdio"],
      locallyResolved: false,
    });
  });
});
