import { ExtractService } from "@workspace/core";
import type { McpTool } from "./types.js";
import { withErrorHandling } from "./wrapper.js";
import { MCP_TOOL_MESSAGES } from "./messages.js";

export const extractTool: McpTool = {
  definition: {
    name: "docuvia_extract",
    description: "Extract L3 decisions from a given file.",
    inputSchema: {
      type: "object",
      properties: {
        filePath: {
          type: "string",
          description: "The path to the file to extract decisions from.",
        },
      },
      required: ["filePath"],
    },
  },
  handler: withErrorHandling(MCP_TOOL_MESSAGES.ERROR_EXTRACTING, async (args: any) => {
    const filePath = args?.filePath as string;
    if (!filePath) {
      return {
        content: [{ type: "text", text: MCP_TOOL_MESSAGES.ERROR_MISSING_FILE_PATH }],
        isError: true,
      };
    }

    const extractService = new ExtractService(process.cwd());
    const result = await extractService.extractDecisions(filePath);
    return {
      content: [
        {
          type: "text",
          text: MCP_TOOL_MESSAGES.EXTRACT_COMPLETE(result.decisions),
        },
      ],
    };
  }),
};
