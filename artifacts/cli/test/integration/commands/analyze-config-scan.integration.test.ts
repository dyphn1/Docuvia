import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolve } from "path";
import { existsSync, readFileSync } from "fs";
import { TestSandbox } from "../../support/sandbox.js";

/**
 * Closes the real-filesystem half of docs/cli-test-analysis/analyze.md claim 5: runs the actual
 * CLI process (no vi.mock of any layer) end to end -- analyzeCommand -> docuviaApi.analyze ->
 * AnalyzeWorkflow -> the real ConfigScannerService against a real package.json -- proving the
 * config-scan path works through the full stack, not just against a mocked docuviaApi.analyze()
 * (see analyze.unit.test.ts, which mocks @workspace/ui-core entirely).
 */
describe("Command: docuvia analyze (config scan, real filesystem, full stack)", () => {
  let sandbox: TestSandbox;

  beforeEach(async () => {
    sandbox = new TestSandbox();
    await sandbox.setup({
      files: {
        "package.json": JSON.stringify({
          name: "fixture-project",
          dependencies: { react: "18.0.0" },
          devDependencies: { typescript: "5.0.0" },
        }),
      },
    });
  }, 30000);

  afterEach(async () => {
    await sandbox.teardown();
  }, 30000);

  it("runs the real ConfigScannerService end-to-end and prints the fused projectType/tags", async () => {
    const result = await sandbox.runCli(["analyze"]);

    expect(result.exitCode).toBe(0);
    const output = result.stdout || result.stderr;
    expect(output).toContain("javascript");
    expect(output).toContain("typescript");
    expect(output).toContain("react");

    const logPath = resolve(sandbox.dir, ".docuvia/logs/analyze.log");
    expect(existsSync(logPath)).toBe(true);
    const lines = readFileSync(logPath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    expect(lines.some((l) => l.event === "analyze.start")).toBe(true);
    const summary = lines.find((l) => l.event === "analyze.summary");
    expect(summary?.projectType).toBe("javascript");
  }, 25000);
});
