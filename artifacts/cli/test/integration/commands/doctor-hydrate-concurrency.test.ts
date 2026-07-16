import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolve } from "path";
import { existsSync } from "fs";
import Database from "better-sqlite3";
import { TestSandbox } from "../../support/sandbox.js";

const DOCTOR_RUNS = 3;
const HYDRATE_RUNS = 3;

/**
 * Regression coverage for phase1-decision-integration.md §6c dispatch-2b gating test #2 (the
 * "concurrent `doctor` + `hydrate`" open item tracked in docs/cli-test-analysis/doctor.md #6 and
 * hydrate.md #6, gating the hook flip in the same dispatch alongside
 * analyze-snapshot-concurrency.test.ts's item #1). Follows `analyze-concurrency.test.ts`'s
 * real-CLI-process pattern: `doctor` opens `local.db` read-only (`SqliteDiagnosticRunner`,
 * `PRAGMA integrity_check`) while `hydrate` opens it read-write and wholesale-replaces
 * `l2_nodes`/`node_links` (`HydrationService.hydrate` -> `bulkLoadGraph`) from the knowledge
 * branch -- this exercises SQLite's WAL/busy_timeout concurrent reader/writer handling (ADR-032,
 * the same mechanism `analyze-concurrency.test.ts` documents) under real concurrent processes,
 * not mocks.
 */
describe("Command: docuvia doctor concurrent with docuvia hydrate (real filesystem)", () => {
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

    // `init` builds the local graph and the knowledge branch -- `hydrate`'s bulk-load target and
    // `doctor`'s db-found precondition both need `local.db` and the branch to already exist.
    const initResult = await sandbox.runCli(["init"], { reject: false });
    expect(initResult.exitCode).toBe(0);
  }, 30000);

  afterEach(async () => {
    await sandbox.teardown();
  }, 30000);

  it(`resolves ${DOCTOR_RUNS} concurrent doctor runs and ${HYDRATE_RUNS} concurrent hydrate runs without corrupting local.db, both with sane exit codes`, async () => {
    const runs = [
      // `--skip-git` avoids `doctor`'s git-remote-reachability check, which fails in any sandbox
      // without a configured remote (the same pre-existing flakiness `doctor.test.ts` documents)
      // and is orthogonal to the db-concurrency behavior this test targets; `sqlite_integrity`
      // (the check that matters here) still runs.
      ...Array.from({ length: DOCTOR_RUNS }, () =>
        sandbox.runCli(["doctor", "--skip-git"], { reject: false }),
      ),
      ...Array.from({ length: HYDRATE_RUNS }, () =>
        sandbox.runCli(["hydrate"], { reject: false }),
      ),
    ];
    const results = await Promise.all(runs);

    for (const result of results) {
      expect(result.exitCode).toBe(0);
    }

    // No DB corruption: a real SQLite integrity check against local.db, plus a project-row
    // consistency check (`hydrate`'s wholesale-replace write must not duplicate/corrupt the
    // single project row a concurrent `doctor` read might observe mid-write).
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
  }, 120000);
});
