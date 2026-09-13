import { readFile } from "node:fs/promises";
import { describe, it } from "vitest";
import { format } from "prettier";

const files = [
  "lib/core/src/query/phase5-query-quality.integration.test.ts",
  "lib/schema/src/sqlite/phase5-fts-quality.integration.test.ts",
  "test/phase5-query-retrieval-tdd-quality.test.ts",
] as const;

describe("temporary Phase 5 Prettier probe", () => {
  it("emits exact formatted content for cleanup", async () => {
    for (const file of files) {
      const source = await readFile(file, "utf8");
      const formatted = await format(source, { filepath: file });
      process.stdout.write(
        `PHASE5_FORMATTED ${file} ${Buffer.from(formatted).toString("base64")}\n`,
      );
    }
  });
});
