import { existsSync } from "fs";
import * as path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/** Short timeout for the live `npx --no-install docuvia` resolvability probe (doctor's T5 check,
 *  phase1-decision-integration.md §10d/§7c) -- mirrors `lsp-preflight.ts`'s
 *  `NPX_PROBE_TIMEOUT_MS` precedent: a cheap liveness check, not the real command, so it must
 *  fail fast rather than hang `doctor`. */
const NPX_PROBE_TIMEOUT_MS = 5000;

const NPX_COMMAND = "npx";
const NPX_NO_INSTALL_FLAG = "--no-install";
const DOCUVIA_PACKAGE_NAME = "docuvia";

/** Windows npm-generated shim extensions for a `node_modules/.bin` entry, tried in order; POSIX
 *  systems only ever produce the extension-less shell shim. Mirrors
 *  `lsp-binary-resolver.ts`'s `WINDOWS_BIN_EXTENSIONS`. */
const WINDOWS_BIN_EXTENSIONS = [".cmd", ".CMD", ".exe", ""];

/** A stable marker string that only appears in Docuvia's own CLI usage output (`getUsageText()`'s
 *  `docuvia doctor` line, `artifacts/cli/src/constants/cli-commands.ts`) -- distinguishes "docuvia
 *  ran and printed its usage banner because no subcommand was given" from "npx couldn't resolve
 *  the package at all," both of which can share the same nonzero exit code. */
const DOCUVIA_CLI_OUTPUT_MARKER = "docuvia doctor";

function hasLocalDocuviaBinary(workspaceRoot: string): boolean {
  const binDir = path.join(workspaceRoot, "node_modules", ".bin");
  const candidates =
    process.platform === "win32"
      ? WINDOWS_BIN_EXTENSIONS.map((ext) => `${DOCUVIA_PACKAGE_NAME}${ext}`)
      : [DOCUVIA_PACKAGE_NAME];
  return candidates.some((candidate) =>
    existsSync(path.join(binDir, candidate)),
  );
}

/** Extracts whatever combined stdout/stderr text is available off a resolved or rejected
 *  `execFile` outcome -- `npx --no-install docuvia` (no subcommand) prints its usage banner and
 *  exits 1, so the marker check must inspect output on the rejection path too, not just success. */
function extractCombinedOutput(result: unknown): string {
  if (!result || typeof result !== "object") return "";
  const { stdout, stderr } = result as { stdout?: string; stderr?: string };
  return `${stdout ?? ""}${stderr ?? ""}`;
}

async function probeNpxDocuviaResolvable(
  workspaceRoot: string,
): Promise<boolean> {
  try {
    const result = await execFileAsync(
      NPX_COMMAND,
      [NPX_NO_INSTALL_FLAG, DOCUVIA_PACKAGE_NAME],
      { cwd: workspaceRoot, timeout: NPX_PROBE_TIMEOUT_MS },
    );
    return extractCombinedOutput(result).includes(DOCUVIA_CLI_OUTPUT_MARKER);
  } catch (err) {
    return extractCombinedOutput(err).includes(DOCUVIA_CLI_OUTPUT_MARKER);
  }
}

/**
 * `doctor`'s T5 resolvability probe (phase1-decision-integration.md §10d/§7c): determines whether
 * `docuvia` itself would actually resolve if the post-commit hook fired right now. Mirrors
 * `resolveLspBinary`'s two-tier strategy (§8b precedent, `lib/core/src/lsp/lsp-binary-resolver.ts`):
 * a provably-present local `node_modules/.bin/docuvia` binary short-circuits to `true`; otherwise
 * a live, short-timeout `npx --no-install docuvia` probe classifies resolvability by inspecting
 * the captured combined stdout+stderr for a stable Docuvia-CLI marker -- not the exit code alone
 * (both "npx couldn't resolve the package" and "docuvia ran and printed usage because no command
 * was given" can share the same nonzero exit code). Never throws.
 */
export async function probeDocuviaResolvable(
  workspaceRoot: string,
): Promise<boolean> {
  if (hasLocalDocuviaBinary(workspaceRoot)) return true;
  return probeNpxDocuviaResolvable(workspaceRoot);
}
