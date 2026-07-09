import { CleanService } from "@workspace/core";
import type { McpTool } from "./types.js";
import { withErrorHandling } from "./wrapper.js";
import { MCP_TOOL_MESSAGES } from "./messages.js";

export const cleanTool: McpTool = {
  definition: {
    name: "docuvia_clean",
    description: "Clean (wipe) the local Docuvia SQLite database.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  handler: withErrorHandling(MCP_TOOL_MESSAGES.ERROR_CLEANING, async () => {
    const cleanService = new CleanService(process.cwd());
    const result = await cleanService.clean();
    return {
      content: [
        {
          type: "text",
          text: result.deleted
            ? MCP_TOOL_MESSAGES.CLEAN_SUCCESS
            : MCP_TOOL_MESSAGES.CLEAN_NOT_FOUND,
        },
      ],
    };
  }),
};
