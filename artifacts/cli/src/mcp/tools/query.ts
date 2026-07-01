import { QueryService } from "@workspace/core";
import { formatPromptOutput } from "../../commands/query.js";
import type { McpTool } from "./types.js";

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
  handler: async (args: any) => {
    const target = args?.target as string;
    if (!target) {
      return {
        content: [{ type: "text", text: "Error: Missing 'target' argument." }],
        isError: true,
      };
    }

    try {
      const queryService = new QueryService(process.cwd());
      const results = await queryService.query(target, { local: true });
      const contextData = formatPromptOutput(results);
      return {
        content: [{ type: "text", text: contextData || "No context found." }],
      };
    } catch (e: any) {
      return {
        content: [{ type: "text", text: `Error executing query: ${e.message}` }],
        isError: true,
      };
    }
  },
};
