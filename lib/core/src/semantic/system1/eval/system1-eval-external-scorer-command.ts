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
  readonly env: NodeJS.ProcessEnv;
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
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
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

type ResolvedExecutable = {
  readonly path: string;
  readonly interpreter: boolean;
};

function resolveExecutable(
  command: string,
  root: string,
): ResolvedExecutable | null {
  if (command.length === 0 || hasNul(command)) return null;
  if (!path.isAbsolute(command)) {
    // Relative paths would resolve against a caller-chosen cwd; only bare interpreter names
    // from the allowlist may use PATH lookup.
    if (command !== path.basename(command)) return null;
    if (!isAllowlistedInterpreter(command)) return null;
    const resolved = resolveOnPath(command);
    return resolved ? { path: resolved, interpreter: true } : null;
  }
  const resolved = executableFile(command);
  if (!resolved) return null;
  if (isAllowlistedInterpreter(resolved))
    return { path: resolved, interpreter: true };
  return isInside(root, resolved)
    ? { path: resolved, interpreter: false }
    : null;
}

/**
 * An interpreter is only a launcher: its first argument must be the scorer entry point, a
 * regular file whose canonical path stays inside the containment root. Interpreter options
 * (`-e`, `-c`, `--require`, ...) are rejected because they can run code that is not that file;
 * every later argument belongs to the scorer and is never read by the interpreter.
 */
function interpreterArgs(
  args: readonly string[],
  root: string,
  workingDirectory: string,
): string[] | null {
  const [entryPoint, ...scorerArgs] = args;
  if (entryPoint === undefined || entryPoint.startsWith("-")) return null;
  try {
    const resolved = realpathSync(path.resolve(workingDirectory, entryPoint));
    if (!statSync(resolved).isFile() || !isInside(root, resolved)) return null;
    return [resolved, ...scorerArgs];
  } catch {
    return null;
  }
}

/** NODE_OPTIONS can inject `--require`/`--import` code ahead of the entry point. */
function scorerEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  return env;
}

/**
 * Validates an external scorer invocation before anything is spawned (#563). The working
 * directory must be an existing directory inside the containment root. The executable is either
 * an absolute executable inside that root, or an allowlisted interpreter whose first argument is
 * an entry-point file inside that root (no inline-code options). No value may carry NUL.
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
  const args = executable.interpreter
    ? interpreterArgs(input.args, root, workingDirectory)
    : [...input.args];
  if (!args) return null;
  return {
    executable: executable.path,
    args,
    workingDirectory,
    env: scorerEnvironment(),
  };
}
