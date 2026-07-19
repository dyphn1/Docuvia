import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolveLspBinary } from "./lsp-binary-resolver.js";
import { TsLspConstants, LSP_MESSAGES } from "./lsp-constants.js";
import {
  ConfigFilenames,
  NODE_MODULES_DIR_NAME,
} from "../discovery/discovery-constants.js";

const execFileAsync = promisify(execFile);

/** Short timeout for the live `npx --no-install ... --version` probe (§8c's gate) -- this is a
 *  cheap liveness check, not the batch itself, so it must fail fast rather than hang the gate. */
const NPX_PROBE_TIMEOUT_MS = 5000;

export interface LspPreflightResult {
  nodeModulesPresent: boolean;
  tsconfigResolvable: boolean;
  lspBinaryResolvable: boolean;
  ready: boolean;
  /** Set when `ready` is `false` -- the first failing check, human-readable. */
  reason?: string;
}

const TSCONFIG_CANDIDATES = [
  ConfigFilenames.TSCONFIG_JSON,
  ConfigFilenames.JSCONFIG_JSON,
];

function checkNodeModulesPresent(workspaceRoot: string): boolean {
  return fs.existsSync(path.join(workspaceRoot, NODE_MODULES_DIR_NAME));
}

function checkTsconfigResolvable(workspaceRoot: string): boolean {
  return TSCONFIG_CANDIDATES.some((name) =>
    fs.existsSync(path.join(workspaceRoot, name)),
  );
}

/** Live probe for the `npx --no-install` fallback case (a local `node_modules/.bin` copy is
 *  already provably present via `fs.existsSync`, so only the npx path needs an actual attempt). */
async function probeNpxResolvable(workspaceRoot: string): Promise<boolean> {
  try {
    await execFileAsync(
      TsLspConstants.NPX_COMMAND,
      [
        TsLspConstants.NPX_NO_INSTALL_FLAG,
        TsLspConstants.PACKAGE_NAME,
        TsLspConstants.VERSION_FLAG,
      ],
      { cwd: workspaceRoot, timeout: NPX_PROBE_TIMEOUT_MS },
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * D2's mandatory pre-flight gate for `init`/manual `analyze --escalate-to-lsp`
 * (phase1-decision-integration.md §8c): environment readiness (`node_modules` present, tsconfig
 * resolvable, LSP binary resolvable). Never used by the commit hook (which never runs LSP at
 * all, per §8c's contract rule) -- the pre-push/batch path also skips this gate ("heavy work is
 * allowed" there) and relies on the provider's own `checkAvailability()`/honest-degradation
 * instead, which is a superset of what this function checks.
 */
export async function checkLspPreflight(
  workspaceRoot: string,
  override?: { binary?: string; args?: string[] },
): Promise<LspPreflightResult> {
  const nodeModulesPresent = checkNodeModulesPresent(workspaceRoot);
  const tsconfigResolvable = checkTsconfigResolvable(workspaceRoot);

  const resolved = resolveLspBinary(workspaceRoot, override);
  const lspBinaryResolvable = resolved.locallyResolved
    ? true
    : await probeNpxResolvable(workspaceRoot);

  if (!nodeModulesPresent) {
    return {
      nodeModulesPresent,
      tsconfigResolvable,
      lspBinaryResolvable,
      ready: false,
      reason: LSP_MESSAGES.nodeModulesMissing,
    };
  }
  if (!tsconfigResolvable) {
    return {
      nodeModulesPresent,
      tsconfigResolvable,
      lspBinaryResolvable,
      ready: false,
      reason: LSP_MESSAGES.tsconfigMissing,
    };
  }
  if (!lspBinaryResolvable) {
    return {
      nodeModulesPresent,
      tsconfigResolvable,
      lspBinaryResolvable,
      ready: false,
      reason: LSP_MESSAGES.binaryUnresolvable,
    };
  }

  return {
    nodeModulesPresent,
    tsconfigResolvable,
    lspBinaryResolvable,
    ready: true,
  };
}
