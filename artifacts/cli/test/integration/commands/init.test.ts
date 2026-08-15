import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TestSandbox } from "../../support/sandbox.js";
import Database from "better-sqlite3";
import { resolve } from "path";
import { existsSync, readFileSync } from "fs";

describe("Command: docuvia init", () => {
  let sandbox: TestSandbox;

  beforeEach(async () => {
    sandbox = new TestSandbox();
    // Seed a fixture source file so Deterministic Recon / AST parsing has something to discover.
    await sandbox.setup({
      initGit: true,
      files: {
        "src/index.ts":
          "export function hello(): string {\n  return 'world';\n}\n",
      },
    });
  }, 30000);

  /** Commits the fixture source file so a real HEAD sha exists -- both for deterministic file
   *  discovery (nothing depends on the working tree being dirty either way here) and so
   *  `stampFullIngestionForTierB` has a real commit to stamp against on the first `init`. */
  async function commitFixture(): Promise<void> {
    await sandbox.runGit(["add", "."]);
    await sandbox.runGit(["commit", "-m", "seed fixture"]);
  }

  afterEach(async () => {
    await sandbox.teardown();
  }, 30000);

  it("should successfully initialize the project and create the local SQLite database with correct schema", async () => {
    // Act: Run the actual init command
    const result = await sandbox.runCli(["init"]);

    // Assert: Execution success
    expect(result.exitCode).toBe(0);

    // Assert: Side-effect - the database file must physically exist
    const dbPath = resolve(sandbox.dir, ".docuvia/local.db");
    expect(existsSync(dbPath), "Local database file should be created").toBe(
      true,
    );

    // Assert: Deep Data Integrity - open the database and verify the schema
    const db = new Database(dbPath, { readonly: true });

    try {
      // Query the sqlite_master table to get all created tables
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all() as {
        name: string;
      }[];
      const tableNames = tables.map((t) => t.name);

      // Verify core knowledge graph tables exist (based on Docuvia schema expectations)
      const expectedCoreTables = [
        "l1_tags",
        "l2_nodes",
        "project_files",
        "node_links",
        "l2_node_l1_tags",
      ];

      for (const expectedTable of expectedCoreTables) {
        expect(tableNames).toContain(expectedTable);
      }

      // Cognitive Snapshot: a single project row and at least one proposed L1 tag.
      const { count: projectCount } = db
        .prepare("SELECT COUNT(*) as count FROM projects")
        .get() as { count: number };
      expect(projectCount).toBe(1);

      const { count: tagCount } = db
        .prepare("SELECT COUNT(*) as count FROM l1_tags")
        .get() as {
        count: number;
      };
      expect(tagCount).toBeGreaterThanOrEqual(1);
    } finally {
      db.close();
    }

    // Assert: the hidden knowledge-graph branch was created.
    const branchOut = await sandbox.runGit([
      "branch",
      "--list",
      "docuvia-knowledge",
    ]);
    expect(branchOut.stdout).toContain("docuvia-knowledge");

    // Assert: a JSONL run log was written, bracketed by init.start/init.summary.
    const logPath = resolve(sandbox.dir, ".docuvia/logs/init.log");
    expect(existsSync(logPath)).toBe(true);
    const lines = readFileSync(logPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    expect(lines[0].event).toBe("init.start");
    expect(lines[lines.length - 1].event).toBe("init.summary");
  }, 25000);

  // NOTE: the concurrent-init race regression test lives in dist-build.test.ts, not here — see
  // that file's comment for why: this test file's `sandbox.runCli()` drives the CLI via `tsx`,
  // whose per-process startup jitter was enough in practice to avoid lining up the race window,
  // making it an unreliable regression guard for a bug that reproduces reliably against the
  // compiled `dist/cli.js`.

  it("should be idempotent (running init twice doesn't crash or corrupt the DB)", async () => {
    // Act: Run init twice
    await sandbox.runCli(["init"]);
    const secondResult = await sandbox.runCli(["init"]);

    // Assert
    expect(secondResult.exitCode).toBe(0);
    // It should output success message, in the TTY output stderr is often used by spinners
    expect(secondResult.stdout || secondResult.stderr).toContain(
      "Docuvia Agent Integrations successfully installed!",
    );

    // The `projects` row must not be duplicated across repeated init runs.
    const dbPath = resolve(sandbox.dir, ".docuvia/local.db");
    const db = new Database(dbPath, { readonly: true });
    try {
      const { count } = db
        .prepare("SELECT COUNT(*) as count FROM projects")
        .get() as {
        count: number;
      };
      expect(count).toBe(1);
    } finally {
      db.close();
    }
  }, 35000);

  // Roadmap item 35 / issue #43: `init` used to always re-run the full discovery/parse/persist
  // sequence, even on an already-initialized workspace. Proves the fix via the graph's own row
  // counts and the JSONL run log -- not just the CLI's exit message/exit code, which the
  // sibling "should be idempotent" test above already covers and which would pass identically
  // whether or not the bug were fixed (it doesn't assert anything about re-ingestion).
  it("skips re-ingestion on a second `docuvia init` once a populated graph already exists", async () => {
    await commitFixture();

    const countL2Nodes = (): number => {
      const dbPath = resolve(sandbox.dir, ".docuvia/local.db");
      const db = new Database(dbPath, { readonly: true });
      try {
        const { count } = db
          .prepare("SELECT COUNT(*) as count FROM l2_nodes")
          .get() as { count: number };
        return count;
      } finally {
        db.close();
      }
    };

    // First run: real full ingestion -- the graph must actually be populated.
    const firstResult = await sandbox.runCli(["init"]);
    expect(firstResult.exitCode).toBe(0);
    const l2NodesAfterFirst = countL2Nodes();
    expect(l2NodesAfterFirst).toBeGreaterThan(0);

    // Second run: the light "already initialized" path -- no re-parse, so the graph's row
    // count must be exactly unchanged (not just "still greater than 0", which a silent
    // re-parse producing the same count by coincidence would also satisfy).
    const secondResult = await sandbox.runCli(["init"]);
    expect(secondResult.exitCode).toBe(0);
    expect(countL2Nodes()).toBe(l2NodesAfterFirst);

    // Confirm via the JSONL run log, not the exit message: exactly one full-ingestion
    // `init.summary` (from run #1) and exactly one `init.already_initialized` (from run #2).
    const logPath = resolve(sandbox.dir, ".docuvia/logs/init.log");
    const lines = readFileSync(logPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    const summaryCount = lines.filter(
      (l: { event: string }) => l.event === "init.summary",
    ).length;
    const alreadyInitializedCount = lines.filter(
      (l: { event: string }) => l.event === "init.already_initialized",
    ).length;
    expect(summaryCount).toBe(1);
    expect(alreadyInitializedCount).toBe(1);
  }, 35000);
});
