import { execa } from "execa";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  cp,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "fs/promises";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { SUBPROCESS_TEST_TIMEOUT_MS } from "@workspace/contracts/testing/timeouts";
import { buildDistCli } from "../support/sandbox.js";

const CLI_PACKAGE_DIR = resolve(import.meta.dirname, "../..");
const NPM_COMMAND = process.platform === "win32" ? "npm.cmd" : "npm";
const NPX_COMMAND = process.platform === "win32" ? "npx.cmd" : "npx";

async function readCliVersion(
  manifestPath = join(CLI_PACKAGE_DIR, "package.json"),
): Promise<string> {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    version?: unknown;
  };
  if (typeof manifest.version !== "string") {
    throw new Error("CLI package.json must contain a string version");
  }
  return manifest.version;
}

describe("packed npm distribution", () => {
  let tempDir: string | undefined;

  beforeAll(async () => {
    // The CLI Vitest project is intentionally fileParallelism:false, so this shares the same
    // serialized compiled-dist contract as dist-build.test.ts and cli-workflow.integration.test.ts.
    await buildDistCli();
  }, SUBPROCESS_TEST_TIMEOUT_MS);

  afterEach(async () => {
    if (!tempDir) return;
    await rm(tempDir, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    });
    tempDir = undefined;
  });

  it("[invalid-input] rejects a package manifest whose version is not a string", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "docuvia-package-manifest-"));
    const manifestPath = join(tempDir, "package.json");
    await writeFile(manifestPath, JSON.stringify({ version: 123 }));

    await expect(readCliVersion(manifestPath)).rejects.toThrow(
      "CLI package.json must contain a string version",
    );
  });

  it("[error-handling] propagates malformed package manifest JSON", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "docuvia-package-manifest-"));
    const manifestPath = join(tempDir, "package.json");
    await writeFile(manifestPath, "{not-json");

    await expect(readCliVersion(manifestPath)).rejects.toThrow(SyntaxError);
  });

  it(
    "[happy] keeps the CLI bin valid through npm publish normalization",
    async () => {
      tempDir = await mkdtemp(join(tmpdir(), "docuvia-publish-dry-run-"));
      const stagedPackageDir = join(tempDir, "package");
      await mkdir(stagedPackageDir);

      const manifest = JSON.parse(
        await readFile(join(CLI_PACKAGE_DIR, "package.json"), "utf8"),
      ) as Record<string, unknown>;
      manifest.version = `0.0.0-publish-dry-run.${process.pid}`;
      await writeFile(
        join(stagedPackageDir, "package.json"),
        JSON.stringify(manifest, null, 2),
      );
      await cp(join(CLI_PACKAGE_DIR, "dist"), join(stagedPackageDir, "dist"), {
        recursive: true,
      });

      const publishResult = await execa(
        NPM_COMMAND,
        ["publish", "--dry-run", "--ignore-scripts", "--json"],
        {
          cwd: stagedPackageDir,
          reject: false,
          env: { ...process.env, npm_config_update_notifier: "false" },
        },
      );

      const publishOutput = `${publishResult.stdout}\n${publishResult.stderr}`;
      expect(publishResult.exitCode, publishOutput).toBe(0);
      expect(publishOutput).not.toContain("bin[docuvia]");
      expect(publishOutput).not.toContain("invalid and removed");
    },
    SUBPROCESS_TEST_TIMEOUT_MS,
  );

  it(
    "[happy] installs the packed CLI in a clean npm consumer and runs its binary",
    async () => {
      tempDir = await mkdtemp(join(tmpdir(), "docuvia-package-install-"));
      const consumerDir = join(tempDir, "consumer");
      await mkdir(consumerDir);
      await writeFile(
        join(consumerDir, "package.json"),
        JSON.stringify({
          name: "docuvia-install-test",
          version: "1.0.0",
          private: true,
        }),
      );

      const packResult = await execa(
        NPM_COMMAND,
        ["pack", "--pack-destination", tempDir],
        { cwd: CLI_PACKAGE_DIR, reject: false },
      );
      expect(packResult.exitCode, packResult.stderr).toBe(0);

      const tarballName = (await readdir(tempDir)).find((entry) =>
        entry.endsWith(".tgz"),
      );
      expect(tarballName).toBeDefined();

      const installResult = await execa(
        NPM_COMMAND,
        [
          "install",
          "--no-audit",
          "--no-fund",
          "--package-lock=false",
          join(tempDir, tarballName!),
        ],
        {
          cwd: consumerDir,
          reject: false,
          env: { ...process.env, npm_config_update_notifier: "false" },
        },
      );

      expect(installResult.exitCode, installResult.stderr).toBe(0);
      expect(`${installResult.stdout}\n${installResult.stderr}`).not.toContain(
        "EUNSUPPORTEDPROTOCOL",
      );

      const installedManifest = JSON.parse(
        await readFile(
          join(consumerDir, "node_modules", "docuvia", "package.json"),
          "utf8",
        ),
      ) as {
        bin?: unknown;
        dependencies?: Record<string, string>;
      };
      expect(installedManifest.bin).toEqual({ docuvia: "dist/cli.js" });
      expect(
        Object.values(installedManifest.dependencies ?? {}).some((value) =>
          value.startsWith("workspace:"),
        ),
      ).toBe(false);

      const npxResult = await execa(
        NPX_COMMAND,
        ["--no-install", "docuvia", "--version"],
        { cwd: consumerDir, reject: false },
      );
      expect(npxResult.exitCode, npxResult.stderr).toBe(0);
      expect(npxResult.stdout.trim()).toBe(await readCliVersion());
    },
    SUBPROCESS_TEST_TIMEOUT_MS,
  );
});
