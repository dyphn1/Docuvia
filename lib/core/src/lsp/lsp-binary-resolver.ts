import fs from "node:fs";
import path from "node:path";
import { TsLspConstants } from "./lsp-constants.js";
import { NODE_MODULES_DIR_NAME } from "../discovery/discovery-constants.js";

export interface ResolvedLspBinary {
  command: string;
  args: string[];
  /** `true` when resolved to a real file under `node_modules/.bin` (provably present, no probe
   *  needed); `false` for the `npx --no-install` fallback, whose actual resolvability can only be
   *  known by attempting it (§8c's gate probes it live in that case). */
  locallyResolved: boolean;
  env?: NodeJS.ProcessEnv;
}

/** Windows npm-generated shim extensions for a `node_modules/.bin` entry, tried in order; POSIX
 *  systems only ever produce the extension-less shell shim. */
const WINDOWS_BIN_EXTENSIONS = [".cmd", ".CMD", ".exe", ""];

/** Default `--max-old-space-size` (MB) for the spawned typescript-language-server/tsserver
 *  process, only applied when the caller's own environment doesn't already set one. Untuned --
 *  a generous round number well above Node's own auto-computed default, not measured against a
 *  specific vscode-scale ceiling; re-tune (or make config-overridable) if real usage shows it's
 *  insufficient or wasteful. Root cause: tsserver OOM-aborting (exit 134/SIGABRT) partway
 *  through a large Tier B batch against a real vscode checkout (roadmap item 28). */
const DEFAULT_TS_MAX_OLD_SPACE_SIZE_MB = 4096;

/** Builds an env override that raises tsserver's heap ceiling via NODE_OPTIONS -- unless the
 *  caller's own environment already sets --max-old-space-size itself, in which case this
 *  returns undefined and leaves the caller's env untouched entirely (respecting an explicit
 *  user choice, same "config-overridable" spirit as binaryOverride/argsOverride elsewhere in
 *  this file). When NODE_OPTIONS is already set to something else (e.g. --stack-trace-limit),
 *  the new flag is appended, not a replacement. */
function buildHeapSizeEnvOverride(): NodeJS.ProcessEnv | undefined {
  const existing = process.env.NODE_OPTIONS ?? "";
  if (existing.includes("--max-old-space-size")) return undefined;
  const flag = `--max-old-space-size=${DEFAULT_TS_MAX_OLD_SPACE_SIZE_MB}`;
  return {
    ...process.env,
    NODE_OPTIONS: existing ? `${existing} ${flag}` : flag,
  };
}

function resolveLocalBinaryPath(workspaceRoot: string): string | undefined {
  const binDir = path.join(workspaceRoot, NODE_MODULES_DIR_NAME, ".bin");
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
      env: buildHeapSizeEnvOverride(),
    };
  }

  const local = resolveLocalBinaryPath(workspaceRoot);
  if (local) {
    return {
      command: local,
      args: [TsLspConstants.STDIO_ARG],
      locallyResolved: true,
      env: buildHeapSizeEnvOverride(),
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
    env: buildHeapSizeEnvOverride(),
  };
}
