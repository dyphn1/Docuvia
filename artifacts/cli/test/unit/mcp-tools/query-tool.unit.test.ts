import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { queryTool } from "../../../src/mcp/tools/query.js";
import { docuviaApi } from "@workspace/ui-core";
import { docuviaMemory } from "@workspace/contracts";

vi.mock("@workspace/ui-core", () => ({
  docuviaApi: {
    query: vi.fn(),
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

describe("MCP query tool", () => {
  const originalCwd = process.cwd;

  beforeEach(() => {
    vi.clearAllMocks();
    process.cwd = vi.fn().mockReturnValue("/test/workspace");
  });

  afterEach(() => {
    process.cwd = originalCwd;
  });

  it("has correct tool definition", () => {
    expect(queryTool.definition.name).toBe("docuvia_query");
    expect(queryTool.definition.description).toBeTruthy();
    expect(queryTool.definition.inputSchema.required).toContain("target");
  });

  it("calls docuviaApi.query with the target from args", async () => {
    const mockResult = {
      matches: [
        {
          nodeId: "1",
          matchType: "exact",
          score: 1.0,
          node: { key: "test", type: "file", filePath: "test.ts" },
        },
      ],
    };
    vi.mocked(docuviaApi.query).mockResolvedValue(mockResult as any);

    const response = await queryTool.handler({ target: "test.ts" });

    expect(docuviaApi.query).toHaveBeenCalledOnce();
    expect(response.isError).toBeUndefined();
    expect(response.content[0].text).toBe(JSON.stringify(mockResult));
  });

  it("passes limit when provided", async () => {
    vi.mocked(docuviaApi.query).mockResolvedValue({ matches: [] } as any);

    await queryTool.handler({ target: "test.ts", limit: 5 });

    expect(docuviaApi.query).toHaveBeenCalledOnce();
  });

  it("wraps errors with error prefix", async () => {
    vi.mocked(docuviaApi.query).mockRejectedValue(
      new Error("knowledge graph not initialized"),
    );

    const response = await queryTool.handler({ target: "test.ts" });

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain(
      "Error querying Docuvia knowledge graph",
    );
    expect(response.content[0].text).toContain(
      "knowledge graph not initialized",
    );
  });

  it("rejects missing target", async () => {
    const response = await queryTool.handler({});

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain(
      "Error querying Docuvia knowledge graph",
    );
  });
});
