import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LspJsonRpcClient } from "./lsp-json-rpc-client.js";
import { resolveNpmNpxBinary } from "./lsp-binary-resolver-strategies.js";
import { resolveLspWorkspacePath } from "./lsp-workspace-path.js";

// TDD-SOURCE: lib/contracts/src/interfaces/edge-resolution.interfaces.ts#IEdgeResolutionProvider
// TDD-SOURCE: lib/contracts/src/interfaces/edge-resolution.interfaces.ts#EdgeResolutionProviderConfig

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(
  __dirname,
  "test-fixtures",
  "fake-lsp-server.cjs",
);

const tempDirs: string[] = [];

function tempWorkspace(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-phase7-lsp-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("Phase 7 LSP provider quality", () => {
  it("returns identical binary and workspace-path resolutions across repeated identical input", () => {
    const workspaceRoot = tempWorkspace();
    const config = {
      packageName: "typescript-language-server",
      defaultArgs: ["--stdio"],
    };

    const firstBinary = resolveNpmNpxBinary(workspaceRoot, config);
    const secondBinary = resolveNpmNpxBinary(workspaceRoot, config);
    const firstPath = resolveLspWorkspacePath(workspaceRoot, "src/a.ts");
    const secondPath = resolveLspWorkspacePath(workspaceRoot, "src/a.ts");

    expect(secondBinary).toEqual(firstBinary);
    expect(secondPath).toBe(firstPath);
  });

  it("rejects workspace traversal outside the LSP root", () => {
    const workspaceRoot = tempWorkspace();

    expect(() =>
      resolveLspWorkspacePath(workspaceRoot, "../outside.ts"),
    ).toThrow(/outside the configured workspace root/);
  });

  it("returns identical JSON-RPC results across repeated identical requests", async () => {
    const client = new LspJsonRpcClient();
    await client.start({
      command: process.execPath,
      args: [FIXTURE_PATH],
      cwd: __dirname,
    });

    try {
      const first = await client.request("echo", { stable: true }, 5000);
      const second = await client.request("echo", { stable: true }, 5000);
      expect(second).toEqual(first);
    } finally {
      await client.stop();
    }
  });
});
