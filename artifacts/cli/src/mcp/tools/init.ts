import { InitService } from "@workspace/core";
import type { McpTool } from "./types.js";

export const initTool: McpTool = {
  definition: {
    name: "docuvia_init",
    description: "Initialize the local Docuvia SQLite database in the current workspace.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  handler: async () => {
    try {
      const initService = new InitService(process.cwd());
      await initService.init();
      return {
        content: [{ type: "text", text: "Docuvia initialized successfully." }],
      };
    } catch (e: any) {
      return {
        content: [{ type: "text", text: `Error initializing Docuvia: ${e.message}` }],
        isError: true,
      };
    }
  },
};
