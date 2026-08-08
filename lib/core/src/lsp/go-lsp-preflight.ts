import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ConfigFilenames } from "../discovery/discovery-constants.js";
import { resolvePathNativeBinary } from "./lsp-binary-resolver-strategies.js";
import { GoLspConstants, GO_LSP_MESSAGES } from "./go-lsp-constants.js";
import type { LspPreflightOutcome } from "./lsp-edge-provider-base.js";

export interface GoLspPreflightResult extends LspPreflightOutcome {
  markerFileResolvable: boolean;
  lspBinaryResolvable: boolean;
}

function checkMarkerFileResolvable(workspaceRoot: string): boolean {
  return fs.existsSync(path.join(workspaceRoot, ConfigFilenames.GO_MOD));
}

/** Well-known `gopls` install locations beyond `PATH`: `go install` puts the binary under
 *  `$GOBIN` when set, else `$GOPATH/bin`, else Go's default `~/go/bin` -- a fresh shell (or an
 *  editor/agent spawned before `.profile` re-sourced) frequently doesn't have any of these on
 *  `PATH` yet even though the binary is present. */
function getGoBinDirs(): string[] {
  const dirs: string[] = [];
  if (process.env.GOBIN) dirs.push(process.env.GOBIN);
  if (process.env.GOPATH) dirs.push(path.join(process.env.GOPATH, "bin"));
  dirs.push(path.join(os.homedir(), "go", "bin"));
  return dirs;
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
      extraCandidateDirs: getGoBinDirs(),
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
