import { AnalyzeService } from "@workspace/core";
import type { McpTool } from "./types.js";

export const analyzeTool: McpTool = {
  definition: {
    name: "docuvia_analyze",
    description: "Analyze the current project to detect frameworks and suggest tags.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  handler: async () => {
    try {
      const analyzeService = new AnalyzeService(process.cwd());
      const result = await analyzeService.analyzeProject();
      return {
        content: [
          {
            type: "text",
            text: `Analysis complete. Type: ${result.projectType}. Tags: ${result.suggestedTags.join(", ")}`,
          },
        ],
      };
    } catch (e: any) {
      return {
        content: [{ type: "text", text: `Error analyzing project: ${e.message}` }],
        isError: true,
      };
    }
  },
};
