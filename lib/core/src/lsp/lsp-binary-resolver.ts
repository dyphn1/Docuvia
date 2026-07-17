import fs from "node:fs";
import path from "node:path";
import { TsLspConstants } from "./lsp-constants.js";

export interface ResolvedLspBinary {
  command: string;
  args: string[];
  /** `true` when resolved to a real file under `node_modules/.bin` (provably present, no probe
   *  needed); `false` for the `npx --no-install` fallback, whose actual resolvability can only be
   *  known by attempting it (§8c's gate probes it live in that case). */
  locallyResolved: boolean;
}

/** Windows npm-generated shim extensions for a `node_modules/.bin` entry, tried in order; POSIX
 *  systems only ever produce the extension-less shell shim. */
const WINDOWS_BIN_EXTENSIONS = [".cmd", ".CMD", ".exe", ""];

function resolveLocalBinaryPath(workspaceRoot: string): string | undefined {
  const binDir = path.join(workspaceRoot, "node_modules", ".bin");
  const candidates =
    process.platform === "win32"
      ? WINDOWS_BIN_EXTENSIONS.map(
          (ext) => `${TsLspConstants.PACKAGE_NAME}${ext}`,
        )
      : [TsLspConstants.PACKAGE_NAME];

  for (const candidate of candidates) {
    const full = path.join(binDir, candidate);
    if (fs.existsSync(full)) return full;
  }
  return undefined;
}

/**
 * Resolves the `typescript-language-server` binary (phase1-decision-integration.md §8b's D1
 * Provider 1): an explicit override first (config-overridable, e.g. pointing tests at a fixture
 * server), then `<workspaceRoot>/node_modules/.bin`, then `npx --no-install` as the last resort
 * (works when the package is hoisted to a workspace root docuvia isn't running from, or installed
 * but not directly linked). Never falls back to a bundled copy — there isn't one.
 */
export function resolveLspBinary(
  workspaceRoot: string,
  override?: { binary?: string; args?: string[] },
): ResolvedLspBinary {
  if (override?.binary) {
    return {
      command: override.binary,
      args: override.args ?? [TsLspConstants.STDIO_ARG],
      locallyResolved: true,
    };
  }

  const local = resolveLocalBinaryPath(workspaceRoot);
  if (local) {
    return {
      command: local,
      args: [TsLspConstants.STDIO_ARG],
      locallyResolved: true,
    };
  }

  return {
    command: TsLspConstants.NPX_COMMAND,
    args: [
      TsLspConstants.NPX_NO_INSTALL_FLAG,
      TsLspConstants.PACKAGE_NAME,
      TsLspConstants.STDIO_ARG,
    ],
    locallyResolved: false,
  };
}
