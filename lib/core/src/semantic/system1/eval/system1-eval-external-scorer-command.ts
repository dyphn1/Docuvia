import { accessSync, constants, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { SYSTEM1_EVAL_SCORER_INTERPRETER_ALLOWLIST } from "./system1-eval-constants.js";

export interface System1ExternalScorerCommandInput {
  readonly command: string;
  readonly args: readonly string[];
  readonly workingDirectory: string;
  readonly containmentRoot: string;
}

export interface System1ExternalScorerCommand {
  readonly executable: string;
  readonly args: readonly string[];
  readonly workingDirectory: string;
}

const WINDOWS_EXECUTABLE_EXTENSIONS = [".exe", ".cmd", ".bat", ".com"];

function hasNul(value: string): boolean {
  return value.includes("\0");
}

function realDirectory(directory: string): string | null {
  if (!path.isAbsolute(directory) || hasNul(directory)) return null;
  try {
    const resolved = realpathSync(directory);
    return statSync(resolved).isDirectory() ? resolved : null;
  } catch {
    return null;
  }
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function executableFile(candidate: string): string | null {
  try {
    const resolved = realpathSync(candidate);
    if (!statSync(resolved).isFile()) return null;
    if (process.platform !== "win32") accessSync(resolved, constants.X_OK);
    return resolved;
  } catch {
    return null;
  }
}

function interpreterName(command: string): string {
  const base = path.basename(command).toLowerCase();
  const extension = path.extname(base);
  return WINDOWS_EXECUTABLE_EXTENSIONS.includes(extension)
    ? base.slice(0, -extension.length)
    : base;
}

function isAllowlistedInterpreter(command: string): boolean {
  return SYSTEM1_EVAL_SCORER_INTERPRETER_ALLOWLIST.includes(
    interpreterName(command),
  );
}

/** Resolves a bare interpreter name through PATH without a shell. */
function resolveOnPath(name: string): string | null {
  const extensions =
    process.platform === "win32"
      ? ["", ...WINDOWS_EXECUTABLE_EXTENSIONS]
      : [""];
  for (const directory of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!path.isAbsolute(directory)) continue;
    for (const extension of extensions) {
      const resolved = executableFile(path.join(directory, name + extension));
      if (resolved) return resolved;
    }
  }
  return null;
}

function resolveExecutable(command: string, root: string): string | null {
  if (command.length === 0 || hasNul(command)) return null;
  if (!path.isAbsolute(command)) {
    // Relative paths would resolve against a caller-chosen cwd; only bare interpreter names
    // from the allowlist may use PATH lookup.
    if (command !== path.basename(command)) return null;
    return isAllowlistedInterpreter(command) ? resolveOnPath(command) : null;
  }
  const resolved = executableFile(command);
  if (!resolved) return null;
  return isAllowlistedInterpreter(resolved) || isInside(root, resolved)
    ? resolved
    : null;
}

/**
 * Validates an external scorer invocation before anything is spawned (#563). The working
 * directory must be an existing directory inside the containment root, the executable must be an
 * allowlisted interpreter or an absolute executable inside that root, and no value may carry NUL.
 * Returns null when the invocation is rejected.
 */
export function resolveSystem1ExternalScorerCommand(
  input: System1ExternalScorerCommandInput,
): System1ExternalScorerCommand | null {
  const root = realDirectory(input.containmentRoot);
  const workingDirectory = realDirectory(input.workingDirectory);
  if (!root || !workingDirectory || !isInside(root, workingDirectory))
    return null;
  if (input.args.some((arg) => typeof arg !== "string" || hasNul(arg)))
    return null;
  const executable = resolveExecutable(input.command, root);
  if (!executable) return null;
  return { executable, args: [...input.args], workingDirectory };
}
