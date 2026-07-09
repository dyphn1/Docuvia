import { InitService } from "@workspace/core";
import type { McpTool } from "./types.js";
import { withErrorHandling } from "./wrapper.js";
import { MCP_TOOL_MESSAGES } from "./messages.js";

export const initTool: McpTool = {
  definition: {
    name: "docuvia_init",
    description: "Initialize the local Docuvia SQLite database in the current workspace.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  handler: withErrorHandling(MCP_TOOL_MESSAGES.ERROR_INITIALIZING, async () => {
    const initService = new InitService(process.cwd());
    await initService.init();
    return {
      content: [{ type: "text", text: MCP_TOOL_MESSAGES.INIT_SUCCESS }],
    };
  }),
};
