import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolve } from "path";
import { existsSync, readFileSync } from "fs";
import Database from "better-sqlite3";
import { TestSandbox } from "../../support/sandbox.js";

const CONCURRENT_RUNS = 5;

/**
 * Regression coverage for docs/cli-test-analysis/analyze.md claim 6, retargeted twice now:
 * analyze-status.md's B.1 verdict (config-scan never opened the SQLite store, so the real risk
 * was only the shared JSONL log file), then again per PLAT-007/phase1-decision-integration.md
 * §6a's auto-mode breaking change -- no-arg `analyze` on an empty graph now runs full ingestion,
 * which DOES open `local.db` read-write (`TOKENS.GraphStoreOpener`). This fixture has no source
 * files, so every concurrent run's empty-graph check (no L2 nodes) keeps re-triggering full
 * ingestion -- deliberately exercising `GraphStore`'s WAL/busy_timeout concurrent-writer handling
 * (ADR-032) under N real concurrent processes, not just the JSONL-append race the original test
 * covered. `seedProjectRow`'s atomic `getOrInsert` must keep the project row from being
 * duplicated across the pile-up.
 */
describe("Command: docuvia analyze (concurrent runs, real filesystem)", () => {
  let sandbox: TestSandbox;

  beforeEach(async () => {
    sandbox = new TestSandbox();
    await sandbox.setup({
      files: {
        "package.json": JSON.stringify({ name: "fixture-project" }),
      },
    });
  }, 30000);

  afterEach(async () => {
    await sandbox.teardown();
  }, 30000);

  it(`resolves all ${CONCURRENT_RUNS} concurrent analyze runs without throwing, writes well-formed JSONL log lines, and never duplicates the project row`, async () => {
    const runs = Array.from({ length: CONCURRENT_RUNS }, () =>
      sandbox.runCli(["analyze"], { reject: false }),
    );
    const results = await Promise.all(runs);

    for (const result of results) {
      expect(result.exitCode).toBe(0);
    }

    const logPath = resolve(sandbox.dir, ".docuvia/logs/analyze.log");
    expect(existsSync(logPath)).toBe(true);
    const rawLines = readFileSync(logPath, "utf8").split("\n").filter(Boolean);

    // Every line must parse as a single well-formed JSON object -- a corrupted/interleaved
    // concurrent write would produce a line that fails JSON.parse or merges two events together.
    const parsedLines = rawLines.map((line) => JSON.parse(line));

    const startEvents = parsedLines.filter(
      (l) => l.event === "analyze.auto.start",
    );
    const summaryEvents = parsedLines.filter(
      (l) => l.event === "analyze.full.summary",
    );
    expect(startEvents.length).toBe(CONCURRENT_RUNS);
    expect(summaryEvents.length).toBe(CONCURRENT_RUNS);

    const dbPath = resolve(sandbox.dir, ".docuvia/local.db");
    expect(existsSync(dbPath)).toBe(true);
    const db = new Database(dbPath, { readonly: true });
    try {
      const { count } = db
        .prepare("SELECT COUNT(*) as count FROM projects")
        .get() as { count: number };
      expect(count).toBe(1);
    } finally {
      db.close();
    }
  }, 90000);
});
