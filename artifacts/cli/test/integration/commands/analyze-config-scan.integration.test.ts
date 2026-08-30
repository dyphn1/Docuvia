import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolve } from "path";
import { existsSync, readFileSync } from "fs";
import Database from "better-sqlite3";
import { TestSandbox } from "../../support/sandbox.js";
import { SUBPROCESS_TEST_TIMEOUT_MS } from "@workspace/contracts/testing/timeouts";

/**
 * Closes the real-filesystem half of docs/cli-test-analysis/analyze.md claim 5, retargeted for
 * PLAT-007/phase1-decision-integration.md §6a's auto-mode breaking change: no-arg `analyze` on an
 * empty graph now runs full ingestion (discovery -> config-scan -> AST-parse -> persist), not a
 * config-scan-only pass. Runs the actual CLI process (no vi.mock of any layer) end to end --
 * analyzeCommand -> docuviaApi.analyze -> AnalyzeWorkflow -> `runFullIngestion` against a real
 * package.json (no source files, so the AST-parse phase runs with zero inputs -- still exercises
 * the real worker-pool bootstrap without the extra latency of a real parse; init.test.ts already
 * covers real-file AST parsing end to end) -- proving the full stack, not just a mocked
 * docuviaApi.analyze() (see analyze.unit.test.ts, which mocks @workspace/ui-core entirely).
 */
describe("Command: docuvia analyze (auto mode, empty graph -> full ingestion, real filesystem, full stack)", () => {
  let sandbox: TestSandbox;

  beforeEach(async () => {
    sandbox = new TestSandbox();
    await sandbox.setup({
      files: {
        "package.json": JSON.stringify({
          name: "fixture-project",
          dependencies: { react: "18.0.0" },
          devDependencies: { typescript: "5.0.0" },
        }),
      },
    });
  }, SUBPROCESS_TEST_TIMEOUT_MS);

  afterEach(async () => {
    await sandbox.teardown();
  }, SUBPROCESS_TEST_TIMEOUT_MS);

  it("runs the real discovery/config-scan/persist pipeline end-to-end and prints the fused projectType/tags", async () => {
    const result = await sandbox.runCli(["analyze"]);

    expect(result.exitCode).toBe(0);
    const output = result.stdout || result.stderr;
    expect(output).toContain("javascript");
    expect(output).toContain("typescript");
    expect(output).toContain("react");

    const logPath = resolve(sandbox.dir, ".docuvia/logs/analyze.log");
    expect(existsSync(logPath)).toBe(true);
    const lines = readFileSync(logPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    expect(lines.some((l) => l.event === "analyze.auto.start")).toBe(true);
    expect(lines.some((l) => l.event === "analyze.full.start")).toBe(true);
    const summary = lines.find((l) => l.event === "analyze.full.summary");
    expect(summary?.projectType).toBe("javascript");
    expect(summary?.filesRequested).toBe(0);

    // A project row now exists (full ingestion seeded it) -- proves this went through the real
    // persist path, not just a read-only config scan.
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
  }, 35000);

  it("is idempotent: running analyze twice never duplicates the project row", async () => {
    const first = await sandbox.runCli(["analyze"]);
    expect(first.exitCode).toBe(0);

    const second = await sandbox.runCli(["analyze"]);
    expect(second.exitCode).toBe(0);

    // This fixture has no source files, so `l2Nodes` stays 0 across both runs -- the
    // empty-graph check (§6a: "no project row OR no L2 nodes") re-triggers full ingestion on the
    // second run too (no git repo in this sandbox means there's no HEAD to fast-path or diff a
    // delta against either). `seedProjectRow`'s `getOrInsert` must keep this idempotent -- no
    // duplicate project row, no crash.
    const dbPath = resolve(sandbox.dir, ".docuvia/local.db");
    const db = new Database(dbPath, { readonly: true });
    try {
      const { count } = db
        .prepare("SELECT COUNT(*) as count FROM projects")
        .get() as { count: number };
      expect(count).toBe(1);
    } finally {
      db.close();
    }
  }, 45000);
});
