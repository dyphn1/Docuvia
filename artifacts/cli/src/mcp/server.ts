import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { queryCommand } from "../commands/query.js";

async function runQueryAndCaptureOutput(target: string): Promise<string> {
  const originalLog = console.log;
  let output = "";
  console.log = (msg: string) => {
    output += msg + "\n";
  };
  
  try {
    await queryCommand(target, { local: true, format: 'prompt' });
  } finally {
    console.log = originalLog;
  }
  
  return output.trim();
}

export async function runMcpServer() {
  const server = new Server(
    {
      name: "docuvia-local-mcp",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "docuvia_query_local",
          description: "Query the local Docuvia SQLite database for high-density AST context, L2 architectural modules, and L3 decision rules. Use this tool BEFORE exploring the codebase or modifying files to understand blast radius and existing constraints.",
          inputSchema: {
            type: "object",
            properties: {
              target: {
                type: "string",
                description: "The filename, concept, or module name to search for (e.g. 'src/auth.ts' or 'CorsFilter').",
              }
            },
            required: ["target"],
          },
        }
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name === "docuvia_query_local") {
      const target = args?.target as string;
      if (!target) {
        return {
          content: [{ type: "text", text: "Error: Missing 'target' argument." }],
          isError: true,
        };
      }

      try {
        const contextData = await runQueryAndCaptureOutput(target);
        return {
          content: [{ type: "text", text: contextData || "No context found." }],
        };
      } catch (e: any) {
        return {
          content: [{ type: "text", text: `Error executing query: ${e.message}` }],
          isError: true,
        };
      }
    }

    throw new Error(`Tool not found: ${name}`);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Docuvia Local MCP Server running on stdio");
}
