import { QueryService } from "@workspace/core";
import type { McpTool } from "./types.js";
import { withErrorHandling } from "./wrapper.js";
import { MCP_TOOL_MESSAGES } from "./messages.js";

export const contextTool: McpTool = {
  definition: {
    name: "docuvia_context",
    description: "Get structural context (incoming/outgoing edges) for a symbol.",
    inputSchema: {
      type: "object",
      properties: {
        target: {
          type: "string",
          description: "The filename, concept, or module name to search for.",
        },
      },
      required: ["target"],
    },
  },
  handler: withErrorHandling(MCP_TOOL_MESSAGES.ERROR_GENERIC, async (args: any) => {
    const target = args?.target as string;
    if (!target)
      return {
        content: [{ type: "text", text: MCP_TOOL_MESSAGES.ERROR_MISSING_TARGET }],
        isError: true,
      };
    const queryService = new QueryService(process.cwd());
    const result = await queryService.getContext(target);
    if (!result)
      return {
        content: [{ type: "text", text: MCP_TOOL_MESSAGES.SYMBOL_NOT_FOUND(target) }],
      };
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }),
};
