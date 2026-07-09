import { QueryService } from "@workspace/core";
import { formatPromptOutput } from "../../commands/query.js";
import type { McpTool } from "./types.js";
import { withErrorHandling } from "./wrapper.js";
import { MCP_TOOL_MESSAGES } from "./messages.js";

export const queryLocalTool: McpTool = {
  definition: {
    name: "docuvia_query_local",
    description:
      "Query the local Docuvia SQLite database for high-density AST context, L2 architectural modules, and L3 decision rules. Use this tool BEFORE exploring the codebase or modifying files to understand blast radius and existing constraints.",
    inputSchema: {
      type: "object",
      properties: {
        target: {
          type: "string",
          description:
            "The filename, concept, or module name to search for (e.g. 'src/auth.ts' or 'CorsFilter').",
        },
      },
      required: ["target"],
    },
  },
  handler: withErrorHandling(MCP_TOOL_MESSAGES.ERROR_QUERYING, async (args: any) => {
    const target = args?.target as string;
    if (!target) {
      return {
        content: [{ type: "text", text: MCP_TOOL_MESSAGES.ERROR_MISSING_QUERY_TARGET }],
        isError: true,
      };
    }

    const queryService = new QueryService(process.cwd());
    const results = await queryService.query(target, { local: true });
    const contextData = formatPromptOutput(results);
    return {
      content: [{ type: "text", text: contextData || MCP_TOOL_MESSAGES.NO_CONTEXT_FOUND }],
    };
  }),
};
