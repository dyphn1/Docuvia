import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TestSandbox } from "../../support/sandbox.js";
import Database from "better-sqlite3";
import { resolve } from "path";
import { existsSync } from "fs";

describe.skip("Command: docuvia init", () => {
  let sandbox: TestSandbox;

  beforeEach(async () => {
    sandbox = new TestSandbox();
    // Start with a completely empty sandbox, no DB
    await sandbox.setup({ initGit: true });
  });

  afterEach(async () => {
    await sandbox.teardown();
  });

  it("should successfully initialize the project and create the local SQLite database with correct schema", async () => {
    // Act: Run the actual init command
    const result = await sandbox.runCli(["init"]);

    // Assert: Execution success
    expect(result.exitCode).toBe(0);

    // Assert: Side-effect - the database file must physically exist
    const dbPath = resolve(sandbox.dir, ".docuvia/local.db");
    expect(existsSync(dbPath), "Local database file should be created").toBe(true);

    // Assert: Deep Data Integrity - open the database and verify the schema
    const db = new Database(dbPath, { readonly: true });

    try {
      // Query the sqlite_master table to get all created tables
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {
        name: string;
      }[];
      const tableNames = tables.map((t) => t.name);

      // Verify core knowledge graph tables exist (based on Docuvia schema expectations)
      // We expect it to create tables like l1_tags, l2_nodes, l3_nodes, etc.
      const expectedCoreTables = ["l1_tags", "l2_nodes", "l3_nodes"];

      for (const expectedTable of expectedCoreTables) {
        expect(tableNames).toContain(expectedTable);
      }
    } finally {
      db.close();
    }
  }, 25000);

  it("should be idempotent (running init twice doesn't crash or corrupt the DB)", async () => {
    // Act: Run init twice
    await sandbox.runCli(["init"]);
    const secondResult = await sandbox.runCli(["init"]);

    // Assert
    expect(secondResult.exitCode).toBe(0);
    // It should output success message
    expect(secondResult.stdout || secondResult.stderr).toContain(
      "Project initialized successfully"
    );
  }, 35000);
});
