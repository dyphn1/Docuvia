import { QueryService } from "@workspace/core";
import type { McpTool } from "./types.js";

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
  handler: async (args: any) => {
    const target = args?.target as string;
    if (!target)
      return { content: [{ type: "text", text: "Error: Missing target." }], isError: true };
    try {
      const queryService = new QueryService(process.cwd());
      const result = await queryService.getContext(target);
      if (!result)
        return {
          content: [{ type: "text", text: `Symbol "${target}" not found in Docuvia index.` }],
        };
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (e: any) {
      return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
    }
  },
};
