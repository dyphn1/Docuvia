import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { checkRustLspPreflight } from "./rust-lsp-preflight.js";
import {
  resolvePathNativeBinary,
  probeBinaryVersionSpawnable,
} from "./lsp-binary-resolver-strategies.js";

vi.mock("./lsp-binary-resolver-strategies.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("./lsp-binary-resolver-strategies.js")
    >();
  return {
    ...actual,
    resolvePathNativeBinary: vi.fn(actual.resolvePathNativeBinary),
    probeBinaryVersionSpawnable: vi.fn(actual.probeBinaryVersionSpawnable),
  };
});

describe("checkRustLspPreflight()", () => {
  let workspaceRoot: string;

  beforeEach(() => {
    workspaceRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "docuvia-rustlsp-preflight-"),
    );
    vi.restoreAllMocks();
    // Default the live spawn probe to "spawnable" so tests exercise the resolve path; the
    // rustup-proxy case (locally resolved but not actually spawnable) is covered explicitly
    // by the dedicated case below.
    vi.mocked(probeBinaryVersionSpawnable).mockResolvedValue(true);
  });

  afterEach(() => {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  });

  it("reports not ready with a reason when no Cargo.toml is present", async () => {
    const result = await checkRustLspPreflight(workspaceRoot);

    expect(result.markerFileResolvable).toBe(false);
    expect(result.ready).toBe(false);
    expect(result.reason).toBeTruthy();
  });

  it("reports not ready when Cargo.toml is present but rust-analyzer binary cannot be found", async () => {
    fs.writeFileSync(path.join(workspaceRoot, "Cargo.toml"), "[package]\n");

    // Simulate rust-analyzer not being resolvable on PATH, regardless of what's actually
    // installed on the machine running this test.
    vi.mocked(resolvePathNativeBinary).mockResolvedValueOnce({
      command: "rust-analyzer",
      args: [],
      locallyResolved: false,
    });

    const result = await checkRustLspPreflight(workspaceRoot);

    expect(result.markerFileResolvable).toBe(true);
    expect(result.lspBinaryResolvable).toBe(false);
    expect(result.ready).toBe(false);
    expect(result.reason).toMatch(/rust-analyzer is not resolvable/);
    expect(probeBinaryVersionSpawnable).not.toHaveBeenCalled();
  });

  it("is ready when Cargo.toml is present and the binary override resolves AND spawns (a real `--version` round-trip)", async () => {
    fs.writeFileSync(path.join(workspaceRoot, "Cargo.toml"), "[package]\n");

    const result = await checkRustLspPreflight(workspaceRoot, {
      binary: "/fake/path/to/rust-analyzer",
    });

    expect(result.markerFileResolvable).toBe(true);
    expect(result.lspBinaryResolvable).toBe(true);
    expect(result.lspBinarySpawnable).toBe(true);
    expect(result.ready).toBe(true);
    // User override: probed WITHOUT a basename allowlist (the user consented to that command).
    expect(probeBinaryVersionSpawnable).toHaveBeenCalledWith(
      "/fake/path/to/rust-analyzer",
      expect.any(Number),
      undefined,
    );
  });

  it("reports not ready when the resolved rust-analyzer fails its live spawn probe -- the rustup-proxy-without-component case (resolvable on PATH, `Unknown binary` at spawn)", async () => {
    fs.writeFileSync(path.join(workspaceRoot, "Cargo.toml"), "[package]\n");

    // `command -v` finds rustup's rust-analyzer *proxy* in ~/.cargo/bin, so resolution
    // succeeds -- but spawning it errors because the component isn't installed.
    vi.mocked(resolvePathNativeBinary).mockResolvedValueOnce({
      command: "/home/runner/.cargo/bin/rust-analyzer",
      args: [],
      locallyResolved: true,
    });
    vi.mocked(probeBinaryVersionSpawnable).mockResolvedValue(false);

    const result = await checkRustLspPreflight(workspaceRoot);

    expect(result.markerFileResolvable).toBe(true);
    expect(result.lspBinaryResolvable).toBe(true);
    expect(result.lspBinarySpawnable).toBe(false);
    expect(result.ready).toBe(false);
    expect(result.reason).toMatch(/cannot be spawned/);
    // Auto-resolved (not an override): probed under the rust-analyzer basename allowlist.
    expect(probeBinaryVersionSpawnable).toHaveBeenCalledWith(
      "/home/runner/.cargo/bin/rust-analyzer",
      expect.any(Number),
      ["rust-analyzer"],
    );
  });

  it("passes the basename allowlist to the probe for auto-resolved commands so a decoyed resolution never spawns (issue #207)", async () => {
    fs.writeFileSync(path.join(workspaceRoot, "Cargo.toml"), "[package]\n");

    vi.mocked(resolvePathNativeBinary).mockResolvedValueOnce({
      command: "/tmp/decoy/not-rust-analyzer",
      args: [],
      locallyResolved: true,
    });
    vi.mocked(probeBinaryVersionSpawnable).mockResolvedValue(false);

    const result = await checkRustLspPreflight(workspaceRoot);

    expect(probeBinaryVersionSpawnable).toHaveBeenCalledWith(
      "/tmp/decoy/not-rust-analyzer",
      expect.any(Number),
      ["rust-analyzer"],
    );
    expect(result.lspBinarySpawnable).toBe(false);
    expect(result.ready).toBe(false);
  });
});
