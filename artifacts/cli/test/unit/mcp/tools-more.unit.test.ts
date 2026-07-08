import { describe, it, expect, vi } from "vitest";
import { contextTool } from "../../../src/mcp/tools/context.js";
import { impactTool } from "../../../src/mcp/tools/impact.js";
import { detectChangesTool } from "../../../src/mcp/tools/detect-changes.js";
import { QueryService, ImpactService, ChangeDetectionService } from "@workspace/core";
import process from "process";

vi.mock("@workspace/core", () => {
  return {
    QueryService: vi.fn().mockImplementation(() => ({
      getContext: vi.fn().mockResolvedValue({
        l2: { name: "Context Module" },
        l3: [{ title: "Context Decision", content: "Context content" }],
      }),
      getImpact: vi.fn().mockResolvedValue({
        riskScore: "HIGH",
        blastRadius: 5,
        affectedFiles: ["file1.ts", "file2.ts"],
      }),
    })),
    ChangeDetectionService: vi.fn().mockImplementation(() => ({
      detectChanges: vi.fn().mockResolvedValue({
        analysis: "Change analysis result",
      }),
    })),
  };
});

describe("MCP Tools - More", () => {
  it("contextTool handler should return success", async () => {
    const result = await contextTool.handler({ target: "test" });
    expect(result).toEqual({
      content: [{ type: "text", text: expect.stringContaining("Context Decision") }],
    });
    expect(QueryService).toHaveBeenCalled();
  });

  it("impactTool handler should return success", async () => {
    const result = await impactTool.handler({ target: "test" });
    expect(result).toEqual({
      content: [{ type: "text", text: expect.stringContaining("HIGH") }],
    });
  });

  it("detectChangesTool handler should return success", async () => {
    const result = await detectChangesTool.handler({ baseRef: "main" });
    expect(result).toEqual({
      content: [{ type: "text", text: "Change analysis result" }],
    });
    expect(ChangeDetectionService).toHaveBeenCalled();
  });
});
