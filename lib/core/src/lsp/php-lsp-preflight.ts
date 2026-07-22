import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveNpmNpxBinary } from "./lsp-binary-resolver-strategies.js";
import { PhpLspConstants, PHP_LSP_MESSAGES } from "./php-lsp-constants.js";
import type { LspPreflightOutcome } from "./lsp-edge-provider-base.js";

const execFileAsync = promisify(execFile);

const NPX_PROBE_TIMEOUT_MS = 5000;

export interface PhpLspPreflightResult extends LspPreflightOutcome {
  markerFileResolvable: boolean;
  lspBinaryResolvable: boolean;
}

function checkMarkerFileResolvable(workspaceRoot: string): boolean {
  return fs.existsSync(path.join(workspaceRoot, "composer.json"));
}

async function probeIntelephenseNpxResolvable(
  workspaceRoot: string,
): Promise<boolean> {
  try {
    await execFileAsync(
      PhpLspConstants.NPX_COMMAND,
      [
        PhpLspConstants.NPX_NO_INSTALL_FLAG,
        PhpLspConstants.PACKAGE_NAME,
        PhpLspConstants.VERSION_FLAG,
      ],
      { cwd: workspaceRoot, timeout: NPX_PROBE_TIMEOUT_MS },
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * PHP's pre-flight readiness gate, using the npm/npx strategy.
 */
export async function checkPhpLspPreflight(
  workspaceRoot: string,
  override?: { binary?: string; args?: string[] },
): Promise<PhpLspPreflightResult> {
  const markerFileResolvable = checkMarkerFileResolvable(workspaceRoot);

  const resolved = resolveNpmNpxBinary(
    workspaceRoot,
    {
      packageName: PhpLspConstants.PACKAGE_NAME,
      defaultArgs: [PhpLspConstants.STDIO_ARG],
    },
    override,
  );
  const lspBinaryResolvable = resolved.locallyResolved
    ? true
    : await probeIntelephenseNpxResolvable(workspaceRoot);

  if (!markerFileResolvable) {
    return {
      markerFileResolvable,
      lspBinaryResolvable,
      ready: false,
      reason: PHP_LSP_MESSAGES.markerFileMissing,
    };
  }
  if (!lspBinaryResolvable) {
    return {
      markerFileResolvable,
      lspBinaryResolvable,
      ready: false,
      reason: PHP_LSP_MESSAGES.binaryUnresolvable,
    };
  }

  return { markerFileResolvable, lspBinaryResolvable, ready: true };
}
