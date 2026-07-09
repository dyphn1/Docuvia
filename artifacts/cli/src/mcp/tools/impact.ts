import { QueryService } from "@workspace/core";
import type { McpTool } from "./types.js";
import { withErrorHandling } from "./wrapper.js";
import { MCP_TOOL_MESSAGES } from "./messages.js";

export const impactTool: McpTool = {
  definition: {
    name: "docuvia_impact",
    description: "Get blast radius (direct and indirect callers) for a symbol.",
    inputSchema: {
      type: "object",
      properties: {
        target: {
          type: "string",
          description: "The filename, concept, or module name to search for.",
        },
        escalateToLsp: {
          type: "boolean",
          description:
            "Whether to escalate to the TypeScript compiler (LSP) for precise reference resolution.",
        },
      },
      required: ["target"],
    },
  },
  handler: withErrorHandling(MCP_TOOL_MESSAGES.ERROR_GENERIC, async (args: any) => {
    const target = args?.target as string;
    const escalateToLsp = args?.escalateToLsp as boolean | undefined;
    if (!target)
      return {
        content: [{ type: "text", text: MCP_TOOL_MESSAGES.ERROR_MISSING_TARGET }],
        isError: true,
      };
    const queryService = new QueryService(process.cwd());
    const result = await queryService.getImpact(target, escalateToLsp);
    if (!result)
      return {
        content: [{ type: "text", text: MCP_TOOL_MESSAGES.SYMBOL_NOT_FOUND(target) }],
      };
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  }),
};
