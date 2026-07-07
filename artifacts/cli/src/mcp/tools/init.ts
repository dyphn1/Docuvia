import { InitService } from "@workspace/core";
import type { McpTool } from "./types.js";
import { withErrorHandling } from "./wrapper.js";

export const initTool: McpTool = {
  definition: {
    name: "docuvia_init",
    description: "Initialize the local Docuvia SQLite database in the current workspace.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  handler: withErrorHandling("Error initializing Docuvia", async () => {
    const initService = new InitService(process.cwd());
    await initService.init();
    return {
      content: [{ type: "text", text: "Docuvia initialized successfully." }],
    };
  }),
};
