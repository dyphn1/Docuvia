import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TestSandbox } from "../../support/sandbox.js";

describe("Command: docuvia doctor", () => {
  let sandbox: TestSandbox;

  beforeEach(async () => {
    sandbox = new TestSandbox();
    await sandbox.setup({
      initGit: true,
      files: {
        "src/index.ts":
          "export function hello(): string {\n  return 'world';\n}\n",
      },
    });
  }, 30000);

  afterEach(async () => {
    await sandbox.teardown();
  }, 30000);

  it("should run diagnostics without crashing", async () => {
    // Run init first so the DB exists
    await sandbox.runCli(["init"]);

    const result = await sandbox.runCli(["doctor"], { reject: false });

    // Might fail depending on git remote availability in sandbox, but should not crash
    const output = result.stdout || result.stderr;
    expect(output).toContain("Running diagnostics...");
    // Sectioned-table report (IFCE CLI output-style pass): a "Database" section header, and a
    // table row carrying the sqlite_integrity check's id + message.
    expect(output).toContain("Database");
    expect(output).toContain("sqlite_integrity");
    expect(output).toContain("Database integrity check passed");
    // Since there's no remote in sandbox, Git might fail, which is expected behavior
    // But it should not hang
  }, 25000);
});
