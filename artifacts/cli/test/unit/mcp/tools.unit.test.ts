import { describe, it, expect, vi } from "vitest";
import { initTool } from "../../../src/mcp/tools/init.js";
import { cleanTool } from "../../../src/mcp/tools/clean.js";
import { statusTool } from "../../../src/mcp/tools/status.js";
import { InitService, CleanService, StatusService } from "@workspace/core";
import process from "process";

vi.mock("@workspace/core", () => {
  return {
    InitService: vi.fn().mockImplementation(() => ({
      init: vi.fn().mockResolvedValue({ message: "Initialized successfully" }),
    })),
    CleanService: vi.fn().mockImplementation(() => ({
      clean: vi.fn().mockResolvedValue({ deleted: true }),
    })),
    StatusService: vi.fn().mockImplementation(() => ({
      getStatus: vi.fn().mockResolvedValue({
        projects: 1,
        l2Nodes: 2,
        l3Nodes: 5,
      }),
    })),
  };
});

describe("MCP Tools", () => {
  it("initTool handler should return success", async () => {
    const result = await initTool.handler({});
    expect(result).toEqual({
      content: [{ type: "text", text: "Docuvia initialized successfully." }],
    });
    expect(InitService).toHaveBeenCalled();
  });

  it("cleanTool handler should return success", async () => {
    const result = await cleanTool.handler({});
    expect(result).toEqual({
      content: [{ type: "text", text: "Cleaned .docuvia/local.db database." }],
    });
    expect(CleanService).toHaveBeenCalled();
  });

  it("statusTool handler should return success", async () => {
    const result = await statusTool.handler({});
    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: expect.stringContaining("Projects: 1"),
        },
      ],
    });
    expect(StatusService).toHaveBeenCalled();
  });
});
