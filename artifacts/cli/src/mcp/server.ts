import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import "../registration.js";
import { allTools, toolDefinitions } from "./tools/index.js";
import {
  MCP_SERVER_NAME,
  MCP_SERVER_VERSION,
  MCP_SERVER_READY_MESSAGE,
  MCP_TOOL_NOT_FOUND_MESSAGE,
} from "./constants.js";

export async function runMcpServer() {
  const server = new Server(
    {
      name: MCP_SERVER_NAME,
      version: MCP_SERVER_VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: toolDefinitions,
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    const tool = allTools[name];
    if (tool) {
      return tool.handler(args);
    }

    throw new Error(MCP_TOOL_NOT_FOUND_MESSAGE(name));
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(MCP_SERVER_READY_MESSAGE);
}
