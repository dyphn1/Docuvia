import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { SUBPROCESS_TEST_TIMEOUT_MS } from "@workspace/contracts/testing/timeouts";
import { buildFastImportData } from "../src/fast-import.js";
import {
  createTempGitRepo,
  git,
  removeTempDir,
  type TempGitRepo,
} from "../src/git-local-fixtures.test-support.js";

// TDD-SOURCE: lib/contracts/src/interfaces/git.interfaces.ts
// Phase 2: #371 / #378

describe("Phase 2 git-local acquisition quality", () => {
  let repo: TempGitRepo;

  beforeEach(async () => {
    repo = await createTempGitRepo("docuvia-phase2-git-local-");
  }, SUBPROCESS_TEST_TIMEOUT_MS);

  afterEach(async () => {
    await removeTempDir(repo.dir);
  });

  it("buildFastImportData is byte-for-byte deterministic for identical fixed inputs", () => {
    const files = new Map<string, string>([
      ["README.md", "# Docuvia\n"],
      ["src/index.ts", "export const x = 1;\n"],
    ]);
    const args = [
      "docuvia-knowledge",
      files,
      1_700_000_000,
      "Snapshot [deterministic]",
      "a".repeat(40),
    ] as const;

    const first = buildFastImportData(...args);
    const second = buildFastImportData(...args);

    expect(second).toBe(first);
    expect(first).toContain("from " + "a".repeat(40));
    expect(first).toContain("M 100644 inline README.md");
    expect(first).toContain("M 100644 inline src/index.ts");
  });

  it("read-only local Git acquisition returns identical observable state when the repository is unchanged", async () => {
    fs.mkdirSync(path.join(repo.dir, "src"), { recursive: true });
    fs.writeFileSync(
      path.join(repo.dir, "src", "index.ts"),
      "export const value = 1;\n",
    );
    await git(repo.dir, ["add", "src/index.ts"]);
    await git(repo.dir, ["commit", "-m", "seed"]);

    const firstTracked = Array.from(
      (await repo.provider.listTrackedFilesWithBlobHash(repo.dir)).entries(),
    );
    const firstHead = await repo.provider.getHeadSha(repo.dir);
    const firstChanges = await repo.provider.getRecentChangedFilePaths(repo.dir, 100);

    const secondTracked = Array.from(
      (await repo.provider.listTrackedFilesWithBlobHash(repo.dir)).entries(),
    );
    const secondHead = await repo.provider.getHeadSha(repo.dir);
    const secondChanges = await repo.provider.getRecentChangedFilePaths(repo.dir, 100);

    expect(secondTracked).toEqual(firstTracked);
    expect(secondHead).toBe(firstHead);
    expect(secondChanges).toEqual(firstChanges);
    expect(firstTracked).toHaveLength(1);
    expect(firstTracked[0][0]).toBe("src/index.ts");
    expect(firstTracked[0][1]).toMatch(/^[0-9a-f]{40}$/);
    expect(firstHead).toMatch(/^[0-9a-f]{40}$/);
    expect(firstChanges).toContain("src/index.ts");
  });

  it("missing refs remain stable empty/undefined acquisition results instead of throwing", async () => {
    const firstFile = await repo.provider.readFileAtRef(
      repo.dir,
      "does-not-exist",
      "missing.ts",
    );
    const secondFile = await repo.provider.readFileAtRef(
      repo.dir,
      "does-not-exist",
      "missing.ts",
    );
    const firstList = await repo.provider.listFilesAtRef(
      repo.dir,
      "does-not-exist",
      "knowledge/_l3",
    );
    const secondList = await repo.provider.listFilesAtRef(
      repo.dir,
      "does-not-exist",
      "knowledge/_l3",
    );

    expect(firstFile).toBeUndefined();
    expect(secondFile).toBe(firstFile);
    expect(firstList).toEqual([]);
    expect(secondList).toEqual(firstList);
  });
});
