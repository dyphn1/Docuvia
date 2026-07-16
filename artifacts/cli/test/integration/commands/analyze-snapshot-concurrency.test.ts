import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolve } from "path";
import { existsSync } from "fs";
import { writeFile } from "fs/promises";
import Database from "better-sqlite3";
import { TestSandbox } from "../../support/sandbox.js";

const ANALYZE_RUNS = 3;
const SNAPSHOT_RUNS = 3;

/**
 * Regression coverage for phase1-decision-integration.md §6c dispatch-2b gating test #1 (the
 * "concurrent `analyze` (delta write) + `snapshot`" open item tracked in
 * docs/cli-test-analysis/README.md, gating the hook flip in the same dispatch). Follows
 * `analyze-concurrency.test.ts`'s real-CLI-process pattern, but exercises `analyze` auto mode's
 * real *delta* write path (§6b), not the empty-graph full-ingestion path that file covers: `init`
 * builds the initial graph + knowledge branch, then a real commit moves `HEAD` past whatever
 * `init`'s knowledge-branch creation stamped, so every concurrent `analyze` run below resolves a
 * genuine `fromSha -> headSha` diff with a changed file to re-parse, instead of the sha
 * fast-path no-op. Concurrent `snapshot` runs read `local.db` and pack the same knowledge branch
 * at the same time — both `run-delta-ingestion.ts`'s `knowledgeGit.runUnderKnowledgeLock` and
 * `packSnapshotToKnowledgeBranch`'s `withKnowledgeBranchLock` serialize on the same advisory
 * `.git/docuvia-knowledge.lock`, so this is a real test of that lock under concurrent processes,
 * not mocks.
 */
describe("Command: docuvia analyze (delta) concurrent with docuvia snapshot (real filesystem)", () => {
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

    // `init` builds the local graph (full ingestion) and the knowledge branch — both `analyze`
    // auto mode's delta baseline and `snapshot`'s pack target need to already exist.
    const initResult = await sandbox.runCli(["init"], { reject: false });
    expect(initResult.exitCode).toBe(0);

    // Move HEAD past whatever `init`'s `ensureKnowledgeBranch` stamped, so every concurrent
    // `analyze` run below takes the real delta path (re-parse + persist under the
    // knowledge-branch lock), not the sha fast-path no-op.
    await writeFile(
      resolve(sandbox.dir, "src/index.ts"),
      "export function hello(): string {\n  return 'world!!!';\n}\n",
      "utf8",
    );
    await sandbox.runGit(["add", "-A"]);
    await sandbox.runGit(["commit", "-m", "change hello"]);
  }, 30000);

  afterEach(async () => {
    await sandbox.teardown();
  }, 30000);

  it(`resolves ${ANALYZE_RUNS} concurrent delta analyze runs and ${SNAPSHOT_RUNS} concurrent snapshot runs without corrupting local.db or the knowledge branch, both with sane exit codes`, async () => {
    const runs = [
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

    // No DB corruption: a real SQLite integrity check against local.db, plus a project-row
    // consistency check (concurrent writers must not duplicate/corrupt the single project row).
    const dbPath = resolve(sandbox.dir, ".docuvia/local.db");
    expect(existsSync(dbPath)).toBe(true);
    const db = new Database(dbPath, { readonly: true });
    try {
      const integrity = db.pragma("integrity_check", { simple: true });
      expect(integrity).toBe("ok");

      const { count } = db
        .prepare("SELECT COUNT(*) as count FROM projects")
        .get() as { count: number };
      expect(count).toBe(1);
    } finally {
      db.close();
    }

    // Knowledge-branch lock honored: the branch's history is well-formed (no
    // interleaved/corrupted `fast-import` from a concurrent `snapshot`/`analyze` delta persist
    // racing the lock) -- both `git log` (ref walk) and `git fsck` (object-graph integrity) must
    // succeed cleanly.
    const log = await sandbox.runGit(["log", "docuvia-knowledge", "--oneline"]);
    expect(log.exitCode).toBe(0);
    expect(log.stdout.trim().length).toBeGreaterThan(0);

    const fsck = await sandbox.runGit(["fsck", "--full"]);
    expect(fsck.exitCode).toBe(0);
  }, 120000);
});
