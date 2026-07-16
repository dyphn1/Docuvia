import type { McpTool } from "./types.js";
import { MCP_CONTENT_TYPE_TEXT } from "../constants.js";

export function withErrorHandling(
  errorMessagePrefix: string,
  handler: McpTool["handler"],
): McpTool["handler"] {
  return async (args: any) => {
    try {
      return await handler(args);
    } catch (e: any) {
      return {
        content: [
          {
            type: MCP_CONTENT_TYPE_TEXT,
            text: `${errorMessagePrefix}: ${e.message}`,
          },
        ],
        isError: true,
      };
    }
  };
}
