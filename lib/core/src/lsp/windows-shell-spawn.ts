import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Extensions Windows can only execute through a shell (`cmd.exe`/PowerShell), never directly via
 *  `CreateProcess` -- exactly the extensions `resolveLspBinary()` tries first for a `node_modules/
 *  .bin` shim (`.cmd`, and `.bat`/`.ps1` for completeness). Anything else -- including a bare,
 *  unresolvable command name -- is spawned exactly as before, so the ordinary Windows `ENOENT`
 *  spawn-failure path (an immediate `error` event, no shell involved) is untouched. */
const WINDOWS_SHELL_ONLY_EXTENSIONS = new Set([".cmd", ".bat", ".ps1"]);

/** Bare command names this codebase spawns directly (never through a resolved `node_modules/.bin`
 *  path, so they never carry a `.cmd`/`.ps1` extension for the check above to catch) that are
 *  nonetheless *also* only ever installed as a `.cmd`/`.ps1` shim on Windows -- `npx` is the
 *  `npx --no-install <package>` fallback every npm/npx-strategy language's binary resolver falls
 *  back to when no local copy is found. Plain `child_process.spawn()`/`execFile()` cannot exec
 *  these directly on Windows -- confirmed by direct testing during the multi-language-lsp-support
 *  plan's Slice 1 (Python): a real `npx --no-install --package pyright pyright-langserver --stdio`
 *  spawn failed with a bare `ENOENT` on Windows before the runtime client's fix. The preflight
 *  probe (`lsp-preflight.ts`'s `probeNpxResolvable`) hit the identical bug independently -- it
 *  called a bare `execFileAsync("npx", ...)` with no shell wrapper at all, so on Windows it always
 *  reported npx as unresolvable even when it genuinely wasn't (live-reproduced 2026-07-29: a
 *  manual `npx --no-install typescript-language-server --version` succeeded from the same cwd the
 *  preflight probe had just reported ENOENT for). Both call sites now share this module instead of
 *  maintaining two copies of the same Windows-shim-resolution logic that can drift apart. */
const WINDOWS_SHELL_ONLY_BARE_COMMANDS = new Set(["npx"]);

/** `true` when `command` can only be executed through a shell on Windows (a `.cmd`/`.bat`/`.ps1`
 *  path, or a bare name from `WINDOWS_SHELL_ONLY_BARE_COMMANDS`) -- always `false` off Windows. */
export function needsWindowsShellWrapper(command: string): boolean {
  if (process.platform !== "win32") return false;
  return (
    WINDOWS_SHELL_ONLY_EXTENSIONS.has(path.extname(command).toLowerCase()) ||
    WINDOWS_SHELL_ONLY_BARE_COMMANDS.has(command.toLowerCase())
  );
}

/** Double-quotes a single `cmd.exe` command-line token, doubling any embedded `"` (cmd.exe's own
 *  escaping convention) -- used only for the narrow `.cmd`/`.bat`/`.ps1`/bare-shell-command case,
 *  each argument individually, never a blanket unescaped `shell: true` + array-args (that pattern
 *  -- the one Node's `DEP0190` deprecation warns about -- concatenates args into the shell string
 *  unescaped, which is a real injection risk the moment any arg contains a shell metacharacter). */
export function quoteForWindowsShell(token: string): string {
  return `"${token.replace(/"/g, '""')}"`;
}

/** Short timeout for the live `where` probe below -- a cheap PATH lookup, not the batch itself. */
const WHERE_PROBE_TIMEOUT_MS = 5000;

/**
 * Resolves a bare command name (only ever `"npx"` today) to its actual full path via a live
 * `where` probe on Windows -- necessary because invoking a bare-named `.cmd` shim (`npx`) through
 * a `cmd.exe shell: true` wrapper triggers a real, separately-confirmed npm/npx bug: the shim's
 * own internal bootstrapping re-resolves one of its own files (`node_modules/npm/bin/
 * npm-prefix.js`) relative to the *spawned process's `cwd`* instead of its own install directory,
 * when it was reached via a bare-name shell PATH search rather than its full path -- reproduced
 * directly during the multi-language-lsp-support plan's Slice 1 (a real `pyright-langserver`
 * spawn exited immediately with `MODULE_NOT_FOUND` for a path relative to `cwd`, every time
 * `workspaceRoot` had no such `node_modules/npm/bin/...` file, i.e. always); invoking the shell
 * wrapper with `npx`'s already-resolved full path sidesteps the bug entirely (confirmed fixed by
 * the same direct reproduction). Falls back to the bare command name unresolved if the probe
 * itself fails (e.g. `npx` genuinely isn't on `PATH` at all) -- preserves an honest failure in
 * that case, just surfaced via the shell's own "command not found" exit instead of a synchronous
 * Node `ENOENT` `error` event.
 */
export async function resolveWindowsBareCommandPath(
  command: string,
  env: NodeJS.ProcessEnv | undefined,
): Promise<string> {
  try {
    const { stdout } = await execFileAsync("where", [command], {
      timeout: WHERE_PROBE_TIMEOUT_MS,
      env,
    });
    const first = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0);
    return first ?? command;
  } catch {
    return command;
  }
}

/** Bare command names from `WINDOWS_SHELL_ONLY_BARE_COMMANDS` need the extra `where`-resolution
 *  step above; a resolved `.cmd`/`.bat`/`.ps1` path from `node_modules/.bin` does not (it's
 *  already a full path, not a bare PATH-searched name). Exported so callers can decide whether to
 *  pay for the `where` probe without duplicating the bare-command-name set. */
export function isWindowsShellOnlyBareCommand(command: string): boolean {
  return WINDOWS_SHELL_ONLY_BARE_COMMANDS.has(command.toLowerCase());
}

/**
 * Resolves `command`/`args` into whatever a Windows-shell-wrapped spawn needs: the actual command
 * string to run (bare commands like `npx` resolved to a full path first, to sidestep the npm-
 * bootstrap-relative-to-cwd bug `resolveWindowsBareCommandPath` documents) and each token quoted
 * for `cmd.exe`. Callers pass the result as `spawn`/`execFile`'s `file` argument with `shell: true`
 * and no separate `args` (the whole command line is already joined) -- mirrors what
 * `LspJsonRpcClient.start()` already does, now shared with `lsp-preflight.ts`'s npx probe so the
 * two call sites can't drift apart on how they resolve the exact same Windows shim problem.
 */
export async function buildWindowsShellCommandLine(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv | undefined,
): Promise<string> {
  const resolvedCommand = isWindowsShellOnlyBareCommand(command)
    ? await resolveWindowsBareCommandPath(command, env)
    : command;
  return [resolvedCommand, ...args].map(quoteForWindowsShell).join(" ");
}
