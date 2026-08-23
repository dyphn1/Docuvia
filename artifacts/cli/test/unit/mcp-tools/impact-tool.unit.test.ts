import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { impactTool } from "../../../src/mcp/tools/impact.js";
import { docuviaApi } from "@workspace/ui-core";
import { docuviaMemory } from "@workspace/contracts";

vi.mock("@workspace/ui-core", () => ({
  docuviaApi: {
    impact: vi.fn(),
  },
}));

vi.mock("../../../src/logging/create-logger.js", () => ({
  createPinoBackedLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
  })),
}));

describe("MCP impact tool", () => {
  const originalCwd = process.cwd;

  beforeEach(() => {
    vi.clearAllMocks();
    process.cwd = vi.fn().mockReturnValue("/test/workspace");
  });

  afterEach(() => {
    process.cwd = originalCwd;
  });

  it("has correct tool definition", () => {
    expect(impactTool.definition.name).toBe("docuvia_impact");
    expect(impactTool.definition.description).toBeTruthy();
    expect(impactTool.definition.inputSchema.required).toContain("target");
  });

  it("calls docuviaApi.impact with the target from args", async () => {
    const mockResult = {
      blastRadius: [
        {
          nodeId: "2",
          filePath: "dep.ts",
          edgeType: "import",
          depth: 1,
        },
      ],
      riskLevel: "MEDIUM",
    };
    vi.mocked(docuviaApi.impact).mockResolvedValue(mockResult as any);

    const response = await impactTool.handler({ target: "src/index.ts" });

    expect(docuviaApi.impact).toHaveBeenCalledOnce();
    expect(response.isError).toBeUndefined();
    expect(response.content[0].text).toBe(JSON.stringify(mockResult));
  });

  it("returns null literal when target doesn't resolve", async () => {
    vi.mocked(docuviaApi.impact).mockResolvedValue(null);

    const response = await impactTool.handler({ target: "nonexistent" });

    expect(response.isError).toBeUndefined();
    expect(response.content[0].text).toBe("null");
  });

  it("wraps errors with error prefix", async () => {
    vi.mocked(docuviaApi.impact).mockRejectedValue(
      new Error("graph not found"),
    );

    const response = await impactTool.handler({ target: "src/index.ts" });

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain("Error analyzing impact");
    expect(response.content[0].text).toContain("graph not found");
  });

  it("rejects missing target", async () => {
    const response = await impactTool.handler({});

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain("Error analyzing impact");
  });
});
