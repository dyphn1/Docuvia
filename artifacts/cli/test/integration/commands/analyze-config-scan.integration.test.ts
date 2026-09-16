import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolve } from "path";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
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

  it("[happy] runs the real discovery/config-scan/persist pipeline end-to-end and prints the fused projectType/tags", async () => {
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
      .map((line) => JSON.parse(line));
    expect(lines.some((line) => line.event === "analyze.auto.start")).toBe(
      true,
    );
    expect(lines.some((line) => line.event === "analyze.full.start")).toBe(
      true,
    );
    const summary = lines.find((line) => line.event === "analyze.full.summary");
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

  it("[invalid-input] skips a malformed nested package.json without crashing full ingestion", async () => {
    const brokenPackageDir = resolve(sandbox.dir, "packages", "broken");
    mkdirSync(brokenPackageDir, { recursive: true });
    writeFileSync(resolve(brokenPackageDir, "package.json"), "{", "utf8");

    const result = await sandbox.runCli(["analyze"]);
    const output = result.stdout || result.stderr;

    expect(result.exitCode).toBe(0);
    expect(output).toContain("javascript");
    expect(output).toContain("react");
    expect(output).toContain("typescript");

    const db = sandbox.getDb();
    try {
      const { count } = db
        .prepare("SELECT COUNT(*) as count FROM projects")
        .get() as { count: number };
      expect(count).toBe(1);
    } finally {
      db.close();
    }
  }, 35000);

  it("[error-handling] exits non-zero with the stable analyze-error boundary when persistence cannot create .docuvia", async () => {
    writeFileSync(resolve(sandbox.dir, ".docuvia"), "not-a-directory", "utf8");

    const result = await sandbox.runCli(["analyze"], { reject: false });
    const output = `${result.stdout}\n${result.stderr}`;

    expect(result.exitCode).toBe(1);
    expect(output).toContain("Analysis failed:");
    expect(existsSync(resolve(sandbox.dir, ".docuvia/local.db"))).toBe(false);
  }, 35000);

  it("[state-diff] re-scans changed package metadata on the next full ingestion without duplicating the project row", async () => {
    const first = await sandbox.runCli(["analyze"]);
    expect(first.exitCode).toBe(0);
    expect(first.stdout || first.stderr).toContain("react");

    writeFileSync(
      resolve(sandbox.dir, "package.json"),
      JSON.stringify({
        name: "fixture-project",
        dependencies: { express: "5.0.0" },
      }),
      "utf8",
    );

    const second = await sandbox.runCli(["analyze"]);
    const secondOutput = second.stdout || second.stderr;
    expect(second.exitCode).toBe(0);
    expect(secondOutput).toContain("express");
    expect(secondOutput).toContain("backend");
    expect(secondOutput).not.toContain("react");
    expect(secondOutput).not.toContain("typescript");

    // This fixture still has no source files, so the empty-graph rule re-runs full ingestion.
    // seedProjectRow/getOrInsert must retain one project while the config-derived state changes.
    const db = sandbox.getDb();
    try {
      const { count } = db
        .prepare("SELECT COUNT(*) as count FROM projects")
        .get() as { count: number };
      expect(count).toBe(1);
    } finally {
      db.close();
    }
  }, 45000);

  it("[stress] scans 120 package configs in one real CLI run while deduplicating the fused tag set", async () => {
    const packagesRoot = resolve(sandbox.dir, "packages");
    mkdirSync(packagesRoot, { recursive: true });

    const dependencySets = [
      { dependencies: { react: "18.0.0", express: "5.0.0" } },
      { dependencies: { vue: "3.0.0", pg: "8.0.0" } },
      { dependencies: { next: "15.0.0", "drizzle-orm": "0.40.0" } },
      { devDependencies: { typescript: "5.0.0", vitest: "1.0.0" } },
    ];

    for (let index = 0; index < 120; index += 1) {
      const packageDir = resolve(packagesRoot, `pkg-${index}`);
      mkdirSync(packageDir, { recursive: true });
      writeFileSync(
        resolve(packageDir, "package.json"),
        JSON.stringify({
          name: `fixture-${index}`,
          ...dependencySets[index % dependencySets.length],
        }),
        "utf8",
      );
    }

    const result = await sandbox.runCli(["analyze"]);
    const output = result.stdout || result.stderr;
    const tagsLine = output
      .split(/\r?\n/)
      .find((line) => line.includes("Suggested Tags: "));

    expect(result.exitCode).toBe(0);
    expect(tagsLine).toBeDefined();
    if (!tagsLine) throw new Error("Expected Suggested Tags output");

    expect(tagsLine).toContain("react");
    expect(tagsLine).toContain("express");
    expect(tagsLine).toContain("vue");
    expect(tagsLine).toContain("nextjs");
    expect(tagsLine).toContain("drizzle");
    expect(tagsLine).toContain("postgres");
    expect(tagsLine).toContain("vitest");
    expect(tagsLine).toContain("typescript");

    const renderedTags = tagsLine
      .slice(tagsLine.indexOf("Suggested Tags: ") + "Suggested Tags: ".length)
      .split(",")
      .map((tag) => tag.trim());
    expect(new Set(renderedTags).size).toBe(renderedTags.length);

    // Cleanup the large fixture eagerly so Windows teardown has less work after the subprocess.
    rmSync(packagesRoot, { recursive: true, force: true });
  }, 45000);
});
