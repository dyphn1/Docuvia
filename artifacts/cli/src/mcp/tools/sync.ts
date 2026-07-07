import { SyncService } from "@workspace/core";
import type { McpTool } from "./types.js";
import { withErrorHandling } from "./wrapper.js";

export const syncTool: McpTool = {
  definition: {
    name: "docuvia_sync",
    description: "Sync local knowledge graph to the remote central server.",
    inputSchema: {
      type: "object",
      properties: {
        projectId: {
          type: "string",
          description: "The remote project ID to sync to.",
        },
        commitSha: {
          type: "string",
          description: "The specific commit SHA to associate with this sync.",
        },
      },
      required: ["projectId"],
    },
  },
  handler: withErrorHandling("Error syncing project", async (args: any) => {
    const projectId = args?.projectId as string;
    const commitSha = args?.commitSha as string | undefined;
    if (!projectId) {
      return {
        content: [{ type: "text", text: "Error: Missing 'projectId' argument." }],
        isError: true,
      };
    }

    if (!process.env.DOCUVIA_API_URL || !process.env.MCP_PAT) {
      return {
        content: [
          {
            type: "text",
            text: "Error: DOCUVIA_API_URL or MCP_PAT is missing in the environment.",
          },
        ],
        isError: true,
      };
    }

    const syncService = new SyncService(
      process.cwd(),
      process.env.DOCUVIA_API_URL,
      process.env.MCP_PAT
    );
    await syncService.sync(projectId, commitSha);
    return {
      content: [{ type: "text", text: `Sync completed for project ${projectId}.` }],
    };
  }),
};
