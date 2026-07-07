import { CleanService } from "@workspace/core";
import type { McpTool } from "./types.js";
import { withErrorHandling } from "./wrapper.js";

export const cleanTool: McpTool = {
  definition: {
    name: "docuvia_clean",
    description: "Clean (wipe) the local Docuvia SQLite database.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  handler: withErrorHandling("Error cleaning database", async () => {
    const cleanService = new CleanService(process.cwd());
    const result = await cleanService.clean();
    return {
      content: [
        {
          type: "text",
          text: result.deleted
            ? "Cleaned .docuvia/local.db database."
            : "No local database found to clean.",
        },
      ],
    };
  }),
};
