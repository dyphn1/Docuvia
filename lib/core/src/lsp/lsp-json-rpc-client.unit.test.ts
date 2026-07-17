import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LspJsonRpcClient } from "./lsp-json-rpc-client.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(
  __dirname,
  "test-fixtures",
  "fake-lsp-server.cjs",
);

/**
 * Real-subprocess coverage of the Content-Length-framed JSON-RPC wire protocol
 * (LspJsonRpcClient's actual reason for existing) against a fixture server speaking the same
 * transport a real `typescript-language-server` would -- see
 * `test-fixtures/fake-lsp-server.cjs`'s doc comment. `TypescriptLspEdgeProvider`'s own tests use
 * an in-memory fake client instead (faster, deterministic); this file is what proves the framing
 * itself actually round-trips over a real process boundary.
 */
describe("LspJsonRpcClient (real subprocess, Content-Length framing)", () => {
  it("starts the process and completes a request/response round trip", async () => {
    const client = new LspJsonRpcClient();
    await client.start({
      command: process.execPath,
      args: [FIXTURE_PATH],
      cwd: __dirname,
    });
    try {
      const result = await client.request("echo", { hello: "world" }, 5000);
      expect(result).toEqual({ hello: "world" });
    } finally {
      await client.stop();
    }
  });

  it("correlates concurrent requests by id, not by response order", async () => {
    const client = new LspJsonRpcClient();
    await client.start({
      command: process.execPath,
      args: [FIXTURE_PATH],
      cwd: __dirname,
    });
    try {
      const [a, b, c] = await Promise.all([
        client.request("echo", { n: 1 }, 5000),
        client.request("echo", { n: 2 }, 5000),
        client.request("echo", { n: 3 }, 5000),
      ]);
      expect(a).toEqual({ n: 1 });
      expect(b).toEqual({ n: 2 });
      expect(c).toEqual({ n: 3 });
    } finally {
      await client.stop();
    }
  });

  it("rejects on a server error response", async () => {
    const client = new LspJsonRpcClient();
    await client.start({
      command: process.execPath,
      args: [FIXTURE_PATH],
      cwd: __dirname,
    });
    try {
      await expect(client.request("fail", {}, 5000)).rejects.toThrow(
        "fake failure",
      );
    } finally {
      await client.stop();
    }
  });

  it("rejects a request that outlives its timeout", async () => {
    const client = new LspJsonRpcClient();
    await client.start({
      command: process.execPath,
      args: [FIXTURE_PATH],
      cwd: __dirname,
    });
    try {
      await expect(client.request("hang", {}, 50)).rejects.toThrow(
        /timed out after 50ms/,
      );
    } finally {
      await client.stop();
    }
  });

  it("rejects request() with a clear error when the binary does not resolve (spawn failure)", async () => {
    const client = new LspJsonRpcClient();
    await expect(
      client.start({
        command: "docuvia-lsp-binary-that-does-not-exist",
        args: [],
        cwd: __dirname,
      }),
    ).rejects.toThrow();
  });

  it("sends notifications without expecting a response (does not throw, does not hang)", async () => {
    const client = new LspJsonRpcClient();
    await client.start({
      command: process.execPath,
      args: [FIXTURE_PATH],
      cwd: __dirname,
    });
    try {
      expect(() =>
        client.notify("textDocument/didOpen", { irrelevant: true }),
      ).not.toThrow();
      const result = await client.request("echo", { after: "notify" }, 5000);
      expect(result).toEqual({ after: "notify" });
    } finally {
      await client.stop();
    }
  });

  it("stop() is idempotent and safe to call multiple times", async () => {
    const client = new LspJsonRpcClient();
    await client.start({
      command: process.execPath,
      args: [FIXTURE_PATH],
      cwd: __dirname,
    });
    await client.stop();
    await expect(client.stop()).resolves.toBeUndefined();
  });
});
