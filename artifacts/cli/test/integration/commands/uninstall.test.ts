import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TestSandbox } from "../../support/sandbox.js";
import { resolve } from "path";
import { existsSync, writeFileSync } from "fs";

describe("Command: docuvia uninstall", () => {
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

    // Create an init state first
    await sandbox.runCli(["init"]);

    // Simulate generic markdown file modifications that uninstall should clean up
    const dummyMarkdown =
      "<!-- docuvia:start -->\nSome content\n<!-- docuvia:end -->\nOther user content";
    writeFileSync(resolve(sandbox.dir, "CLAUDE.md"), dummyMarkdown);
  }, 30000);

  afterEach(async () => {
    await sandbox.teardown();
  }, 30000);

  it("should securely reverse integrations, create .bak files, and wipe the database", async () => {
    const result = await sandbox.runCli(["uninstall"]);

    // Success
    expect(result.exitCode).toBe(0);

    // Database must be wiped
    const dbPath = resolve(sandbox.dir, ".docuvia/local.db");
    expect(existsSync(dbPath), "Local database file should be deleted").toBe(
      false,
    );

    // .bak file should be created for CLAUDE.md
    expect(existsSync(resolve(sandbox.dir, "CLAUDE.md.bak"))).toBe(true);

    // CLAUDE.md should not contain the markers
    const claudeMd = require("fs").readFileSync(
      resolve(sandbox.dir, "CLAUDE.md"),
      "utf8",
    );
    expect(claudeMd).not.toContain("<!-- docuvia:start -->");
    expect(claudeMd).toContain("Other user content");
  }, 25000);
});
