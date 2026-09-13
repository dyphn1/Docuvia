import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "vitest";
import { format } from "prettier";

const files = [
  "lib/core/src/query/phase5-query-quality.integration.test.ts",
  "lib/schema/src/sqlite/phase5-fts-quality.integration.test.ts",
  "test/phase5-query-retrieval-tdd-quality.test.ts",
] as const;

describe("temporary Phase 5 Prettier probe", () => {
  it("emits exact formatting diffs for cleanup", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "phase5-prettier-"));

    for (const [index, file] of files.entries()) {
      const source = await readFile(file, "utf8");
      const formatted = await format(source, { filepath: file });
      const formattedPath = path.join(tempDir, `${index}.ts`);
      writeFileSync(formattedPath, formatted, "utf8");

      const diff = spawnSync(
        "git",
        ["diff", "--no-index", "--no-color", "--", file, formattedPath],
        { encoding: "utf8" },
      );

      process.stdout.write(`\nPHASE5_PRETTIER_DIFF ${file}\n${diff.stdout}\n`);
    }
  });
});
