import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NODE_MODULES_DIR_NAME } from "../discovery/discovery-constants.js";
import type { ResolvedLspBinary } from "./lsp-binary-resolver.js";

const execFileAsync = promisify(execFile);

/** Windows npm-generated shim extensions for a `node_modules/.bin` entry, tried in order; POSIX
 *  systems only ever produce the extension-less shell shim. Same list `lsp-binary-resolver.ts`
 *  uses for the TS/JS provider -- kept here too since this is the generalized version of that
 *  same resolution order. */
const WINDOWS_BIN_EXTENSIONS = [".cmd", ".CMD", ".exe", ""];

/** Per-language config for the npm/npx binary-resolution strategy
 *  (multi-language-lsp-support plan, Finding C) -- the resolution order every npm-distributed LSP
 *  server this project supports shares (TypeScript today; Python/pyright and PHP/intelephense in
 *  later slices): an explicit override first, then `<workspaceRoot>/node_modules/.bin`, then
 *  `npx --no-install` as the last resort. Never falls back to a bundled copy -- there isn't one. */
export interface NpmNpxStrategyConfig {
  /** The npm package name -- the `npx --package` arg, and (when `binaryName` is omitted) also the
   *  `node_modules/.bin` entry name / bare `npx` command arg. */
  packageName: string;
  /** The `node_modules/.bin` entry / command name to actually run, when it differs from
   *  `packageName` -- e.g. the `pyright` npm package ships a `pyright-langserver` bin distinct
   *  from its own package name (`pyright` itself is pyright's CLI type-checker, not the LSP
   *  stdio server). Defaults to `packageName` when omitted (true for
   *  `typescript-language-server`, where package and bin names are identical). When they differ,
   *  the `npx` fallback uses `npx --no-install --package <packageName> <binaryName> ...args`
   *  (the only way `npx` can resolve a bin whose name isn't its package's name); when they match,
   *  it uses the simpler `npx --no-install <packageName> ...args` form. */
  binaryName?: string;
  /** Args passed to the resolved binary when no `override.args` is given (e.g. `["--stdio"]`). */
  defaultArgs: string[];
}

function resolveLocalBinaryPath(
  workspaceRoot: string,
  packageName: string,
): string | undefined {
  const binDir = path.join(workspaceRoot, NODE_MODULES_DIR_NAME, ".bin");
  const candidates =
    process.platform === "win32"
      ? WINDOWS_BIN_EXTENSIONS.map((ext) => `${packageName}${ext}`)
      : [packageName];

  for (const candidate of candidates) {
    const full = path.join(binDir, candidate);
    if (fs.existsSync(full)) return full;
  }
  return undefined;
}

/**
 * Generalized npm/npx binary-resolution strategy (multi-language-lsp-support plan, Finding C),
 * parameterized by `config.packageName`/`config.defaultArgs` rather than hardcoded to
 * `typescript-language-server` -- reusable as-is by every language whose LSP server is
 * npm-distributed. `lib/core/src/lsp/lsp-binary-resolver.ts`'s `resolveLspBinary()` remains the
 * TS/JS provider's own resolver for this slice (unchanged, still exercised by its existing tests);
 * this function is the shared strategy later npm/npx-distributed language slices (Python, PHP)
 * will call directly.
 */
export function resolveNpmNpxBinary(
  workspaceRoot: string,
  config: NpmNpxStrategyConfig,
  override?: { binary?: string; args?: string[] },
): ResolvedLspBinary {
  if (override?.binary) {
    return {
      command: override.binary,
      args: override.args ?? config.defaultArgs,
      locallyResolved: true,
    };
  }

  const binaryName = config.binaryName ?? config.packageName;
  const local = resolveLocalBinaryPath(workspaceRoot, binaryName);
  if (local) {
    return {
      command: local,
      args: config.defaultArgs,
      locallyResolved: true,
    };
  }

  const npxArgs =
    binaryName === config.packageName
      ? ["--no-install", config.packageName, ...config.defaultArgs]
      : [
          "--no-install",
          "--package",
          config.packageName,
          binaryName,
          ...config.defaultArgs,
        ];

  return {
    command: "npx",
    args: npxArgs,
    locallyResolved: false,
  };
}

/** Short timeout for the live `where`/`command -v` PATH probe -- a cheap liveness check, not the
 *  batch itself, so it must fail fast rather than hang resolution. */
const PATH_PROBE_TIMEOUT_MS = 5000;

/** Per-language config for the PATH-native binary-resolution strategy
 *  (multi-language-lsp-support plan, Finding C) -- used by servers distributed as a standalone
 *  native binary rather than through npm (gopls, rust-analyzer, clangd in later slices). */
export interface PathNativeStrategyConfig {
  /** The binary name to probe on `PATH` (e.g. `"gopls"`, `"rust-analyzer"`, `"clangd"`). */
  binaryName: string;
  /** Args passed to the resolved binary when no `override.args` is given. */
  defaultArgs: string[];
  /** Well-known extra install dirs to check as a courtesy fallback when the binary isn't found on
   *  `PATH` proper (e.g. `~/go/bin` for gopls, `~/.cargo/bin` for rust-analyzer) -- language-specific,
   *  so left to the caller rather than hardcoded here (Finding C keeps this file language-agnostic). */
  extraCandidateDirs?: string[];
}

