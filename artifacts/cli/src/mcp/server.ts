import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { queryCommand } from "../commands/query.js";
import { InitService, AnalyzeService, ExtractService } from "@workspace/core";

async function runQueryAndCaptureOutput(target: string): Promise<string> {
  const originalLog = console.log;
  let output = "";
  console.log = (msg: string) => {
    output += msg + "\n";
  };

  try {
    await queryCommand(target, { local: true, format: "prompt" });
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
          description:
            "Query the local Docuvia SQLite database for high-density AST context, L2 architectural modules, and L3 decision rules. Use this tool BEFORE exploring the codebase or modifying files to understand blast radius and existing constraints.",
          inputSchema: {
            type: "object",
            properties: {
              target: {
                type: "string",
                description:
                  "The filename, concept, or module name to search for (e.g. 'src/auth.ts' or 'CorsFilter').",
              },
            },
            required: ["target"],
          },
        },
        {
          name: "docuvia_init",
          description: "Initialize the local Docuvia SQLite database in the current workspace.",
          inputSchema: {
            type: "object",
            properties: {},
          },
        },
        {
          name: "docuvia_analyze",
          description: "Analyze the current project to detect frameworks and suggest tags.",
          inputSchema: {
            type: "object",
            properties: {},
          },
        },
        {
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

    if (name === "docuvia_init") {
      try {
        const initService = new InitService(process.cwd());
        await initService.init();
        return {
          content: [{ type: "text", text: "Docuvia initialized successfully." }],
        };
      } catch (e: any) {
        return {
          content: [{ type: "text", text: `Error initializing Docuvia: ${e.message}` }],
          isError: true,
        };
      }
    }

    if (name === "docuvia_analyze") {
      try {
        const analyzeService = new AnalyzeService(process.cwd());
        const result = await analyzeService.analyzeProject();
        return {
          content: [{ type: "text", text: `Analysis complete. Type: ${result.projectType}. Tags: ${result.suggestedTags.join(", ")}` }],
        };
      } catch (e: any) {
        return {
          content: [{ type: "text", text: `Error analyzing project: ${e.message}` }],
          isError: true,
        };
      }
    }

    if (name === "docuvia_extract") {
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
          content: [{ type: "text", text: `Extraction complete.\nDecisions:\n${result.decisions.map((d: string) => `- ${d}`).join("\n")}` }],
        };
      } catch (e: any) {
        return {
          content: [{ type: "text", text: `Error extracting decisions: ${e.message}` }],
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
