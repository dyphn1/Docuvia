import { ChangeDetectionService } from "@workspace/core";
import type { McpTool } from "./types.js";
import { withErrorHandling } from "./wrapper.js";
import { MCP_TOOL_MESSAGES } from "./messages.js";

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
  handler: withErrorHandling(MCP_TOOL_MESSAGES.ERROR_DETECTING_CHANGES, async (args: any) => {
    const baseRef = args?.baseRef as string | undefined;
    const changeDetectionService = new ChangeDetectionService(process.cwd());
    const result = await changeDetectionService.detectChanges(baseRef);
    return {
      content: [{ type: "text", text: result.analysis }],
    };
  }),
};
