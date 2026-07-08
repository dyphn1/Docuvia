import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runMcpServer } from "../../../src/mcp/server.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

vi.mock("@modelcontextprotocol/sdk/server/index.js", () => {
  return {
    Server: vi.fn().mockImplementation(() => ({
      setRequestHandler: vi.fn(),
      connect: vi.fn().mockResolvedValue(undefined),
    })),
  };
});

vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => {
  return {
    StdioServerTransport: vi.fn(),
  };
});

describe("runMcpServer", () => {
  let consoleSpy: any;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should initialize and connect the MCP server", async () => {
    await runMcpServer();

    expect(Server).toHaveBeenCalled();
    expect(StdioServerTransport).toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledWith("Docuvia Local MCP Server running on stdio");
  });
});
