import fs from "node:fs";
import path from "node:path";
import { resolvePathNativeBinary } from "./lsp-binary-resolver-strategies.js";
import { RubyLspConstants, RUBY_LSP_MESSAGES } from "./ruby-lsp-constants.js";
import type { LspPreflightOutcome } from "./lsp-edge-provider-base.js";

export interface RubyLspPreflightResult extends LspPreflightOutcome {
  markerFileResolvable: boolean;
  lspBinaryResolvable: boolean;
}

const RUBY_MARKERS = ["Gemfile", "Gemfile.lock"];

function checkMarkerFileResolvable(workspaceRoot: string): boolean {
  return RUBY_MARKERS.some((file) => fs.existsSync(path.join(workspaceRoot, file)));
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
