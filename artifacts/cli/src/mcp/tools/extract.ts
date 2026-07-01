import { ExtractService } from "@workspace/core";
import type { McpTool } from "./types.js";

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
  handler: async (args: any) => {
    const filePath = args?.filePath as string;
    if (!filePath) {
      return {
        content: [{ type: "text", text: "Error: Missing 'filePath' argument." }],
        isError: true,
      };
    }

    try {
      const extractService = new ExtractService(process.cwd());
      const result = await extractService.extractDecisions(filePath);
      return {
        content: [
          {
            type: "text",
            text: `Extraction complete.\nDecisions:\n${result.decisions.map((d: string) => `- ${d}`).join("\n")}`,
          },
        ],
      };
    } catch (e: any) {
      return {
        content: [{ type: "text", text: `Error extracting decisions: ${e.message}` }],
        isError: true,
      };
    }
  },
};
