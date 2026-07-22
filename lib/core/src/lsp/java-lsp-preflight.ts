import fs from "node:fs";
import path from "node:path";
import { resolvePathNativeBinary } from "./lsp-binary-resolver-strategies.js";
import { JavaLspConstants, JAVA_LSP_MESSAGES } from "./java-lsp-constants.js";
import type { LspPreflightOutcome } from "./lsp-edge-provider-base.js";

export interface JavaLspPreflightResult extends LspPreflightOutcome {
  markerFileResolvable: boolean;
  lspBinaryResolvable: boolean;
}

const JAVA_MARKERS = ["pom.xml", "build.gradle"];

function checkMarkerFileResolvable(workspaceRoot: string): boolean {
  return JAVA_MARKERS.some((file) => fs.existsSync(path.join(workspaceRoot, file)));
}

/**
 * Java's pre-flight readiness gate, using the PATH-native resolution strategy.
 */
export async function checkJavaLspPreflight(
  workspaceRoot: string,
  override?: { binary?: string; args?: string[] },
): Promise<JavaLspPreflightResult> {
  const markerFileResolvable = checkMarkerFileResolvable(workspaceRoot);

  const resolved = await resolvePathNativeBinary(
    {
      binaryName: JavaLspConstants.BINARY_NAME,
      defaultArgs: JavaLspConstants.DEFAULT_ARGS as unknown as string[],
    },
    override,
  );

  const lspBinaryResolvable = resolved.locallyResolved;

  if (!markerFileResolvable) {
    return {
      markerFileResolvable,
      lspBinaryResolvable,
      ready: false,
      reason: JAVA_LSP_MESSAGES.markerFileMissing,
    };
  }
  if (!lspBinaryResolvable) {
    return {
      markerFileResolvable,
      lspBinaryResolvable,
      ready: false,
      reason: JAVA_LSP_MESSAGES.binaryUnresolvable,
    };
  }

  return { markerFileResolvable, lspBinaryResolvable, ready: true };
}
