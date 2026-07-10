import { describe, it, expect, vi } from "vitest";
import { analyzeTool } from "../../../src/mcp/tools/analyze.js";
import { extractTool } from "../../../src/mcp/tools/extract.js";
import { queryLocalTool } from "../../../src/mcp/tools/query.js";
import { AnalyzeService, ExtractService, QueryService, AstWorkerPool } from "@workspace/core";
import process from "process";

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
        decisions: [
          {
            title: "Decision 1",
            nodeType: "decision",
            content: "Because reasons.",
            confidence: 0.9,
          },
        ],
      }),
    })),
    QueryService: vi.fn().mockImplementation(() => ({
      query: vi.fn().mockResolvedValue({
        l3: [{ title: "D1", content: "Content" }],
      }),
    })),
    AstWorkerPool: vi.fn().mockImplementation(() => ({
      initialize: vi.fn().mockResolvedValue(undefined),
      terminate: vi.fn().mockResolvedValue(undefined),
    })),
  };
});

describe("MCP Tools - Advanced", () => {
  it("analyzeTool handler should return success", async () => {
    const result = await analyzeTool.handler({ deep: false });
    expect(result).toEqual({
      content: [{ type: "text", text: "Analysis complete. Type: typescript. Tags: backend" }],
    });
    expect(AnalyzeService).toHaveBeenCalled();
  });

  it("extractTool handler should return success", async () => {
    const result = await extractTool.handler({ filePath: "src/file.ts" });
    expect(result).toEqual({
      content: [{ type: "text", text: expect.stringContaining("Decision 1") }],
    });
    expect(ExtractService).toHaveBeenCalled();
  });

  it("queryTool handler should return success", async () => {
    const result = await queryLocalTool.handler({ target: "test" });
    expect(result).toEqual({
      content: [{ type: "text", text: expect.stringContaining("D1") }],
    });
    expect(QueryService).toHaveBeenCalled();
  });
});
