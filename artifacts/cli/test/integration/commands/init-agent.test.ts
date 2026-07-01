import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TestSandbox } from "../../support/sandbox.js";
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

describe("Command: docuvia init-agent", () => {
  let sandbox: TestSandbox;

  beforeEach(async () => {
    sandbox = new TestSandbox();
  });

  afterEach(async () => {
    await sandbox.teardown();
  });

  it("should create agent configuration files in the workspace", async () => {
    // Arrange: Empty workspace
    await sandbox.setup({ initGit: true });

    // Act
    const result = await sandbox.runCli(["init-agent"]);

    // Assert
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Docuvia Agent Integrations successfully installed!");

    // Verify side-effects (file creations)
    const filesToCheck = [
      ".claude/hooks/docuvia-hook.js",
      ".claude/hooks/hooks.json",
      ".cursor/hooks/docuvia-hook.cjs",
      ".cursor/hooks/hooks.json",
      ".github/copilot-instructions.md",
      "CLAUDE.md",
      ".windsurfrules",
      ".cursorrules",
      "llms.txt",
    ];

    for (const file of filesToCheck) {
      const filePath = resolve(sandbox.dir, file);
      expect(existsSync(filePath), `Missing generated file: ${file}`).toBe(true);

      // Verify content of markdown files
      if (file.endsWith(".md") || file.endsWith(".txt") || file.endsWith("rules")) {
        const content = readFileSync(filePath, "utf-8");
        expect(content).toContain("<!-- docuvia:start -->");
      }
    }
  }, 15000);
});
