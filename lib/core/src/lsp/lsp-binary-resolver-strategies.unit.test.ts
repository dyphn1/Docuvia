import { describe, it, expect, vi, beforeEach } from "vitest";

const execFileMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  execFile: execFileMock,
}));

import { probeBinaryVersionSpawnable } from "./lsp-binary-resolver-strategies.js";

describe("probeBinaryVersionSpawnable()", () => {
  beforeEach(() => {
    execFileMock.mockReset();
    // Callback-style like real execFile (the module promisifies it); invoke the callback with a
    // plausible `--version` stdout.
    execFileMock.mockImplementation((...args: unknown[]) => {
      const cb = args[args.length - 1] as (
        err: Error | null,
        stdout: string,
      ) => void;
      cb(null, "rust-analyzer 1.2.3");
    });
  });

  it("spawns the command and reports spawnable when its basename is allowlisted", async () => {
    const spawnable = await probeBinaryVersionSpawnable(
      "/home/dev/.cargo/bin/rust-analyzer",
      1000,
      ["rust-analyzer"],
    );

    expect(spawnable).toBe(true);
    // promisify appends its own trailing callback arg -- assert only the probe's own arguments.
    const [cmd, args, opts] = execFileMock.mock.calls[0];
    expect(cmd).toBe("/home/dev/.cargo/bin/rust-analyzer");
    expect(args).toEqual(["--version"]);
    expect(opts).toEqual({ timeout: 1000 });
  });

  it("never spawns and reports not-spawnable when the basename is NOT allowlisted (issue #207)", async () => {
    const spawnable = await probeBinaryVersionSpawnable(
      "/tmp/decoy/not-rust-analyzer",
      1000,
      ["rust-analyzer"],
    );

    expect(spawnable).toBe(false);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it("matches Windows-style `.exe` basenames case-insensitively against a bare allowlist entry", async () => {
    const spawnable = await probeBinaryVersionSpawnable(
      "C:\\tools\\RUST-ANALYZER.EXE",
      1000,
      ["rust-analyzer"],
    );

    expect(spawnable).toBe(true);
    expect(execFileMock).toHaveBeenCalled();
  });

  it("probes any command when no allowlist is given (backward-compatible default)", async () => {
    const spawnable = await probeBinaryVersionSpawnable("/tmp/anything-goes");

    expect(spawnable).toBe(true);
    const [cmd, args, opts] = execFileMock.mock.calls[0];
    expect(cmd).toBe("/tmp/anything-goes");
    expect(args).toEqual(["--version"]);
    expect(opts?.timeout).toEqual(expect.any(Number));
  });
});
