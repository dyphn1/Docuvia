import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import * as prettier from "prettier";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = resolve(__dirname, "..");
const tempDirs: string[] = [];

type ReleasePlugin = string | [string, Record<string, unknown>];

function pluginName(plugin: ReleasePlugin): string {
  return typeof plugin === "string" ? plugin : plugin[0];
}

describe("semantic-release generated artifact formatting", () => {
  afterEach(async () => {
    await Promise.all(
      tempDirs
        .splice(0)
        .map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  it(
    "formats generated artifacts after changelog/npm prepare and before git commit",
    async () => {
      const releaseConfig = JSON.parse(
        await readFile(resolve(repoRoot, ".releaserc.json"), "utf8"),
      ) as { plugins: ReleasePlugin[] };
      const pluginNames = releaseConfig.plugins.map(pluginName);

      const changelogIndex = pluginNames.indexOf("@semantic-release/changelog");
      const npmIndex = pluginNames.indexOf("@semantic-release/npm");
      const formatterIndex = pluginNames.indexOf(
        "./scripts/release-format-plugin.mjs",
      );
      const gitIndex = pluginNames.indexOf("@semantic-release/git");

      expect(changelogIndex).toBeGreaterThanOrEqual(0);
      expect(npmIndex).toBeGreaterThan(changelogIndex);
      expect(formatterIndex).toBeGreaterThan(npmIndex);
      expect(gitIndex).toBeGreaterThan(formatterIndex);
    },
  );

  it(
    "normalizes semantic-release-style changelog and package output with repo Prettier rules",
    async () => {
      const fixtureRoot = await mkdtemp(
        resolve(tmpdir(), "docuvia-release-format-"),
      );
      tempDirs.push(fixtureRoot);
      await mkdir(resolve(fixtureRoot, "artifacts/cli"), { recursive: true });

      await writeFile(
        resolve(fixtureRoot, ".prettierrc"),
        '{\n  "endOfLine": "lf"\n}\n',
        "utf8",
      );
      await writeFile(
        resolve(fixtureRoot, "CHANGELOG.md"),
        [
          "# Changelog",
          "",
          "## [1.2.3](https://example.test/compare) (2026-09-23)",
          "",
          "",
          "### Bug Fixes",
          "",
          "* **core:** generated bullet",
          "",
        ].join("\n"),
        "utf8",
      );
      await writeFile(
        resolve(fixtureRoot, "artifacts/cli/package.json"),
        '{"name":"docuvia","version":"1.2.3"}',
        "utf8",
      );

      const pluginUrl = pathToFileURL(
        resolve(repoRoot, "scripts/release-format-plugin.mjs"),
      ).href;
      const plugin = (await import(pluginUrl)) as {
        prepare(
          pluginConfig: Record<string, never>,
          context: { cwd: string },
        ): Promise<void>;
      };

      await plugin.prepare({}, { cwd: fixtureRoot });

      for (const relativePath of [
        "CHANGELOG.md",
        "artifacts/cli/package.json",
      ]) {
        const absolutePath = resolve(fixtureRoot, relativePath);
        const actual = await readFile(absolutePath, "utf8");
        const config = (await prettier.resolveConfig(absolutePath)) ?? {};
        const canonical = await prettier.format(actual, {
          ...config,
          filepath: absolutePath,
        });
        expect(actual).toBe(canonical);
      }
    },
  );
});
