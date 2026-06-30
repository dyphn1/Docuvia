import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TestSandbox } from "../support/sandbox.js";

describe("CLI Regression Tests - Argument Parsing & Edge Cases", () => {
  let sandbox: TestSandbox;

  beforeEach(async () => {
    sandbox = new TestSandbox();
    await sandbox.setup();
  });

  afterEach(async () => {
    await sandbox.teardown();
  });

  // --- Helpers ---
  const assertCliFailure = async (args: string[], expectedErrors: string[]) => {
    // Act
    const result = await sandbox.runCli(args).catch((err) => err);

    // Assert
    expect(result).toBeInstanceOf(Error);
    expect(result.exitCode).toBe(1);
    for (const expected of expectedErrors) {
      expect(result.stderr).toContain(expected);
    }
  };

  describe("Missing Required Arguments", () => {
    const missingArgsCases = [
      { args: ["sync"], missing: "project_id", expected: "Usage: docuvia sync <project_id> [commit_sha]" },
      { args: ["query"], missing: "target", expected: "Usage: docuvia query <target> [--local] [--format=prompt|human]" },
      { args: ["extract"], missing: "file_path", expected: "Usage: docuvia extract <file_path>" },
    ];

    it.each(missingArgsCases)(
      "should fail gracefully when '$args' is called without $missing",
      async ({ args, expected }) => {
        await assertCliFailure(args, [expected]);
      },
      15000
    );
  });

  describe("Command Routing & Optional Arguments", () => {
    // Test that the CLI correctly recognizes commands and optional flags,
    // avoiding the "Unknown command:" fallback.
    const validCommands = [
      ["init"],
      ["init-agent"],
      ["analyze"],
      ["analyze", "--deep"],
      ["status"],
      ["clean"],
      ["detect-changes"],
      ["detect-changes", "--baseRef=main"],
    ];

    it.each(validCommands)(
      "should recognize and route the command '%s' correctly",
      async (...args) => {
        const result = await sandbox.runCli(args).catch((err) => err);
        // It should NOT fall through to the unknown command handler
        expect(result?.stderr || "").not.toContain("Unknown command:");
      },
      15000
    );

    it("should successfully boot the MCP server and keep it alive", async () => {
      // Act: The MCP server runs continuously over stdio
      const ac = new AbortController();
      const processPromise = sandbox.runCli(["mcp"], { cancelSignal: ac.signal });
      
      // Wait for 1.5 seconds to ensure it boots without crashing
      await new Promise((resolve) => setTimeout(resolve, 1500));
      
      // Assert: The process should still be running (exitCode is undefined/null)
      // or if it exited due to test environment closing stdin, it shouldn't be 1.
      expect(processPromise.exitCode === undefined || processPromise.exitCode === null).toBe(true);
      
      // Teardown: Kill the background process so the test can exit
      ac.abort();
      await processPromise.catch(() => {}); // Catch the termination error safely
    }, 15000);
  });

  it("should fail gracefully and show help message when unknown command is provided", async () => {
    // Arrange
    const args = ["unknown-command"];
    const expectedErrors = [
      "Unknown command: unknown-command",
      "Usage:",
      "docuvia init"
    ];

    // Act & Assert
    await assertCliFailure(args, expectedErrors);
  }, 15000);
});