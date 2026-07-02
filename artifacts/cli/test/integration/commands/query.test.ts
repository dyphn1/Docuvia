import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TestSandbox } from "../../support/sandbox.js";

describe.skip("Command: docuvia query", () => {
  let sandbox: TestSandbox;

  beforeEach(async () => {
    sandbox = new TestSandbox();
  });

  afterEach(async () => {
    await sandbox.teardown();
  });

  it("should fail gracefully if the database is uninitialized", async () => {
    // Arrange: Empty workspace
    await sandbox.setup({ initGit: true });

    // Act
    const result = await sandbox.runCli(["query", "target-symbol"]).catch((e) => e);

    // Assert
    expect(result).toBeInstanceOf(Error);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Local database not found. Please run "docuvia.initProject"');
  }, 15000);

  it("should query successfully after initialization", async () => {
    // Arrange
    await sandbox.setup({ initGit: true });
    await sandbox.runCli(["init"]);

    // Act
    const result = await sandbox.runCli(["query", "target-symbol"]);

    // Assert
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Docuvia Context"); // Output format check
  }, 25000);
});
