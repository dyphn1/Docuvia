import fs from "node:fs";
import path from "node:path";
import { PLATFORM_WIN32 } from "@workspace/contracts";
import { resolvePathNativeBinary } from "./lsp-binary-resolver-strategies.js";
import { CppLspConstants, CPP_LSP_MESSAGES } from "./cpp-lsp-constants.js";
import type { LspPreflightOutcome } from "./lsp-edge-provider-base.js";
import {
  DEFAULT_LSP_NODE_PROCESS,
  type ProcessHostView,
} from "./lsp-process-host.js";

export interface CppLspPreflightResult extends LspPreflightOutcome {
  markerFileResolvable: boolean;
  lspBinaryResolvable: boolean;
}

const CPP_MARKERS = ["compile_commands.json", "CMakeLists.txt"];

function checkMarkerFileResolvable(workspaceRoot: string): boolean {
  return CPP_MARKERS.some((file) =>
    fs.existsSync(path.join(workspaceRoot, file)),
  );
}

/** Well-known `clangd` install locations beyond `PATH`: the official LLVM installer's default
 *  prefix on Windows, and Homebrew's keg-only `llvm` formula prefix on macOS (both Apple Silicon
 *  and Intel) -- `llvm`/`clangd` is keg-only in Homebrew and Windows' LLVM installer doesn't
 *  always add itself to `PATH`, so a real install can still be invisible to a bare PATH probe. */
function getClangdInstallDirs(nodeProcess: ProcessHostView): string[] {
  if (nodeProcess.platform === PLATFORM_WIN32) {
    return [
      path.join(
        nodeProcess.env.ProgramFiles ?? "C:\\Program Files",
        "LLVM",
        "bin",
      ),
    ];
  }
  if (nodeProcess.platform === "darwin") {
    return ["/opt/homebrew/opt/llvm/bin", "/usr/local/opt/llvm/bin"];
  }
  return ["/usr/lib/llvm/bin", "/usr/local/bin"];
}

/**
 * C/C++'s pre-flight readiness gate, using the PATH-native resolution strategy.
 */
export async function checkCppLspPreflight(
  workspaceRoot: string,
  override?: { binary?: string; args?: string[] },
  nodeProcess: ProcessHostView = DEFAULT_LSP_NODE_PROCESS,
): Promise<CppLspPreflightResult> {
  const markerFileResolvable = checkMarkerFileResolvable(workspaceRoot);

  const resolved = await resolvePathNativeBinary(
    {
      binaryName: CppLspConstants.BINARY_NAME,
      defaultArgs: CppLspConstants.DEFAULT_ARGS as unknown as string[],
      extraCandidateDirs: getClangdInstallDirs(nodeProcess),
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