/**
 * Cross-platform "is `binaryName` on `PATH`" probe: `where` on Windows, `command -v` on POSIX
 * (a shell builtin, not a standalone executable, hence spawned via `sh -c` rather than
 * `execFile(binaryName, ...)` directly). No existing cross-platform "which" helper exists
 * elsewhere in the codebase (confirmed by the plan's own research) -- this is the first one.
 */
async function probePathForBinary(
  binaryName: string,
): Promise<string | undefined> {
  try {
    if (process.platform === "win32") {
      const { stdout } = await execFileAsync("where", [binaryName], {
        timeout: PATH_PROBE_TIMEOUT_MS,
      });
      return stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.length > 0);
    }

    const { stdout } = await execFileAsync(
      "sh",
      ["-c", `command -v ${binaryName}`],
      { timeout: PATH_PROBE_TIMEOUT_MS },
    );
    const trimmed = stdout.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  } catch {
    return undefined;
  }
}

function resolveExtraCandidateDir(
  binaryName: string,
  extraCandidateDirs: string[] | undefined,
): string | undefined {
  if (!extraCandidateDirs) return undefined;

  const candidateNames =
    process.platform === "win32"
      ? [`${binaryName}.exe`, binaryName]
      : [binaryName];

  for (const dir of extraCandidateDirs) {
    for (const name of candidateNames) {
      const full = path.join(dir, name);
      if (fs.existsSync(full)) return full;
    }
  }
  return undefined;
}

/**
 * PATH-native binary-resolution strategy (multi-language-lsp-support plan, Finding C): an
 * explicit override first, then a live `PATH` probe (`where`/`command -v`), then
 * `config.extraCandidateDirs` as a courtesy fallback for well-known per-language install
 * locations `PATH` may not include by default. Never falls back to a bundled copy -- there
 * isn't one. Not yet consumed by any provider (no language uses the PATH-native strategy until
 * Slices 2+ ship) -- same "shipped but not yet consumed" pattern as `resolveNpmNpxBinary`.
 */
export async function resolvePathNativeBinary(
  config: PathNativeStrategyConfig,
  override?: { binary?: string; args?: string[] },
): Promise<ResolvedLspBinary> {
  if (override?.binary) {
    return {
      command: override.binary,
      args: override.args ?? config.defaultArgs,
      locallyResolved: true,
    };
  }

  const onPath = await probePathForBinary(config.binaryName);
  if (onPath) {
    return {
      command: onPath,
      args: config.defaultArgs,
      locallyResolved: true,
    };
  }

  const extra = resolveExtraCandidateDir(
    config.binaryName,
    config.extraCandidateDirs,
  );
  if (extra) {
    return {
      command: extra,
      args: config.defaultArgs,
      locallyResolved: true,
    };
  }

  return {
    command: config.binaryName,
    args: config.defaultArgs,
    locallyResolved: false,
  };
}

/** Per-language config for the local-manifest-then-global binary-resolution strategy
 *  (multi-language-lsp-support plan, Finding C) -- used by servers whose toolchain supports a
 *  project-local, version-pinned tool manifest (dotnet local tool manifest for C#'s csharp-ls,
 *  Bundler's `Gemfile.lock` for Ruby's ruby-lsp in later slices), falling back to a global
 *  install on `PATH` when no manifest is present. */
export interface LocalManifestStrategyConfig {
  /** Project-local tool-manifest filename/path to check for, relative to `workspaceRoot` (e.g.
   *  `.config/dotnet-tools.json` for C#, `Gemfile.lock` for Ruby). */
  manifestFilename: string;
  /** Builds the command+args to run the server through the manifest once it's found present
   *  (e.g. `["dotnet", ["tool", "run", "csharp-ls", ...defaultArgs]]`). */
  buildManifestCommand: (defaultArgs: string[]) => {
    command: string;
    args: string[];
  };
  /** Global binary name to resolve on `PATH` when no local manifest is present. */
  globalBinaryName: string;
  /** Args passed to the resolved binary when no `override.args` is given. */
  defaultArgs: string[];
}

/**
 * Local-manifest-then-global binary-resolution strategy (multi-language-lsp-support plan,
 * Finding C): an explicit override first, then a project-local tool manifest
 * (`config.manifestFilename`) run via `config.buildManifestCommand`, then a global binary name
 * on `PATH` as the last resort -- the closest analogue to the npm/npx strategy's
 * `node_modules/.bin`-then-npx shape, for toolchains whose local/global split works differently.
 * Never falls back to a bundled copy -- there isn't one. Not yet consumed by any provider (no
 * language uses this strategy until Slices 6+ ship) -- same "shipped but not yet consumed"
 * pattern as `resolveNpmNpxBinary`.
 */
export function resolveLocalManifestBinary(
  workspaceRoot: string,
  config: LocalManifestStrategyConfig,
  override?: { binary?: string; args?: string[] },
): ResolvedLspBinary {
  if (override?.binary) {
    return {
      command: override.binary,
      args: override.args ?? config.defaultArgs,
      locallyResolved: true,
    };
  }

  const manifestPath = path.join(workspaceRoot, config.manifestFilename);
  if (fs.existsSync(manifestPath)) {
    const { command, args } = config.buildManifestCommand(config.defaultArgs);
    return { command, args, locallyResolved: true };
  }

  return {
    command: config.globalBinaryName,
    args: config.defaultArgs,
    locallyResolved: false,
  };
}
