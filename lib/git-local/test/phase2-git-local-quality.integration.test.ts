import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { ErrorCodes } from "@workspace/contracts";
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

  it("[happy] buildFastImportData is byte-for-byte deterministic for identical fixed inputs", () => {
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
    const firstChanges = await repo.provider.getRecentChangedFilePaths(
      repo.dir,
      100,
    );

    const secondTracked = Array.from(
      (await repo.provider.listTrackedFilesWithBlobHash(repo.dir)).entries(),
    );
    const secondHead = await repo.provider.getHeadSha(repo.dir);
    const secondChanges = await repo.provider.getRecentChangedFilePaths(
      repo.dir,
      100,
    );

    expect(secondTracked).toEqual(firstTracked);
    expect(secondHead).toBe(firstHead);
    expect(secondChanges).toEqual(firstChanges);
    expect(firstTracked).toHaveLength(1);
    expect(firstTracked[0][0]).toBe("src/index.ts");
    expect(firstTracked[0][1]).toMatch(/^[0-9a-f]{40}$/);
    expect(firstHead).toMatch(/^[0-9a-f]{40}$/);
    expect(firstChanges).toContain("src/index.ts");
  });

  it("[invalid-input] missing refs remain stable empty/undefined acquisition results instead of throwing", async () => {
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

    expect(firstFile).toEqual(undefined);
    expect(secondFile).toBe(firstFile);
    expect(firstList).toEqual([]);
    expect(secondList).toEqual(firstList);
  });

  it("[error-handling] wraps a tracked-file acquisition failure as GIT_COMMAND_FAILED", async () => {
    const missingCwd = path.join(repo.dir, "directory-that-does-not-exist");

    await expect(
      repo.provider.listTrackedFilesWithBlobHash(missingCwd),
    ).rejects.toMatchObject({
      code: ErrorCodes.GIT_COMMAND_FAILED,
      message: expect.stringContaining("git ls-files -s failed"),
    });
  });

  it("[state-diff] exposes the exact new HEAD and blob hash after a second committed revision", async () => {
    const filePath = path.join(repo.dir, "state.ts");
    fs.writeFileSync(filePath, "export const state = 1;\n");
    await git(repo.dir, ["add", "state.ts"]);
    await git(repo.dir, ["commit", "-m", "state one"]);

    const firstHead = await repo.provider.getHeadSha(repo.dir);
    const firstTracked = await repo.provider.listTrackedFilesWithBlobHash(repo.dir);
    const firstBlob = firstTracked.get("state.ts");

    fs.writeFileSync(filePath, "export const state = 2;\n");
    await git(repo.dir, ["add", "state.ts"]);
    await git(repo.dir, ["commit", "-m", "state two"]);

    const secondHead = await repo.provider.getHeadSha(repo.dir);
    const secondTracked = await repo.provider.listTrackedFilesWithBlobHash(repo.dir);
    const secondBlob = secondTracked.get("state.ts");

    expect(firstHead).toMatch(/^[0-9a-f]{40}$/);
    expect(secondHead).toMatch(/^[0-9a-f]{40}$/);
    expect(secondHead).not.toBe(firstHead);
    expect(firstBlob).toMatch(/^[0-9a-f]{40}$/);
    expect(secondBlob).toMatch(/^[0-9a-f]{40}$/);
    expect(secondBlob).not.toBe(firstBlob);
    expect(await repo.provider.getRecentChangedFilePaths(repo.dir, 1)).toEqual([
      "state.ts",
    ]);
  });

  it(
    "[stress] returns all 200 tracked files with unique blob hashes deterministically across repeated reads",
    async () => {
      const expectedPaths: string[] = [];
      for (let index = 0; index < 200; index++) {
        const relativePath = `src/stress/file-${index.toString().padStart(3, "0")}.ts`;
        expectedPaths.push(relativePath);
        const absolutePath = path.join(repo.dir, relativePath);
        fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
        fs.writeFileSync(
          absolutePath,
          `export const value${index} = ${index};\n`,
        );
      }
      await git(repo.dir, ["add", "src/stress"]);
      await git(repo.dir, ["commit", "-m", "stress corpus"]);

      const first = Array.from(
        (await repo.provider.listTrackedFilesWithBlobHash(repo.dir)).entries(),
      ).sort(([left], [right]) => left.localeCompare(right));
      const second = Array.from(
        (await repo.provider.listTrackedFilesWithBlobHash(repo.dir)).entries(),
      ).sort(([left], [right]) => left.localeCompare(right));

      expect(second).toEqual(first);
      expect(first).toHaveLength(200);
      expect(first.map(([filePath]) => filePath)).toEqual(expectedPaths);
      expect(new Set(first.map(([, blobHash]) => blobHash)).size).toBe(200);
      expect(first.every(([, blobHash]) => /^[0-9a-f]{40}$/.test(blobHash))).toBe(
        true,
      );
    },
    SUBPROCESS_TEST_TIMEOUT_MS,
  );
});
