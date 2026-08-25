import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ConfigFilenames } from "../discovery/discovery-constants.js";
import {
  resolvePathNativeBinary,
  probeBinaryVersionSpawnable,
} from "./lsp-binary-resolver-strategies.js";
import { RustLspConstants, RUST_LSP_MESSAGES } from "./rust-lsp-constants.js";
import type { LspPreflightOutcome } from "./lsp-edge-provider-base.js";

export interface RustLspPreflightResult extends LspPreflightOutcome {
  markerFileResolvable: boolean;
  lspBinaryResolvable: boolean;
  /** `true` when the resolved `command` actually spawned (a real `--version` round-trip) --
   *  distinct from `lspBinaryResolvable`, which only means the binary *file* was found. Pulled
   *  apart so a rustup-proxy rust-analyzer (resolvable on PATH, `Unknown binary` on spawn) is
   *  reported honestly instead of passing the gate and failing the whole batch at runtime. */
  lspBinarySpawnable: boolean;
}

function checkMarkerFileResolvable(workspaceRoot: string): boolean {
  return fs.existsSync(path.join(workspaceRoot, ConfigFilenames.CARGO_TOML));
}

function getCargoBinDir(): string {
  return path.join(
    process.env.CARGO_HOME ?? path.join(os.homedir(), ".cargo"),
    "bin",
  );
}

/** Short timeout for the live `--version` spawn probe -- a cheap liveness check mirrored from the
 *  TS provider's `NPX_PROBE_TIMEOUT_MS` (a gate check, not the batch itself, so it must fail fast
 *  rather than hang). */
const RA_PROBE_TIMEOUT_MS = 5000;

/** Live spawn probe: runs the resolved `command` with `--version` to prove it can actually be
 *  spawned. `resolvePathNativeBinary` can report a *file* that rustup itself rejects at spawn
 *  time (its rust-analyzer proxy in `~/.cargo/bin` is a symlink that errors `Unknown binary
 *  'rust-analyzer'` when the component isn't installed) -- so PATH resolution alone is not a
 *  truthful availability signal for Rust. See `probeBinaryVersionSpawnable` in
 *  `lsp-binary-resolver-strategies.ts`.
 *
 *  Auto-resolved commands are probed under the `rust-analyzer` basename allowlist (issue #207):
 *  if a decoyed resolution ever yields an unexpected executable, nothing is spawned and the gate
 *  reports not-spawnable. Explicit user config overrides are exempt -- the user consented to that
 *  exact command. */
export async function probeRustAnalyzerSpawnable(
  command: string,
  allowedBasenames?: readonly string[],
): Promise<boolean> {
  return probeBinaryVersionSpawnable(
    command,
    RA_PROBE_TIMEOUT_MS,
    allowedBasenames,
  );
}

/**
 * Rust's pre-flight readiness gate, using the PATH-native resolution strategy
 * with Cargo's well-known bin dir as an extra candidate, gated on a live spawn probe.
 */
export async function checkRustLspPreflight(
  workspaceRoot: string,
  override?: { binary?: string; args?: string[] },
): Promise<RustLspPreflightResult> {
  const markerFileResolvable = checkMarkerFileResolvable(workspaceRoot);

  const resolved = await resolvePathNativeBinary(
    {
      binaryName: RustLspConstants.BINARY_NAME,
      defaultArgs: RustLspConstants.DEFAULT_ARGS as unknown as string[],
      extraCandidateDirs: [getCargoBinDir()],
    },
    override,
  );

  const lspBinaryResolvable = resolved.locallyResolved;
  const lspBinarySpawnable =
    !lspBinaryResolvable ||
    (await probeRustAnalyzerSpawnable(
      resolved.command,
      // Issue #207: enforce the expected-binary basename allowlist for auto-resolved commands
      // only -- an explicit user override may legitimately point at a differently-named wrapper.
      resolved.fromUserOverride ? undefined : [RustLspConstants.BINARY_NAME],
    ));

  if (!markerFileResolvable) {
    return {
      markerFileResolvable,
      lspBinaryResolvable,
      lspBinarySpawnable,
      ready: false,
      reason: RUST_LSP_MESSAGES.markerFileMissing,
    };
  }
  if (!lspBinaryResolvable) {
    return {
      markerFileResolvable,
      lspBinaryResolvable,
      lspBinarySpawnable,
      ready: false,
      reason: RUST_LSP_MESSAGES.binaryUnresolvable,
    };
  }
  if (!lspBinarySpawnable) {
    return {
      markerFileResolvable,
      lspBinaryResolvable,
      lspBinarySpawnable,
      ready: false,
      reason: RUST_LSP_MESSAGES.binaryNotSpawnable,
    };
  }

  return {
    markerFileResolvable,
    lspBinaryResolvable,
    lspBinarySpawnable,
    ready: true,
  };
}
