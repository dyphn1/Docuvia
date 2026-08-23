import { describe, it, expect, vi, afterEach } from "vitest";
import { docuviaMemory } from "@workspace/contracts";
import { docuviaApi } from "@workspace/ui-core";
import { queryTool } from "../../../../src/mcp/tools/query.js";

vi.mock("@workspace/ui-core", () => ({
  docuviaApi: { query: vi.fn() },
}));

const mockQuery = vi.mocked(docuviaApi.query);

vi.mock("../../../../src/logging/create-logger.js", () => ({
  createPinoBackedLogger: () => ({ onLog: vi.fn() }),
}));

const BASE_RESULT = {
  l2: {
    name: "authService",
    type: "module",
    filePath: "src/auth/service.ts",
    matchType: "exact" as const,
  },
  l3: [{ title: "switched to JWT", content: "details" }],
};

describe("docuvia_query MCP tool", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the prompt-format context plus a next-step hint", async () => {
    mockQuery.mockResolvedValue({
      ...BASE_RESULT,
      context: {
        incoming: [{ name: "caller", linkType: "calls" }],
        outgoing: [],
      },
    });

    const response = await queryTool.handler({ target: "authService" });

    expect(response.isError).toBeUndefined();
    expect(response.content).toHaveLength(2);
    expect(response.content[0].text).toContain("<docuvia_context>");
    expect(response.content[0].text).toContain('<l2_module name="authService"');
    expect(response.content[1].text).toContain("docuvia_impact");
  });

  it("sets WORKSPACE_ROOT/TARGET/LIMIT memory keys and always deletes the scope", async () => {
    const setKeys = new Map<string, unknown>();
    const realSet = docuviaMemory.set.bind(docuviaMemory);
    const setSpy = vi
      .spyOn(docuviaMemory, "set")
      .mockImplementation((id, key, value) => {
        realSet(id, key, value);
        setKeys.set(key, value);
      });

    mockQuery.mockResolvedValue({ ...BASE_RESULT, context: undefined });

    await queryTool.handler({ target: "authService", limit: 5 });

    expect(setKeys.get("target")).toBe("authService");
    expect(setKeys.get("limit")).toBe(5);
    expect(typeof setKeys.get("workspaceRoot")).toBe("string");
    expect(setSpy).toHaveBeenCalled();
  });

  it("deletes the memory scope even when the workflow rejects", async () => {
    const realDeleteScope = docuviaMemory.deleteScope.bind(docuviaMemory);
    const deleteSpy = vi
      .spyOn(docuviaMemory, "deleteScope")
      .mockImplementation(realDeleteScope);

    mockQuery.mockRejectedValue(new Error("db not found"));

    const response = await queryTool.handler({ target: "nope" });

    expect(response.isError).toBe(true);
    expect(deleteSpy).toHaveBeenCalled();
  });

  it("rejects invalid input via the strict schema (negative limit / extra field)", async () => {
    const negativeLimit = await queryTool.handler({
      target: "x",
      limit: -1,
    });
    expect(negativeLimit.isError).toBe(true);

    const extraField = await queryTool.handler({
      target: "x",
      unexpected: true,
    });
    expect(extraField.isError).toBe(true);
  });
});
