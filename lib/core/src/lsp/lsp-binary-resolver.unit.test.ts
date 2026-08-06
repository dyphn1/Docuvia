import { describe, it, expect, afterEach, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { resolveLspBinary } from "./lsp-binary-resolver.js";

describe("resolveLspBinary()", () => {
  let workspaceRoot: string;
  let originalNodeOptions: string | undefined;

  beforeEach(() => {
    workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-lsp-binres-"),
    );
    // Give every test a clean, deterministic baseline regardless of what NODE_OPTIONS the outer
    // test-runner process happens to have set -- tests that care about a pre-existing value set
    // it explicitly within their own body instead.
    originalNodeOptions = process.env.NODE_OPTIONS;
    delete process.env.NODE_OPTIONS;
  });

  afterEach(() => {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
    if (originalNodeOptions === undefined) {
      delete process.env.NODE_OPTIONS;
    } else {
      process.env.NODE_OPTIONS = originalNodeOptions;
    }
  });

  it("prefers an explicit override over any other resolution", () => {
    const resolved = resolveLspBinary(workspaceRoot, {
      binary: "/custom/path/to/server",
      args: ["--custom-flag"],
    });

    expect(resolved.command).toBe("/custom/path/to/server");
    expect(resolved.args).toEqual(["--custom-flag"]);
    expect(resolved.locallyResolved).toBe(true);
    expect(resolved.env?.NODE_OPTIONS).toBe("--max-old-space-size=8192");
  });

  it("defaults an override's args to --stdio when none are given", () => {
    const resolved = resolveLspBinary(workspaceRoot, {
      binary: "/custom/server",
    });
    expect(resolved.args).toEqual(["--stdio"]);
    expect(resolved.env?.NODE_OPTIONS).toBe("--max-old-space-size=8192");
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
    expect(resolved.env?.NODE_OPTIONS).toBe("--max-old-space-size=8192");
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
    expect(resolved.env?.NODE_OPTIONS).toBe("--max-old-space-size=8192");
  });

  describe("heap size env override", () => {
    it("sets NODE_OPTIONS to --max-old-space-size=8192 when unset", () => {
      const resolved = resolveLspBinary(workspaceRoot);
      expect(resolved.env?.NODE_OPTIONS).toBe("--max-old-space-size=8192");
    });

    it("appends the flag rather than replacing an unrelated existing NODE_OPTIONS", () => {
      process.env.NODE_OPTIONS = "--stack-trace-limit=100";

      const resolved = resolveLspBinary(workspaceRoot);

      expect(resolved.env?.NODE_OPTIONS).toBe(
        "--stack-trace-limit=100 --max-old-space-size=8192",
      );
    });

    it("leaves env undefined when NODE_OPTIONS already sets --max-old-space-size", () => {
      process.env.NODE_OPTIONS = "--max-old-space-size=8192";

      const resolved = resolveLspBinary(workspaceRoot);

      expect(resolved.env).toBeUndefined();
    });
  });
});
