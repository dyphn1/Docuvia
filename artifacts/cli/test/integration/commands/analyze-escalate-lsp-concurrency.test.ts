import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolve } from "path";
import { existsSync } from "fs";
import { writeFile } from "fs/promises";
import Database from "better-sqlite3";
import { TestSandbox } from "../../support/sandbox.js";
import { SUBPROCESS_TEST_TIMEOUT_MS } from "@workspace/contracts/testing/timeouts";

const BATCH_RUNS = 3;
const ANALYZE_RUNS = 2;
const SNAPSHOT_RUNS = 2;

/**
 * Gating test 1 (docs/gitbook/analysis/phase1-decision-integration.md §8j): "batch vs concurrent
 * Tier A `analyze` (delta write), and batch vs `snapshot`". Follows
 * analyze-snapshot-concurrency.test.ts's real-CLI-process pattern. No `typescript-language-server`
 * is installed in this sandbox, so every `analyze --escalate-to-lsp` run passes `--fallback-ast`
 * (skipping the non-interactive hard-fail gate) and takes the real honest-degradation path (§8b)
 * -- which is exactly what exercises the concurrency-relevant
 * writes this test cares about: the `tierBBatchPending` meta write (under the knowledge-branch
 * lock) and `snapshot`'s post-pack finalize read/maybe-write of the same key. The queue is seeded
 * directly (a small raw SQLite write) so every batch run has real work to stage, rather than
 * hitting the trivial empty-queue no-op path that never touches a lock at all.
 */
describe("Command: docuvia analyze --escalate-to-lsp (batch) concurrent with analyze/snapshot (real filesystem)", () => {
  let sandbox: TestSandbox;

  beforeEach(async () => {
    sandbox = new TestSandbox();
    await sandbox.setup({
      initGit: true,
      files: {
        "package.json": JSON.stringify({ name: "fixture-project" }),
        "src/index.ts":
          "export function hello(): string {\n  return 'world';\n}\n",
      },
    });
    await sandbox.runGit(["add", "-A"]);
    await sandbox.runGit(["commit", "-m", "initial"]);

    const initResult = await sandbox.runCli(["init"], { reject: false });
    expect(initResult.exitCode).toBe(0);

    // Move HEAD so the concurrent no-flag `analyze` runs below take the real delta path.
    await writeFile(
      resolve(sandbox.dir, "src/index.ts"),
      "export function hello(): string {\n  return 'world!!!';\n}\n",
      "utf8",
    );
    await sandbox.runGit(["add", "-A"]);
    await sandbox.runGit(["commit", "-m", "change hello"]);

    // Seed the Tier B queue directly so every concurrent batch run below has real work to stage
    // (not the trivial empty-queue no-op path).
    const dbPath = resolve(sandbox.dir, ".docuvia/local.db");
    const db = new Database(dbPath);
    try {
      db.prepare(
        "INSERT OR REPLACE INTO docuvia_meta (key, value) VALUES ('tierBQueue', ?)",
      ).run(JSON.stringify([{ file: "src/index.ts", commitSha: "deadbeef" }]));
    } finally {
      db.close();
    }
  }, SUBPROCESS_TEST_TIMEOUT_MS);

  afterEach(async () => {
    await sandbox.teardown();
  }, SUBPROCESS_TEST_TIMEOUT_MS);

  it(`resolves ${BATCH_RUNS} concurrent Tier B batch runs, ${ANALYZE_RUNS} concurrent delta analyze runs, and ${SNAPSHOT_RUNS} concurrent snapshot runs without corrupting local.db or the knowledge branch, all with sane exit codes`, async () => {
    const runs = [
      ...Array.from({ length: BATCH_RUNS }, () =>
        sandbox.runCli(["analyze", "--escalate-to-lsp", "--fallback-ast"], {
          reject: false,
        }),
      ),
      ...Array.from({ length: ANALYZE_RUNS }, () =>
        sandbox.runCli(["analyze"], { reject: false }),
      ),
      ...Array.from({ length: SNAPSHOT_RUNS }, () =>
        sandbox.runCli(["snapshot"], { reject: false }),
      ),
    ];
    const results = await Promise.all(runs);

    for (const result of results) {
      expect(result.exitCode).toBe(0);
    }

    const dbPath = resolve(sandbox.dir, ".docuvia/local.db");
    expect(existsSync(dbPath)).toBe(true);
    const db = new Database(dbPath, { readonly: true });
    try {
      const integrity = db.pragma("integrity_check", { simple: true });
      expect(integrity).toBe("ok");
    } finally {
      db.close();
    }

    const log = await sandbox.runGit(["log", "docuvia-knowledge", "--oneline"]);
    expect(log.exitCode).toBe(0);

    const fsck = await sandbox.runGit(["fsck", "--full"]);
    expect(fsck.exitCode).toBe(0);
  }, 180000);
});
