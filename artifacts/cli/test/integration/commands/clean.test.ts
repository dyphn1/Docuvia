import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TestSandbox } from "../../support/sandbox.js";
import { existsSync } from "fs";
import { resolve } from "path";

describe("Command: docuvia clean", () => {
  let sandbox: TestSandbox;

  beforeEach(async () => {
    sandbox = new TestSandbox();
  });

  afterEach(async () => {
    await sandbox.teardown();
  });

  it("should successfully remove the local database", async () => {
    // Arrange: Setup and initialize
    await sandbox.setup({ initGit: true });
    await sandbox.runCli(["init"]);

    const dbPath = resolve(sandbox.dir, ".docuvia/local.db");
    expect(existsSync(dbPath)).toBe(true);

    // Act
    const result = await sandbox.runCli(["clean"]);

    // Assert
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Cleaned .docuvia/local.db database."); // Verify exact output
    expect(existsSync(dbPath)).toBe(false); // Database file should be gone
  }, 25000);
});