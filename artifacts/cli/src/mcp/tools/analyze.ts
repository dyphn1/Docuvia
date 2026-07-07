import { AnalyzeService } from "@workspace/core";
import type { McpTool } from "./types.js";
import { withErrorHandling } from "./wrapper.js";

export const analyzeTool: McpTool = {
  definition: {
    name: "docuvia_analyze",
    description: "Analyze the current project to detect frameworks and suggest tags.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  handler: withErrorHandling("Error analyzing project", async () => {
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
  }),
};
