import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ConfigFilenames } from "../discovery/discovery-constants.js";
import { resolvePathNativeBinary } from "./lsp-binary-resolver-strategies.js";
import { GoLspConstants, GO_LSP_MESSAGES } from "./go-lsp-constants.js";
import type { LspPreflightOutcome } from "./lsp-edge-provider-base.js";

const execFileAsync = promisify(execFile);

const PROBE_TIMEOUT_MS = 5000;

export interface GoLspPreflightResult extends LspPreflightOutcome {
  markerFileResolvable: boolean;
  lspBinaryResolvable: boolean;
}

function checkMarkerFileResolvable(workspaceRoot: string): boolean {
  return fs.existsSync(path.join(workspaceRoot, ConfigFilenames.GO_MOD));
}

/** Live probe to verify the gopls binary can actually execute -- runs `gopls version`. */
async function probeGoplsPathResolvable(
  command: string,
  args: string[],
): Promise<boolean> {
  try {
    await execFileAsync(command, [...args, GoLspConstants.VERSION_FLAG], {
      timeout: PROBE_TIMEOUT_MS,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Go's pre-flight readiness gate, mirroring `python-lsp-preflight.ts`'s structure
 * but using the PATH-native resolution strategy.
 */
export async function checkGoLspPreflight(
  workspaceRoot: string,
  override?: { binary?: string; args?: string[] },
): Promise<GoLspPreflightResult> {
  const markerFileResolvable = checkMarkerFileResolvable(workspaceRoot);

  const resolved = await resolvePathNativeBinary(
    {
      binaryName: GoLspConstants.BINARY_NAME,
      defaultArgs: GoLspConstants.DEFAULT_ARGS as unknown as string[],
    },
    override,
  );

  // If locallyResolved is true, it means it was found on PATH or via extraDirs or override.
  const lspBinaryResolvable = resolved.locallyResolved;

  if (!markerFileResolvable) {
    return {
      markerFileResolvable,
      lspBinaryResolvable,
      ready: false,
      reason: GO_LSP_MESSAGES.markerFileMissing,
    };
  }
  if (!lspBinaryResolvable) {
    return {
      markerFileResolvable,
      lspBinaryResolvable,
      ready: false,
      reason: GO_LSP_MESSAGES.binaryUnresolvable,
    };
  }

  return { markerFileResolvable, lspBinaryResolvable, ready: true };
}
