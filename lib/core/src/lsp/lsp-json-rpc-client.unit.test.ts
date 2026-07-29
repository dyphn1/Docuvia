import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
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

  it("never times out when timeoutMs is 0 -- waits for a response slower than a typical timeout", async () => {
    const client = new LspJsonRpcClient();
    await client.start({
      command: process.execPath,
      args: [FIXTURE_PATH],
      cwd: __dirname,
    });
    try {
      // The fixture's "delay" method responds after 150ms -- longer than the 50ms timeout the
      // test above proves *does* reject. timeoutMs: 0 must still resolve instead of rejecting.
      const result = await client.request("delay", { ok: true }, 0);
      expect(result).toEqual({ ok: true });
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

/**
 * Regression coverage for the Windows `node_modules/.bin` shim gap: `resolveLspBinary()` prefers
 * a `.cmd` shim on Windows (that's what `npm`/`pnpm` produce for a pure-JS bin like
 * `typescript-language-server` -- see `lsp-binary-resolver.ts`), and plain `node:child_process`
 * cannot spawn a `.cmd`/`.bat` file directly there (throws `EINVAL` synchronously). The other
 * tests in this file only ever spawn `process.execPath` (a real `.exe`), so they never exercised
 * this path. Mirrors the inline `process.platform === "win32"` branching convention used in
 * `lsp-binary-resolver.unit.test.ts` -- exercised, not skipped, on whichever OS actually runs it.
 */
describe("LspJsonRpcClient (spawning through an npm/pnpm-style node_modules/.bin shim)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-lsp-cmdshim-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("starts and completes a request/response round trip through the platform's real bin shim", async () => {
    const isWindows = process.platform === "win32";
    const wrapperPath = path.join(
      tmpDir,
      isWindows ? "fake-lsp-server.cmd" : "fake-lsp-server",
    );
    const wrapperContents = isWindows
      ? `@echo off\r\nnode "${FIXTURE_PATH}" %*\r\n`
      : `#!/bin/sh\nexec node "${FIXTURE_PATH}" "$@"\n`;
    fs.writeFileSync(wrapperPath, wrapperContents);
    if (!isWindows) fs.chmodSync(wrapperPath, 0o755);

    const client = new LspJsonRpcClient();
    await client.start({
      command: wrapperPath,
      args: [],
      cwd: __dirname,
    });
    try {
      const result = await client.request("echo", { via: "shim" }, 5000);
      expect(result).toEqual({ via: "shim" });
    } finally {
      await client.stop();
    }
  });
});

/**
 * Regression coverage for the bare-`npx`-command Windows spawn gap (multi-language-lsp-support
 * plan, Slice 1): `resolveLspBinary()`/`resolveNpmNpxBinary()`'s `npx --no-install <package>`
 * fallback spawns the literal bare command `"npx"` (no `.cmd` extension to trip the shim check
 * above), which plain `child_process.spawn()` cannot exec directly on Windows either -- discovered
 * via a real `pyright-langserver` spawn during this slice, confirmed to affect TypeScript's own
 * `npx` fallback identically (pre-existing, just never exercised by a real spawn in this repo's
 * test suite before). Exercised, not skipped, on whichever OS actually runs it -- POSIX's `npx`
 * is a real shebang script `spawn()` already handles fine, so this only meaningfully asserts on
 * Windows; on POSIX it's a no-op sanity check that the round trip still works via the ordinary
 * non-wrapped path.
 */
describe("LspJsonRpcClient (spawning the bare npx command)", () => {
  it("starts and completes a request/response round trip through a fake npx wrapper", async () => {
    const isWindows = process.platform === "win32";
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-lsp-npx-"));
    try {
      const wrapperPath = path.join(tmpDir, isWindows ? "npx.cmd" : "npx");
      const wrapperContents = isWindows
        ? `@echo off\r\nnode "${FIXTURE_PATH}" %*\r\n`
        : `#!/bin/sh\nexec node "${FIXTURE_PATH}" "$@"\n`;
      fs.writeFileSync(wrapperPath, wrapperContents);
      if (!isWindows) fs.chmodSync(wrapperPath, 0o755);

      const client = new LspJsonRpcClient();
      await client.start({
        // The command string that actually matters is the bare "npx" name (matching what
        // resolveLspBinary()/resolveNpmNpxBinary() literally pass), spawned with this fixture's
        // dir prepended to PATH so it resolves to the fake wrapper above rather than any real npx.
        command: "npx",
        args: [],
        cwd: __dirname,
        env: {
          ...process.env,
          PATH: `${tmpDir}${path.delimiter}${process.env.PATH ?? ""}`,
          PATHEXT: isWindows
            ? `.CMD;${process.env.PATHEXT ?? ""}`
            : process.env.PATHEXT,
        },
      });
      try {
        const result = await client.request(
          "echo",
          { via: "npx-wrapper" },
          5000,
        );
        expect(result).toEqual({ via: "npx-wrapper" });
      } finally {
        await client.stop();
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
