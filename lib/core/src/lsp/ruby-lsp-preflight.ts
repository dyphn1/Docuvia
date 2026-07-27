import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { resolvePathNativeBinary } from "./lsp-binary-resolver-strategies.js";
import { RubyLspConstants, RUBY_LSP_MESSAGES } from "./ruby-lsp-constants.js";
import type { LspPreflightOutcome } from "./lsp-edge-provider-base.js";

export interface RubyLspPreflightResult extends LspPreflightOutcome {
  markerFileResolvable: boolean;
  lspBinaryResolvable: boolean;
}

const RUBY_MARKERS = ["Gemfile", "Gemfile.lock"];

function checkMarkerFileResolvable(workspaceRoot: string): boolean {
  return RUBY_MARKERS.some((file) =>
    fs.existsSync(path.join(workspaceRoot, file)),
  );
}

/** Well-known `ruby-lsp` install locations beyond `PATH`: rbenv's shim dir and RVM's bin dir --
 *  the two most common Ruby version managers on macOS/Linux, both of which install gem binaries
 *  outside a location a freshly opened (non-login) shell reliably has on `PATH`. Windows-native
 *  Ruby (RubyInstaller) has no equivalent well-known extra dir -- its installer already puts gem
 *  binaries on `PATH`. */
function getRubyLspInstallDirs(): string[] {
  if (process.platform === "win32") return [];
  const home = os.homedir();
  return [path.join(home, ".rbenv", "shims"), path.join(home, ".rvm", "bin")];
}

/**
 * Ruby's pre-flight readiness gate, using the PATH-native resolution strategy.
 */
export async function checkRubyLspPreflight(
  workspaceRoot: string,
  override?: { binary?: string; args?: string[] },
): Promise<RubyLspPreflightResult> {
  const markerFileResolvable = checkMarkerFileResolvable(workspaceRoot);

  const resolved = await resolvePathNativeBinary(
    {
      binaryName: RubyLspConstants.BINARY_NAME,
      defaultArgs: RubyLspConstants.DEFAULT_ARGS as unknown as string[],
      extraCandidateDirs: getRubyLspInstallDirs(),
    },
    override,
  );

  const lspBinaryResolvable = resolved.locallyResolved;

  if (!markerFileResolvable) {
    return {
      markerFileResolvable,
      lspBinaryResolvable,
      ready: false,
      reason: RUBY_LSP_MESSAGES.markerFileMissing,
    };
  }
  if (!lspBinaryResolvable) {
    return {
      markerFileResolvable,
      lspBinaryResolvable,
      ready: false,
      reason: RUBY_LSP_MESSAGES.binaryUnresolvable,
    };
  }

  return { markerFileResolvable, lspBinaryResolvable, ready: true };
}
