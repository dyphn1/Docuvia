import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import * as prettier from "prettier";

const RELEASE_ARTIFACTS = ["CHANGELOG.md", "artifacts/cli/package.json"];

/**
 * semantic-release prepare hook.
 *
 * The changelog and npm plugins mutate tracked release artifacts during prepare.
 * This hook runs after both generators and before @semantic-release/git so the
 * release commit itself satisfies the repository's Prettier invariant.
 */
export async function prepare(_pluginConfig, context) {
  const cwd = context?.cwd ?? process.cwd();

  for (const relativePath of RELEASE_ARTIFACTS) {
    const absolutePath = resolve(cwd, relativePath);
    const source = await readFile(absolutePath, "utf8");
    const config = (await prettier.resolveConfig(absolutePath)) ?? {};
    const formatted = await prettier.format(source, {
      ...config,
      filepath: absolutePath,
    });

    if (formatted !== source) {
      await writeFile(absolutePath, formatted, "utf8");
    }
  }
}
