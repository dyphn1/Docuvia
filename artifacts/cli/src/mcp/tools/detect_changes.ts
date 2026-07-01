import { ChangeDetectionService } from "@workspace/core";
import type { McpTool } from "./types.js";

export const detectChangesTool: McpTool = {
  definition: {
    name: "docuvia_detect_changes",
    description: "Detect structural changes and evaluate risk score against a base ref.",
    inputSchema: {
      type: "object",
      properties: {
        baseRef: {
          type: "string",
          description: "The base git ref to compare against (e.g. 'main' or 'HEAD').",
        },
      },
    },
  },
  handler: async (args: any) => {
    const baseRef = args?.baseRef as string | undefined;
    try {
      const changeDetectionService = new ChangeDetectionService(process.cwd());
      const result = await changeDetectionService.detectChanges(baseRef);
      return {
        content: [{ type: "text", text: result.analysis }],
      };
    } catch (e: any) {
      return {
        content: [{ type: "text", text: `Error detecting changes: ${e.message}` }],
        isError: true,
      };
    }
  },
};
