import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolvePathNativeBinary } from "./lsp-binary-resolver-strategies.js";
import { CppLspConstants, CPP_LSP_MESSAGES } from "./cpp-lsp-constants.js";
import type { LspPreflightOutcome } from "./lsp-edge-provider-base.js";

const execFileAsync = promisify(execFile);

const PROBE_TIMEOUT_MS = 5000;

export interface CppLspPreflightResult extends LspPreflightOutcome {
  markerFileResolvable: boolean;
  lspBinaryResolvable: boolean;
}

const CPP_MARKERS = ["compile_commands.json", "CMakeLists.txt"];

function checkMarkerFileResolvable(workspaceRoot: string): boolean {
  return CPP_MARKERS.some((file) => fs.existsSync(path.join(workspaceRoot, file)));
}

async function probeClangdPathResolvable(
  command: string,
  args: string[],
): Promise<boolean> {
  try {
    await execFileAsync(command, [...args, CppLspConstants.VERSION_FLAG], {
      timeout: PROBE_TIMEOUT_MS,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * C/C++'s pre-flight readiness gate, using the PATH-native resolution strategy.
 */
export async function checkCppLspPreflight(
  workspaceRoot: string,
  override?: { binary?: string; args?: string[] },
): Promise<CppLspPreflightResult> {
  const markerFileResolvable = checkMarkerFileResolvable(workspaceRoot);

  const resolved = await resolvePathNativeBinary(
    {
      binaryName: CppLspConstants.BINARY_NAME,
      defaultArgs: CppLspConstants.DEFAULT_ARGS as unknown as string[],
    },
    override,
  );

  const lspBinaryResolvable = resolved.locallyResolved;

  if (!markerFileResolvable) {
    return {
      markerFileResolvable,
      lspBinaryResolvable,
      ready: false,
      reason: CPP_LSP_MESSAGES.markerFileMissing,
    };
  }
  if (!lspBinaryResolvable) {
    return {
      markerFileResolvable,
      lspBinaryResolvable,
      ready: false,
      reason: CPP_LSP_MESSAGES.binaryUnresolvable,
    };
  }

  return { markerFileResolvable, lspBinaryResolvable, ready: true };
}
