import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TestSandbox } from "../support/sandbox.js";

describe("CLI Regression Tests - Uninitialized Environment", () => {
  let sandbox: TestSandbox;

  beforeEach(async () => {
    sandbox = new TestSandbox();
    // Setup a clean sandbox WITHOUT running docuvia init (no local.db exists)
    await sandbox.setup({ initGit: true });
  });

  afterEach(async () => {
    await sandbox.teardown();
  });

  it("should fail gracefully when running 'status' in an uninitialized workspace", async () => {
    const result = await sandbox.runCli(["status"]).catch((err) => err);
    expect(result).toBeInstanceOf(Error);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).not.toContain("SqliteError");
    expect(result.stderr).toContain(
      'Status check failed: Local database not found. Please run "docuvia init".'
    );
  }, 15000);

  it("should not fail when running 'analyze' in an uninitialized workspace", async () => {
    // Analyze command creates an in-memory DB or auto-initializes if missing,
    // or doesn't strictly need a persisted DB. It should return exit code 0.
    const result = await sandbox.runCli(["analyze"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Project type:");
  }, 15000);

  it("should fail gracefully when running 'query' in an uninitialized workspace", async () => {
    const result = await sandbox.runCli(["query", "some-target"]).catch((err) => err);
    expect(result).toBeInstanceOf(Error);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).not.toContain("SqliteError");
    // Accept variations of the error message but ensure it guides the user
    expect(result.stderr).toContain('Local database not found. Please run "docuvia.initProject"');
  }, 15000);
});
