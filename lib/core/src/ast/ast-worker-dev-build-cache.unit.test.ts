import {
  closeSync,
  existsSync,
  fstatSync,
  ftruncateSync,
  futimesSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  compileWorkerForDevMode,
  needsDevWorkerCompile,
} from "./dev-worker-compiler.js";

const temporaryDirectories: string[] = [];

function createFixture(): {
  readonly directory: string;
  readonly entryPath: string;
  readonly dependencyPath: string;
  readonly bundlePath: string;
} {
  const directory = mkdtempSync(
    path.join(os.tmpdir(), "docuvia-worker-build-cache-"),
  );
  temporaryDirectories.push(directory);

  const entryPath = path.join(directory, "worker-entry.js");
  const dependencyPath = path.join(directory, "helper.js");
  const bundlePath = path.join(directory, "worker-bundle.js");
  writeFileSync(
    entryPath,
    'import { helperValue } from "./helper.js";\n' +
      "globalThis.__workerCacheFixture = helperValue;\n",
    "utf8",
  );
  writeFileSync(
    dependencyPath,
    'export const helperValue = "before";\n',
    "utf8",
  );
  return { directory, entryPath, dependencyPath, bundlePath };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("dev worker bundle dependency cache", () => {
  it("[happy][state-diff] rebuilds when an imported helper changes with its mtime preserved", async () => {
    const { entryPath, dependencyPath, bundlePath } = createFixture();
    await compileWorkerForDevMode(entryPath, bundlePath);
    expect(needsDevWorkerCompile(entryPath, bundlePath)).toBe(false);

    const entryStat = statSync(entryPath);
    utimesSync(
      entryPath,
      entryStat.atime,
      new Date(entryStat.mtime.getTime() + 60_000),
    );
    expect(needsDevWorkerCompile(entryPath, bundlePath)).toBe(false);

    const dependencyFd = openSync(dependencyPath, "r+");
    try {
      const previous = fstatSync(dependencyFd);
      const preservedMtime = new Date(
        Math.floor(previous.mtimeMs / 1_000) * 1_000,
      );
      futimesSync(dependencyFd, previous.atime, preservedMtime);
      const preserved = fstatSync(dependencyFd);
      const changedContent = Buffer.from(
        'export const helperValue = "after";\n',
      );
      ftruncateSync(dependencyFd, 0);
      writeSync(dependencyFd, changedContent, 0, changedContent.byteLength, 0);
      futimesSync(dependencyFd, preserved.atime, preserved.mtime);
      expect(fstatSync(dependencyFd).mtimeMs).toBeCloseTo(preserved.mtimeMs, 0);
    } finally {
      closeSync(dependencyFd);
    }

    expect(needsDevWorkerCompile(entryPath, bundlePath)).toBe(true);
    await compileWorkerForDevMode(entryPath, bundlePath);
    expect(readFileSync(bundlePath, "utf8")).toContain('"after"');
    expect(needsDevWorkerCompile(entryPath, bundlePath)).toBe(false);
  });

  it("[invalid-input] rebuilds when the dependency manifest is absent or malformed", async () => {
    const { entryPath, bundlePath } = createFixture();
    await compileWorkerForDevMode(entryPath, bundlePath);
    const manifestPath = `${bundlePath}.inputs.json`;

    rmSync(manifestPath);
    expect(needsDevWorkerCompile(entryPath, bundlePath)).toBe(true);

    await compileWorkerForDevMode(entryPath, bundlePath);
    writeFileSync(manifestPath, "not json", "utf8");
    expect(needsDevWorkerCompile(entryPath, bundlePath)).toBe(true);
  });

  it("[invalid-input] requires the exact worker source in the manifest inputs", async () => {
    const { entryPath, bundlePath } = createFixture();
    await compileWorkerForDevMode(entryPath, bundlePath);
    const manifestPath = `${bundlePath}.inputs.json`;
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      inputs: Array<{ path: string; sha256: string }>;
    };
    manifest.inputs = manifest.inputs.filter(
      (input) => input.path !== entryPath,
    );
    writeFileSync(manifestPath, JSON.stringify(manifest), "utf8");

    expect(needsDevWorkerCompile(entryPath, bundlePath)).toBe(true);
  });

  it("[error-handling] marks a missing bundled input stale without throwing", async () => {
    const { entryPath, dependencyPath, bundlePath } = createFixture();
    await compileWorkerForDevMode(entryPath, bundlePath);
    rmSync(dependencyPath);

    expect(() => needsDevWorkerCompile(entryPath, bundlePath)).not.toThrow();
    expect(needsDevWorkerCompile(entryPath, bundlePath)).toBe(true);
  });

  it("[error-handling] refuses to publish if an input changes during compilation", async () => {
    const { entryPath, dependencyPath, bundlePath } = createFixture();
    const esbuild = await import("esbuild");
    let buildCount = 0;
    await expect(
      compileWorkerForDevMode(entryPath, bundlePath, async (options) => {
        const result = await esbuild.build(options);
        buildCount += 1;
        if (buildCount === 2) {
          writeFileSync(
            dependencyPath,
            'export const helperValue = "during-build";\n',
            "utf8",
          );
        }
        return result;
      }),
    ).rejects.toThrow(/inputs changed while compiling/);
    expect(existsSync(bundlePath)).toBe(false);
    expect(existsSync(`${bundlePath}.inputs.json`)).toBe(false);
  });

  it("[invalid-input] rejects a bundle whose bytes no longer match its manifest", async () => {
    const { entryPath, bundlePath } = createFixture();
    await compileWorkerForDevMode(entryPath, bundlePath);
    writeFileSync(
      bundlePath,
      `${readFileSync(bundlePath, "utf8")}\n// changed`,
    );

    expect(needsDevWorkerCompile(entryPath, bundlePath)).toBe(true);
  });

  it("[happy] keeps a packaged worker authoritative when its source entry is absent", () => {
    const { directory, bundlePath } = createFixture();
    writeFileSync(bundlePath, "packaged worker", "utf8");

    expect(
      needsDevWorkerCompile(
        path.join(directory, "missing-entry.ts"),
        bundlePath,
      ),
    ).toBe(false);
  });

  it("[stress] concurrent compilations use independent temporary outputs", async () => {
    const { entryPath, bundlePath } = createFixture();

    await Promise.all([
      compileWorkerForDevMode(entryPath, bundlePath),
      compileWorkerForDevMode(entryPath, bundlePath),
    ]);

    expect(readFileSync(bundlePath, "utf8")).toContain('"before"');
    expect(needsDevWorkerCompile(entryPath, bundlePath)).toBe(false);
  });
});
