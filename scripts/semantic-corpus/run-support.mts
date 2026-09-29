/** Shared CLI/environment helpers for the #506 corpus and baseline scripts. */
import { execFileSync } from "node:child_process";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");

export function argsFor(
  argv: readonly string[],
  required: readonly string[],
): Record<string, string> {
  const values: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const [key, value] = [argv[i], argv[i + 1]];
    if (!key.startsWith("--") || value === undefined || value.startsWith("--"))
      throw new Error(
        `Usage: ${required.map((r) => `${r} <value>`).join(" ")}`,
      );
    values[key] = value;
  }
  for (const key of required)
    if (!values[key])
      throw new Error(
        `Missing ${key}; usage: ${required.map((r) => `${r} <value>`).join(" ")}`,
      );
  return values;
}

const LLM_ENV = /^(?:AI_DOCUVIA_|OPENAI_|ANTHROPIC_|OPENROUTER_)/;

/** The parent environment without LLM endpoints/keys: evaluation runs must never send snapshot
 *  source to a network model (Tier C would otherwise try, and its timeout would pollute timings). */
export function offlineEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env))
    if (!LLM_ENV.test(key)) env[key] = value;
  return { ...env, NO_COLOR: "1", ...extra };
}

/** Atomic JSON write (temp file + rename). `compact` keeps large manifests under the
 *  64 MiB `eval:semantic` input cap. */
export function writeJson(
  file: string,
  value: unknown,
  options: { compact?: boolean } = {},
): void {
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}`;
  const text = options.compact
    ? JSON.stringify(value)
    : JSON.stringify(value, null, 2);
  writeFileSync(temporary, `${text}\n`, "utf8");
  renameSync(temporary, file);
}

function command(cmd: string, args: string[]): string {
  try {
    return execFileSync(cmd, args, { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return "unavailable";
  }
}

/** Machine-readable environment freeze (#506 "Freeze the environment first"). */
export function machineManifest(): Record<string, unknown> {
  const cpus = os.cpus();
  return {
    docuviaCommit: command("git", ["rev-parse", "HEAD"]),
    docuviaDirty:
      command("git", ["status", "--porcelain", "--untracked-files=no"]) !== "",
    node: process.version,
    pnpm: command("pnpm", ["--version"]),
    os: `${os.type()} ${os.release()} ${os.arch()}`,
    osVersion: command("sw_vers", ["-productVersion"]),
    cpuModel: cpus[0]?.model ?? "unknown",
    logicalCpus: os.availableParallelism(),
    memoryBytes: os.totalmem(),
  };
}

export function runManifest(
  corpus: {
    corpusId: string;
    corpusVersion: string;
    splitSeed: string;
    maxSamplesPerSnapshot: number;
    tierAHeapMb: number;
    memoryFloorPercent: number;
    oracle: unknown;
  },
  oracle: unknown,
  typescriptVersion: string,
): Record<string, unknown> {
  return {
    ...machineManifest(),
    typescript: typescriptVersion,
    oracle,
    corpus: {
      corpusId: corpus.corpusId,
      corpusVersion: corpus.corpusVersion,
      splitSeed: corpus.splitSeed,
      maxSamplesPerSnapshot: corpus.maxSamplesPerSnapshot,
      tierAHeapMb: corpus.tierAHeapMb,
      memoryFloorPercent: corpus.memoryFloorPercent,
      oracleOptions: corpus.oracle,
    },
  };
}
