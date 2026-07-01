import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TestSandbox } from "../../support/sandbox.js";

describe("Command: docuvia status", () => {
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
    const result = await sandbox.runCli(["status"]).catch((e) => e);

    // Assert
    expect(result).toBeInstanceOf(Error);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Status check failed: Local database not found");
  }, 15000);

  it("should output the correct status format after initialization", async () => {
    // Arrange
    await sandbox.setup({ initGit: true });
    await sandbox.runCli(["init"]);

    // Act
    const result = await sandbox.runCli(["status"]);

    // Assert
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Docuvia Index Status");
    expect(result.stdout).toContain("Projects: 0"); // A newly initialized DB has 0 projects until analyzed
    expect(result.stdout).toContain("L2 Nodes:");
    expect(result.stdout).toContain("L3 Decisions:");
  }, 25000);
});
