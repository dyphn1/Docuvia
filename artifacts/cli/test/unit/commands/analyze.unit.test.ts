import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { analyzeCommand } from "../../../src/commands/analyze.js";
import { ui } from "../../../src/ui/wizard.js";
import { AnalyzeService, ExtractService, AstWorkerPool } from "@workspace/core";
import process from "process";

vi.mock("../../../src/ui/wizard.js", () => ({
  ui: {
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    header: vi.fn(),
    spinner: vi.fn(() => ({
      start: vi.fn().mockReturnThis(),
      succeed: vi.fn(),
      fail: vi.fn(),
    })),
  },
}));

vi.mock("@workspace/core", () => {
  return {
    AnalyzeService: vi.fn().mockImplementation(() => ({
      analyzeProject: vi.fn().mockResolvedValue({
        projectType: "typescript",
        suggestedTags: ["backend"],
      }),
    })),
    ExtractService: vi.fn().mockImplementation(() => ({
      extractDecisions: vi.fn().mockResolvedValue({
        decisions: ["Extracted 1", "Extracted 2"],
      }),
    })),
    AstWorkerPool: vi.fn().mockImplementation(() => ({
      initialize: vi.fn().mockResolvedValue(undefined),
      terminate: vi.fn().mockResolvedValue(undefined),
    })),
  };
});

describe("analyzeCommand", () => {
  let exitSpy: any;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code) => {
      throw new Error(`Exit ${code}`);
    }) as any);
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should perform full analysis if no target provided", async () => {
    await analyzeCommand();

    expect(ui.header).toHaveBeenCalledWith("Analyze Workspace");
    expect(AnalyzeService).toHaveBeenCalled();
  });

  it("should perform focused extraction if target is provided", async () => {
    await analyzeCommand("some/file.ts");

    expect(ui.header).toHaveBeenCalledWith("Analyze (Focused Extraction)");
    expect(ExtractService).toHaveBeenCalled();
    expect(AstWorkerPool).toHaveBeenCalled();
  });

  it("should handle full analysis failure", async () => {
    vi.mocked(AnalyzeService).mockImplementationOnce(
      () =>
        ({
          analyzeProject: vi.fn().mockRejectedValue(new Error("Analysis failed")),
        }) as any
    );
    await expect(analyzeCommand()).rejects.toThrow("Exit 1");
  });

  it("should handle focused extraction failure", async () => {
    vi.mocked(ExtractService).mockImplementationOnce(
      () =>
        ({
          extractDecisions: vi.fn().mockRejectedValue(new Error("Extraction failed")),
        }) as any
    );
    await expect(analyzeCommand("some/file.ts")).rejects.toThrow("Exit 1");
  });
});
