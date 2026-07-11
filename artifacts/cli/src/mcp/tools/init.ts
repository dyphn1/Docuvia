import { buildInitCapability } from "@workspace/core";
import type { McpTool } from "./types.js";
import { withErrorHandling } from "./wrapper.js";
import { MCP_TOOL_MESSAGES } from "./messages.js";

/**
 * Thin caller of the *same* composition root the CLI `init` command uses
 * (`commands/init.ts`'s `runDatabaseInit`) — the concrete fix for old Docuvia's MCP tool
 * constructing its service directly (bypassing any shared setup entirely). No `onProgress`
 * here (MCP has no spinner to update).
 */
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
    const command = await buildInitCapability({ workspaceRoot: process.cwd() });
    try {
      const result = await command.execute();
      return {
        content: [{ type: "text", text: result.message }],
      };
    } finally {
      await command.dispose();
    }
  }),
};
