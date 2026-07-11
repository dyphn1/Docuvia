import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export interface McpTool {
  definition: Tool;
  handler: (args: any) => Promise<{ content: { type: string; text: string }[]; isError?: boolean }>;
}
