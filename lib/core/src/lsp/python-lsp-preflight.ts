import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ConfigFilenames } from "../discovery/discovery-constants.js";
import { resolveNpmNpxBinary } from "./lsp-binary-resolver-strategies.js";
import { PyLspConstants, PY_LSP_MESSAGES } from "./python-lsp-constants.js";
import type { LspPreflightOutcome } from "./lsp-edge-provider-base.js";

const execFileAsync = promisify(execFile);

/** Short timeout for the live `npx --no-install ... --version` probe -- a cheap liveness check,
 *  not the batch itself, so it must fail fast rather than hang the gate. Mirrors
 *  `lsp-preflight.ts`'s `NPX_PROBE_TIMEOUT_MS` for TS. */
const NPX_PROBE_TIMEOUT_MS = 5000;

export interface PythonLspPreflightResult extends LspPreflightOutcome {
  markerFileResolvable: boolean;
  lspBinaryResolvable: boolean;
}

/** Python's own ecosystem marker files (Finding D) -- reuses the already-declared
 *  `ConfigFilenames.PYPROJECT_TOML`/`REQUIREMENTS_TXT` constants
 *  (`lib/core/src/discovery/discovery-constants.ts`) rather than redeclaring them. Unlike TS's
 *  `node_modules` check, Python projects have no npm-ecosystem marker of their own -- pyright
 *  being npm-distributed is an implementation detail of *this* provider's binary resolution, not
 *  something a Python project's own layout implies. */
const PYTHON_MARKER_CANDIDATES = [
  ConfigFilenames.PYPROJECT_TOML,
  ConfigFilenames.REQUIREMENTS_TXT,
];

function checkMarkerFileResolvable(workspaceRoot: string): boolean {
  return PYTHON_MARKER_CANDIDATES.some((name) =>
    fs.existsSync(path.join(workspaceRoot, name)),
  );
}

/** Live probe for the `npx --no-install` fallback case (mirrors `lsp-preflight.ts`'s
 *  `probeNpxResolvable`) -- probes the `pyright` package's own CLI (`--version`), not
 *  `pyright-langserver` directly: the langserver binary has no `--version` flag and would just
 *  sit waiting on stdio until this probe's timeout, misreporting a perfectly resolvable install
 *  as unresolvable. Probing the package name is sufficient to know whether `npx` can find it. */
async function probePyrightNpxResolvable(
  workspaceRoot: string,
): Promise<boolean> {
  try {
    await execFileAsync(
      PyLspConstants.NPX_COMMAND,
      [
        PyLspConstants.NPX_NO_INSTALL_FLAG,
        PyLspConstants.PACKAGE_NAME,
        PyLspConstants.VERSION_FLAG,
      ],
      { cwd: workspaceRoot, timeout: NPX_PROBE_TIMEOUT_MS },
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Python's pre-flight readiness gate (multi-language-lsp-support plan, Finding D), mirroring
 * `lsp-preflight.ts`'s `checkLspPreflight()` shape for TS: environment readiness (a Python
 * ecosystem marker file present, LSP binary resolvable). No `node_modules`-presence check here --
 * unlike TS/JS, a Python project has no npm-ecosystem marker of its own.
 */
export async function checkPythonLspPreflight(
  workspaceRoot: string,
  override?: { binary?: string; args?: string[] },
): Promise<PythonLspPreflightResult> {
  const markerFileResolvable = checkMarkerFileResolvable(workspaceRoot);

  const resolved = resolveNpmNpxBinary(
    workspaceRoot,
    {
      packageName: PyLspConstants.PACKAGE_NAME,
      binaryName: PyLspConstants.BINARY_NAME,
      defaultArgs: [PyLspConstants.STDIO_ARG],
    },
    override,
  );
  const lspBinaryResolvable = resolved.locallyResolved
    ? true
    : await probePyrightNpxResolvable(workspaceRoot);

  if (!markerFileResolvable) {
    return {
      markerFileResolvable,
      lspBinaryResolvable,
      ready: false,
      reason: PY_LSP_MESSAGES.markerFileMissing,
    };
  }
  if (!lspBinaryResolvable) {
    return {
      markerFileResolvable,
      lspBinaryResolvable,
      ready: false,
      reason: PY_LSP_MESSAGES.binaryUnresolvable,
    };
  }

  return { markerFileResolvable, lspBinaryResolvable, ready: true };
}
