import { AnalyzeService } from "@workspace/core";
import type { McpTool } from "./types.js";
import { withErrorHandling } from "./wrapper.js";
import { MCP_TOOL_MESSAGES } from "./messages.js";

export const analyzeTool: McpTool = {
  definition: {
    name: "docuvia_analyze",
    description: "Analyze the current project to detect frameworks and suggest tags.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  handler: withErrorHandling(MCP_TOOL_MESSAGES.ERROR_ANALYZING, async () => {
    const analyzeService = new AnalyzeService(process.cwd());
    const result = await analyzeService.analyzeProject({});
    return {
      content: [
        {
          type: "text",
          text: MCP_TOOL_MESSAGES.ANALYZE_COMPLETE(result.projectType, result.suggestedTags),
        },
      ],
    };
  }),
};
