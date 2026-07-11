import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { impactCommand } from "../../../src/commands/impact.js";
import { ui } from "../../../src/ui/wizard.js";
import process from "process";
import fs from "fs";
import os from "os";
import path from "path";
import { DI_TOKENS, container } from "@workspace/core";

// We need to mock the service we are resolving from the container
const mockGetImpact = vi.fn();
container.register(DI_TOKENS.QueryService, { getImpact: mockGetImpact });

vi.mock("../../../src/ui/wizard.js", () => ({
  ui: {
    header: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    spinner: vi.fn(() => ({
      start: vi.fn().mockReturnThis(),
      succeed: vi.fn(),
      fail: vi.fn(),
      warn: vi.fn(),
    })),
    askInput: vi.fn(),
  },
}));

describe("impactCommand", () => {
  let tmpDir: string;
  let exitSpy: any;
  let logSpy: any;
  let errorSpy: any;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "docuvia-impact-cmd-test-"));
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code: number) => {
      throw new Error(`Exit ${code}`);
    }) as any);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockGetImpact.mockReset();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  function readLogLines(): any[] {
    const logPath = path.join(tmpDir, ".docuvia", "logs", "impact.log");
    return fs
      .readFileSync(logPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
  }

  it("prints the blast radius and risk level, and logs impact.start/impact.summary, when the target is found", async () => {
    mockGetImpact.mockResolvedValue({
      blastRadius: [
        { name: "callerA", type: "function" },
        { name: "callerB", type: "function" },
      ],
    });

    await impactCommand("myFunction", {}, tmpDir);

    expect(mockGetImpact).toHaveBeenCalledWith("myFunction", undefined);
    const logged = logSpy.mock.calls.map((c: any[]) => String(c[0])).join("\n");
    expect(logged).toContain("callerA (function)");
    expect(logged).toContain("callerB (function)");
    expect(logged).toContain("Risk level: MEDIUM");

    const lines = readLogLines();
    expect(lines.some((l) => l.event === "impact.start" && l.target === "myFunction")).toBe(true);
    const summary = lines.find((l) => l.event === "impact.summary");
    expect(summary).toBeDefined();
    expect(summary.found).toBe(true);
    expect(summary.blastRadiusCount).toBe(2);
    expect(summary.riskLevel).toBe("MEDIUM");
  });

  it("warns and logs found:false when the target is not found", async () => {
    mockGetImpact.mockResolvedValue(null);

    await impactCommand("nonexistent-symbol", {}, tmpDir);

    expect(ui.warn).not.toHaveBeenCalled(); // not-found uses spinner.warn, not ui.warn
    const lines = readLogLines();
    const summary = lines.find((l) => l.event === "impact.summary");
    expect(summary).toBeDefined();
    expect(summary.found).toBe(false);
    expect(summary.blastRadiusCount).toBe(0);
  });

  it("threads the --escalateToLsp flag through to QueryService.getImpact()", async () => {
    mockGetImpact.mockResolvedValue({ blastRadius: [] });

    await impactCommand("myFunction", { escalateToLsp: true }, tmpDir);

    expect(mockGetImpact).toHaveBeenCalledWith("myFunction", true);
    const lines = readLogLines();
    const start = lines.find((l) => l.event === "impact.start");
    expect(start.escalateToLsp).toBe(true);
  });

  it("errors and exits with code 1 when target is missing", async () => {
    await expect(impactCommand("", {}, tmpDir)).rejects.toThrow("Exit 1");
    expect(ui.error).toHaveBeenCalled();
    expect(mockGetImpact).not.toHaveBeenCalled();
  });

  it("logs impact.error and exits with code 1 when QueryService.getImpact() throws", async () => {
    mockGetImpact.mockRejectedValue(new Error("local.db not found"));

    await expect(impactCommand("myFunction", {}, tmpDir)).rejects.toThrow("Exit 1");

    const lines = readLogLines();
    const errorEvent = lines.find((l) => l.event === "impact.error");
    expect(errorEvent).toBeDefined();
    expect(errorEvent.message).toContain("local.db not found");
  });
});
