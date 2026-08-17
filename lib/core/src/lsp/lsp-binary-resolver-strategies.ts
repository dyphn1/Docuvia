import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NODE_MODULES_DIR_NAME } from "@workspace/contracts";

const execFileAsync = promisify(execFile);

/** Windows npm-generated shim extensions for a `node_modules/.bin` entry, tried in order; POSIX
 *  systems only ever produce the extension-less shell shim. */
const WINDOWS_BIN_EXTENSIONS = [".cmd", ".CMD", ".exe", ""];

export interface ResolvedLspBinary {
  command: string;
  args: string[];
  /** `true` when resolved to a real file under `node_modules/.bin` (provably present, no probe
   *  needed); `false` for the `npx --no-install` fallback, whose actual resolvability can only be
   *  known by attempting it (§8c's gate probes it live in that case). */
  locallyResolved: boolean;
  env?: NodeJS.ProcessEnv;
}

/** Per-language config for the npm/npx binary-resolution strategy
 *  (multi-language-lsp-support plan, Finding C) -- the resolution order every npm-distributed LSP
 *  server this project supports shares (TypeScript, Python/pyright, PHP/intelephense): an explicit
 *  override first, then `<workspaceRoot>/node_modules/.bin`, then `npx --no-install` as the last
 *  resort. Never falls back to a bundled copy -- there isn't one. */
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
  /** Optional spawned-process env override, applied regardless of which resolution branch wins
   * (override / local `.bin` / npx fallback). Empty per-language vocab (kept unset for languages
   * with nothing to configure); TS/JS uses it to keep raising tsserver's heap ceiling even on the
   * resolved command's spawned env (roadmap item 28), without entangling that language-specific
   * logic into this shared resolver. */
  buildEnv?: () => NodeJS.ProcessEnv | undefined;
}

/** Attaches the strategy's spawned-process env override (when one is set) onto a resolved binary,
 *  O(1) single branch each call -- kept out of `resolveNpmNpxBinary` itself to hold its
 *  cyclomatic complexity under the lint budget. */
function withEnv(
  resolved: Omit<ResolvedLspBinary, "env">,
  env: NodeJS.ProcessEnv | undefined,
): ResolvedLspBinary {
  return env ? { ...resolved, env } : resolved;
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
 * npm-distributed (`typescript-`, `python-`, and `php-lsp-edge-provider.ts` all call it).
 */
export function resolveNpmNpxBinary(
  workspaceRoot: string,
  config: NpmNpxStrategyConfig,
  override?: { binary?: string; args?: string[] },
): ResolvedLspBinary {
  const env = config.buildEnv?.();

  if (override?.binary) {
    return withEnv(
      {
        command: override.binary,
        args: override.args ?? config.defaultArgs,
        locallyResolved: true,
      },
      env,
    );
  }

  const binaryName = config.binaryName ?? config.packageName;
  const local = resolveLocalBinaryPath(workspaceRoot, binaryName);
  if (local) {
    return withEnv(
      {
        command: local,
        args: config.defaultArgs,
        locallyResolved: true,
      },
      env,
    );
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

  return withEnv(
    {
      command: "npx",
      args: npxArgs,
      locallyResolved: false,
    },
    env,
  );
}

/** Short timeout for the live `where`/`command -v` PATH probe -- a cheap liveness check, not the
 *  batch itself, so it must fail fast rather than hang resolution. */
const PATH_PROBE_TIMEOUT_MS = 5000;

/** Short timeout for the live `--version` spawn probe (see `probeBinaryVersionSpawnable`) -- same
 *  fail-fast rationale as `PATH_PROBE_TIMEOUT_MS`: a gate check, never the batch. */
const VERSION_PROBE_TIMEOUT_MS = 5000;

/** Per-language config for the PATH-native binary-resolution strategy
 *  (multi-language-lsp-support plan, Finding C) -- used by servers distributed as a standalone
 *  native binary rather than through npm (gopls, rust-analyzer, clangd, jdtls, csharp-ls,
 *  ruby-lsp). */
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
 * isn't one. Consumed by every standalone-binary server (`go-`, `rust-`, `cpp-`, `java-`,
 * `csharp-`, `ruby-lsp-edge-provider.ts`).
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

/**
 * Live spawn probe for the PATH-native strategy: runs `command --version` to prove the resolved
 * *file* can actually be spawned. PATH resolution alone is not a truthful availability signal for
 * rustup-managed binaries -- rustup's rust-analyzer *proxy* in `~/.cargo/bin` resolves cleanly but
 * errors `Unknown binary 'rust-analyzer'` at spawn when the component isn't installed. Spawns the
 * bare `--version` (never the server's `defaultArgs` -- a mode flag like `--stdio` is irrelevant
 * to a probe and could confuse a server that treats it as a command tail). Rust's preflight opts
 * in; other PATH-native languages keep their cheap resolution-only gate.
 */
export async function probeBinaryVersionSpawnable(
  command: string,
  timeoutMs: number = VERSION_PROBE_TIMEOUT_MS,
): Promise<boolean> {
  try {
    await execFileAsync(command, ["--version"], { timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
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
 * Never falls back to a bundled copy -- there isn't one. Currently only `csharp-`/`ruby-
 * lsp-edge-provider.ts` could use it (both instead resolve via `resolvePathNativeBinary`); it
 * stays available for a future server that ships via its toolchain's own manifest.
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
