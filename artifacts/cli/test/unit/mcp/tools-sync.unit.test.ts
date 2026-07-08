import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { syncTool } from "../../../src/mcp/tools/sync.js";
import { SyncService } from "@workspace/core";
import process from "process";

vi.mock("@workspace/core", () => {
  return {
    SyncService: vi.fn().mockImplementation(() => ({
      sync: vi.fn().mockResolvedValue(undefined),
    })),
  };
});

describe("MCP Tools - Sync", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    process.env.DOCUVIA_API_URL = "http://localhost:8080";
    process.env.MCP_PAT = "dummy";
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.clearAllMocks();
  });

  it("syncTool handler should return success", async () => {
    const result = await syncTool.handler({ projectId: "test-proj" });
    expect(result).toEqual({
      content: [{ type: "text", text: "Sync completed for project test-proj." }],
    });
    expect(SyncService).toHaveBeenCalled();
  });

  it("syncTool should handle missing API env vars", async () => {
    delete process.env.DOCUVIA_API_URL;
    const result = await syncTool.handler({ projectId: "test-proj" });
    expect(result).toEqual({
      content: [
        { type: "text", text: "Error: DOCUVIA_API_URL or MCP_PAT is missing in the environment." },
      ],
      isError: true,
    });
    expect(SyncService).not.toHaveBeenCalled();
  });
});
