import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TestSandbox } from "../../support/sandbox.js";

describe("Command: docuvia analyze", () => {
  let sandbox: TestSandbox;

  beforeEach(async () => {
    sandbox = new TestSandbox();
  });

  afterEach(async () => {
    await sandbox.teardown();
  });

  it("should accurately detect a TypeScript/React workspace based on its contents", async () => {
    // Arrange: Create a realistic mock environment (like 'vscode' or 'graphify')
    // We mock a standard React + Vite + TypeScript project
    await sandbox.setup({
      initGit: true,
      files: {
        "package.json": JSON.stringify({
          name: "mock-react-app",
          dependencies: { react: "^18.0.0" },
          devDependencies: { typescript: "^5.0.0", vite: "^4.0.0" }
        }),
        "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true } }),
        "src/main.tsx": "console.log('hello world');"
      }
    });

    // Act: Run analyze
    const result = await sandbox.runCli(["analyze"]);

    // Assert: We aren't just checking exit codes, we are checking that the engine 
    // actually inspected the filesystem and returned the correct business-domain logic.
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Project type: javascript");
    // The current engine detects "react", "typescript" tags based on package.json
    expect(result.stdout.toLowerCase()).toContain("react");
    expect(result.stdout.toLowerCase()).toContain("typescript");
    expect(result.stdout.toLowerCase()).toContain("frontend");
  }, 15000);

  it("should handle an empty, uninitialized workspace without crashing", async () => {
    // Arrange: Completely empty sandbox
    await sandbox.setup({ initGit: true });

    // Act
    const result = await sandbox.runCli(["analyze"]);

    // Assert
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Project type:");
  }, 15000);
});