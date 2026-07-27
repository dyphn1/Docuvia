import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { resolvePathNativeBinary } from "./lsp-binary-resolver-strategies.js";
import { JavaLspConstants, JAVA_LSP_MESSAGES } from "./java-lsp-constants.js";
import type { LspPreflightOutcome } from "./lsp-edge-provider-base.js";

export interface JavaLspPreflightResult extends LspPreflightOutcome {
  markerFileResolvable: boolean;
  lspBinaryResolvable: boolean;
}

const JAVA_MARKERS = ["pom.xml", "build.gradle"];

function checkMarkerFileResolvable(workspaceRoot: string): boolean {
  return JAVA_MARKERS.some((file) =>
    fs.existsSync(path.join(workspaceRoot, file)),
  );
}

/** Well-known `jdtls` install locations beyond `PATH`: Homebrew's prefix on macOS, common
 *  manual-install/package-manager prefixes on Linux, and Scoop/Chocolatey's bin dirs on Windows
 *  -- jdtls has no official standalone installer, so most non-IDE-bundled installs land in one of
 *  these without ever touching `PATH`. */
function getJdtlsInstallDirs(): string[] {
  if (process.platform === "win32") {
    return [
      path.join(os.homedir(), "scoop", "shims"),
      path.join(
        process.env.ChocolateyInstall ?? "C:\\ProgramData\\chocolatey",
        "bin",
      ),
    ];
  }
  if (process.platform === "darwin") {
    return ["/opt/homebrew/bin", "/usr/local/bin"];
  }
  return [
    "/usr/local/bin",
    "/usr/bin",
    path.join(os.homedir(), ".local", "share", "jdtls", "bin"),
  ];
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
      extraCandidateDirs: getJdtlsInstallDirs(),
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
