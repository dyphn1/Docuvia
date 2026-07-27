import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ConfigFilenames } from "../discovery/discovery-constants.js";
import { resolvePathNativeBinary } from "./lsp-binary-resolver-strategies.js";
import { RustLspConstants, RUST_LSP_MESSAGES } from "./rust-lsp-constants.js";
import type { LspPreflightOutcome } from "./lsp-edge-provider-base.js";

const execFileAsync = promisify(execFile);

const PROBE_TIMEOUT_MS = 5000;

export interface RustLspPreflightResult extends LspPreflightOutcome {
  markerFileResolvable: boolean;
  lspBinaryResolvable: boolean;
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

async function probeRustAnalyzerPathResolvable(
  command: string,
  args: string[],
): Promise<boolean> {
  try {
    await execFileAsync(command, [...args, RustLspConstants.VERSION_FLAG], {
      timeout: PROBE_TIMEOUT_MS,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Rust's pre-flight readiness gate, using the PATH-native resolution strategy
 * with Cargo's well-known bin dir as an extra candidate.
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

  if (!markerFileResolvable) {
    return {
      markerFileResolvable,
      lspBinaryResolvable,
      ready: false,
      reason: RUST_LSP_MESSAGES.markerFileMissing,
    };
  }
  if (!lspBinaryResolvable) {
    return {
      markerFileResolvable,
      lspBinaryResolvable,
      ready: false,
      reason: RUST_LSP_MESSAGES.binaryUnresolvable,
    };
  }

  return { markerFileResolvable, lspBinaryResolvable, ready: true };
}
