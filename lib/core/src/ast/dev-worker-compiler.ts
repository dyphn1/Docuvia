import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import type { BuildOptions, BuildResult } from "esbuild";

const DevWorkerBuildConfig = {
  FORMAT: "esm",
  PLATFORM: "node",
  TARGET: "node20",
  EXTERNAL_TREE_SITTER: "web-tree-sitter",
} as const;

const DEV_WORKER_MANIFEST_VERSION = 1;

type EsbuildBuild = (options: BuildOptions) => Promise<BuildResult>;

interface DevWorkerInputFingerprint {
  readonly path: string;
  readonly sha256: string;
}

interface DevWorkerBuildManifest {
  readonly version: typeof DEV_WORKER_MANIFEST_VERSION;
  readonly bundleSha256: string;
  readonly inputs: readonly DevWorkerInputFingerprint[];
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function manifestPathFor(bundlePath: string): string {
  return `${bundlePath}.inputs.json`;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function isDevWorkerInput(value: unknown): value is DevWorkerInputFingerprint {
  if (!isObjectRecord(value)) return false;
  return (
    typeof value.path === "string" &&
    path.isAbsolute(value.path) &&
    isSha256(value.sha256)
  );
}

function resolveMetafileInput(
  inputPath: string,
  workingDirectory: string,
): string {
  return path.resolve(workingDirectory, inputPath);
}

function fingerprintInputs(
  sourcePath: string,
  metafileInputs: readonly string[],
  workingDirectory: string,
): DevWorkerInputFingerprint[] {
  const inputPaths = new Set([
    path.resolve(workingDirectory, sourcePath),
    ...metafileInputs.map((input) =>
      resolveMetafileInput(input, workingDirectory),
    ),
  ]);
  return [...inputPaths]
    .sort()
    .map((input) => ({ path: input, sha256: sha256(readFileSync(input)) }));
}

function haveSameFingerprints(
  left: readonly DevWorkerInputFingerprint[],
  right: readonly DevWorkerInputFingerprint[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (input, index) =>
        input.path === right[index]?.path &&
        input.sha256 === right[index]?.sha256,
    )
  );
}

function buildManifest(
  bundlePath: string,
  inputs: readonly DevWorkerInputFingerprint[],
): DevWorkerBuildManifest {
  return {
    version: DEV_WORKER_MANIFEST_VERSION,
    bundleSha256: sha256(readFileSync(bundlePath)),
    inputs,
  };
}

function readManifest(bundlePath: string): DevWorkerBuildManifest | null {
  const filePath = manifestPathFor(bundlePath);
  if (!existsSync(filePath)) return null;

  try {
    const value: unknown = JSON.parse(readFileSync(filePath, "utf8"));
    if (!isObjectRecord(value)) return null;
    const manifest = value as Partial<DevWorkerBuildManifest>;
    return manifest.version === DEV_WORKER_MANIFEST_VERSION &&
      isSha256(manifest.bundleSha256) &&
      Array.isArray(manifest.inputs) &&
      manifest.inputs.length > 0 &&
      manifest.inputs.every(isDevWorkerInput)
      ? (manifest as DevWorkerBuildManifest)
      : null;
  } catch {
    return null;
  }
}

/**
 * Compiles the source worker to an adjacent standalone bundle for dev/test runs.
 * The dependency manifest fingerprints the exact esbuild inputs so an imported source change
 * invalidates the bundle even when `ast-worker.ts` itself is untouched. `web-tree-sitter` stays
 * external so it resolves its WASM relative to its installed package at runtime.
 * `buildOverride` is a deterministic mutation-race seam for the compiler's unit tests.
 */
export async function compileWorkerForDevMode(
  sourcePath: string,
  outPath: string,
  buildOverride?: EsbuildBuild,
): Promise<void> {
  const workingDirectory = process.cwd();
  const esbuild = await import("esbuild");
  const build = buildOverride ?? esbuild.build.bind(esbuild);
  const buildToken = `${process.pid}.${randomUUID()}`;
  const tmpPath = `${outPath}.${buildToken}.tmp`;
  const manifestPath = manifestPathFor(outPath);
  const manifestTmpPath = `${manifestPath}.${buildToken}.tmp`;

  try {
    const commonBuildOptions: BuildOptions = {
      absWorkingDir: workingDirectory,
      entryPoints: [sourcePath],
      outfile: tmpPath,
      bundle: true,
      format: DevWorkerBuildConfig.FORMAT,
      platform: DevWorkerBuildConfig.PLATFORM,
      target: DevWorkerBuildConfig.TARGET,
      external: [DevWorkerBuildConfig.EXTERNAL_TREE_SITTER],
      logLevel: "silent",
      metafile: true,
    };
    const discovery = await build({
      ...commonBuildOptions,
      write: false,
    });
    if (!discovery.metafile)
      throw new Error("esbuild discovery did not return its input metafile");
    const inputsBeforeBuild = fingerprintInputs(
      sourcePath,
      Object.keys(discovery.metafile.inputs),
      workingDirectory,
    );
    const result = await build(commonBuildOptions);
    if (!result.metafile)
      throw new Error("esbuild worker build did not return its input metafile");
    const inputsAfterBuild = fingerprintInputs(
      sourcePath,
      Object.keys(result.metafile.inputs),
      workingDirectory,
    );
    if (!haveSameFingerprints(inputsBeforeBuild, inputsAfterBuild)) {
      throw new Error(
        "AST worker inputs changed while compiling; retry initialization",
      );
    }
    const manifest = buildManifest(tmpPath, inputsAfterBuild);
    writeFileSync(manifestTmpPath, JSON.stringify(manifest), "utf8");

    // These files cannot be renamed as one transaction. The bundle digest in the manifest
    // makes any interleaved publication detectable by the next freshness check.
    renameSync(tmpPath, outPath);
    renameSync(manifestTmpPath, manifestPath);
  } finally {
    rmSync(tmpPath, { force: true });
    rmSync(manifestTmpPath, { force: true });
  }
}

/**
 * Returns whether the dev/test worker bundle must be rebuilt. A packaged worker remains
 * authoritative when its sibling source file is absent.
 */
export function needsDevWorkerCompile(
  sourcePath: string,
  bundlePath: string,
): boolean {
  if (!existsSync(bundlePath)) return true;
  if (!existsSync(sourcePath)) return false;

  try {
    const manifest = readManifest(bundlePath);
    const sourceAbsolutePath = path.resolve(sourcePath);
    if (
      !manifest ||
      !manifest.inputs.some((input) => input.path === sourceAbsolutePath) ||
      sha256(readFileSync(bundlePath)) !== manifest.bundleSha256
    )
      return true;
    return manifest.inputs.some(
      (input) => sha256(readFileSync(input.path)) !== input.sha256,
    );
  } catch {
    return true;
  }
}
