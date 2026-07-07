import type { McpTool } from "./types.js";

export function withErrorHandling(
  errorMessagePrefix: string,
  handler: McpTool["handler"]
): McpTool["handler"] {
  return async (args: any) => {
    try {
      return await handler(args);
    } catch (e: any) {
      return {
        content: [{ type: "text", text: `${errorMessagePrefix}: ${e.message}` }],
        isError: true,
      };
    }
  };
}
