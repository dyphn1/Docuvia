import { StatusService } from "@workspace/core";
import type { McpTool } from "./types.js";
import { withErrorHandling } from "./wrapper.js";

export const statusTool: McpTool = {
  definition: {
    name: "docuvia_status",
    description: "Check the health and counts of the local knowledge graph database.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  handler: withErrorHandling("Error checking status", async () => {
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
  }),
};
