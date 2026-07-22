import fs from "node:fs";
import path from "node:path";
import { resolvePathNativeBinary } from "./lsp-binary-resolver-strategies.js";
import { CsharpLspConstants, CSHARP_LSP_MESSAGES } from "./csharp-lsp-constants.js";
import type { LspPreflightOutcome } from "./lsp-edge-provider-base.js";

export interface CsharpLspPreflightResult extends LspPreflightOutcome {
  markerFileResolvable: boolean;
  lspBinaryResolvable: boolean;
}

function checkMarkerFileResolvable(workspaceRoot: string): boolean {
  try {
    const files = fs.readdirSync(workspaceRoot);
    return files.some(
      (file) => file.endsWith(".sln") || file.endsWith(".csproj"),
    );
  } catch {
    return false;
  }
}

/**
 * C#'s pre-flight readiness gate, using the PATH-native resolution strategy.
 */
export async function checkCsharpLspPreflight(
  workspaceRoot: string,
  override?: { binary?: string; args?: string[] },
): Promise<CsharpLspPreflightResult> {
  const markerFileResolvable = checkMarkerFileResolvable(workspaceRoot);

  const resolved = await resolvePathNativeBinary(
    {
      binaryName: CsharpLspConstants.BINARY_NAME,
      defaultArgs: CsharpLspConstants.DEFAULT_ARGS as unknown as string[],
    },
    override,
  );

  const lspBinaryResolvable = resolved.locallyResolved;

  if (!markerFileResolvable) {
    return {
      markerFileResolvable,
      lspBinaryResolvable,
      ready: false,
      reason: CSHARP_LSP_MESSAGES.markerFileMissing,
    };
  }
  if (!lspBinaryResolvable) {
    return {
      markerFileResolvable,
      lspBinaryResolvable,
      ready: false,
      reason: CSHARP_LSP_MESSAGES.binaryUnresolvable,
    };
  }

  return { markerFileResolvable, lspBinaryResolvable, ready: true };
}
