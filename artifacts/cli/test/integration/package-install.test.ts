import { execa } from "execa";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "fs/promises";
import { join, resolve } from "path";
import { tmpdir } from "os";
import { SUBPROCESS_TEST_TIMEOUT_MS } from "@workspace/contracts/testing/timeouts";
import { buildDistCli } from "../support/sandbox.js";

const CLI_PACKAGE_DIR = resolve(import.meta.dirname, "../..");
const NPM_COMMAND = process.platform === "win32" ? "npm.cmd" : "npm";
const NPX_COMMAND = process.platform === "win32" ? "npx.cmd" : "npx";

async function readCliVersion(): Promise<string> {
  const manifest = JSON.parse(
    await readFile(join(CLI_PACKAGE_DIR, "package.json"), "utf8"),
  ) as { version?: unknown };
  if (typeof manifest.version !== "string") {
    throw new Error("CLI package.json must contain a string version");
  }
  return manifest.version;
}

describe("packed npm distribution", () => {
  let tempDir: string | undefined;

  beforeAll(async () => {
    await buildDistCli();
  }, SUBPROCESS_TEST_TIMEOUT_MS);

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100,
      });
      tempDir = undefined;
    }
  });

  it(
    "installs from an npm tarball in a clean consumer outside the pnpm workspace",
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
      if (!tarballName) return;

      const installResult = await execa(
        NPM_COMMAND,
        [
          "install",
          "--no-audit",
          "--no-fund",
          "--package-lock=false",
          join(tempDir, tarballName),
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

      const npxResult = await execa(
        NPX_COMMAND,
        ["--no-install", "docuvia", "--version"],
        { cwd: consumerDir, reject: false },
      );
      expect(npxResult.exitCode, npxResult.stderr).toBe(0);
      expect(npxResult.stdout.trim()).toBe(await readCliVersion());

      const installedManifest = JSON.parse(
        await readFile(
          join(consumerDir, "node_modules", "docuvia", "package.json"),
          "utf8",
        ),
      ) as { bin?: unknown };
      expect(installedManifest.bin).toEqual({ docuvia: "./dist/cli.js" });
    },
    SUBPROCESS_TEST_TIMEOUT_MS,
  );
});
