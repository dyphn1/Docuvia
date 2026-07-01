import { StatusService } from "@workspace/core";
import type { McpTool } from "./types.js";

export const statusTool: McpTool = {
  definition: {
    name: "docuvia_status",
    description: "Check the health and counts of the local knowledge graph database.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  handler: async () => {
    try {
      const statusService = new StatusService(process.cwd());
      const status = await statusService.getStatus();
      return {
        content: [
          {
            type: "text",
            text: `=== Docuvia Index Status ===\nProjects: ${status.projects}\nL2 Nodes: ${status.l2Nodes}\nL3 Decisions: ${status.l3Nodes}`,
          },
        ],
      };
    } catch (e: any) {
      return {
        content: [{ type: "text", text: `Error checking status: ${e.message}` }],
        isError: true,
      };
    }
  },
};
