import { StatusService } from "@workspace/core";
import type { McpTool } from "./types.js";
import { withErrorHandling } from "./wrapper.js";
import { MCP_TOOL_MESSAGES } from "./messages.js";

export const statusTool: McpTool = {
  definition: {
    name: "docuvia_status",
    description: "Check the health and counts of the local knowledge graph database.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  handler: withErrorHandling(MCP_TOOL_MESSAGES.ERROR_CHECKING_STATUS, async () => {
    const statusService = new StatusService(process.cwd());
    const status = await statusService.getStatus();
    return {
      content: [
        {
          type: "text",
          text: MCP_TOOL_MESSAGES.STATUS_REPORT(status),
        },
      ],
    };
  }),
};
