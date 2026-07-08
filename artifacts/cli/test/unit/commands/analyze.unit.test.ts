import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { analyzeCommand } from "../../../src/commands/analyze.js";
import { ui } from "../../../src/ui/wizard.js";
import process from "process";
import { DI_TOKENS, DI_KEYS, container } from "@workspace/core";

const mockAnalyze = vi.fn();
const mockExtract = vi.fn();
container.register(DI_TOKENS.AnalyzeService, { analyzeProject: mockAnalyze });
container.register(DI_TOKENS.ExtractService, { extractDecisions: mockExtract });

vi.mock("../../../src/ui/wizard.js", () => ({
  ui: {
    header: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    spinner: vi.fn(() => ({
      start: vi.fn().mockReturnThis(),
      succeed: vi.fn(),
      fail: vi.fn(),
    })),
  },
}));

vi.mock("@workspace/core", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    AstWorkerPool: vi.fn().mockImplementation(() => ({
      initialize: vi.fn().mockResolvedValue(undefined),
      terminate: vi.fn().mockResolvedValue(undefined),
    })),
  };
});

describe("analyzeCommand", () => {
  let exitSpy: any;
  let logSpy: any;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code: number) => {
      throw new Error(`Exit ${code}`);
    }) as any);
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    mockAnalyze.mockReset();
    mockExtract.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should perform full analysis if no target provided", async () => {
    mockAnalyze.mockResolvedValue({
      projectType: "TypeScript",
      suggestedTags: ["backend"],
    });

    await analyzeCommand();

    expect(mockAnalyze).toHaveBeenCalledWith({ deep: false });
    expect(ui.success).toHaveBeenCalledWith(expect.stringContaining("Project Type"));
  });

  it("should perform focused extraction if target is provided", async () => {
    mockExtract.mockResolvedValue({
      decisions: ["Decision 1"],
    });

    await analyzeCommand("src/index.ts");

    expect(mockExtract).toHaveBeenCalledWith("src/index.ts");
    expect(ui.info).toHaveBeenCalledWith(expect.stringContaining("Decision 1"));
  });
});
