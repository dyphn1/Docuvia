import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { formatPromptOutput } from "../commands/query.js";
import { InitService, AnalyzeService, ExtractService, QueryService, CleanService, StatusService, ChangeDetectionService, SyncService } from "@workspace/core";

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
        {
          name: "docuvia_clean",
          description: "Clean (wipe) the local Docuvia SQLite database.",
          inputSchema: {
            type: "object",
            properties: {},
          },
        },
        {
          name: "docuvia_status",
          description: "Check the health and counts of the local knowledge graph database.",
          inputSchema: {
            type: "object",
            properties: {},
          },
        },
        {
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
        {
          name: "docuvia_sync",
          description: "Sync local knowledge graph to the remote central server.",
          inputSchema: {
            type: "object",
            properties: {
              projectId: {
                type: "string",
                description: "The remote project ID to sync to.",
              },
              commitSha: {
                type: "string",
                description: "The specific commit SHA to associate with this sync.",
              },
            },
            required: ["projectId"],
          },
        },
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name === "docuvia_context") {
      const target = args?.target as string;
      if (!target) return { content: [{ type: "text", text: "Error: Missing target." }], isError: true };
      try {
        const queryService = new QueryService(process.cwd());
        const result = await queryService.getContext(target);
        if (!result) return { content: [{ type: "text", text: `Symbol "${target}" not found in Docuvia index.` }] };
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }

    if (name === "docuvia_impact") {
      const target = args?.target as string;
      if (!target) return { content: [{ type: "text", text: "Error: Missing target." }], isError: true };
      try {
        const queryService = new QueryService(process.cwd());
        const result = await queryService.getImpact(target);
        if (!result) return { content: [{ type: "text", text: `Symbol "${target}" not found in Docuvia index.` }] };
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }

    if (name === "docuvia_context") {
      const target = args?.target as string;
      if (!target) return { content: [{ type: "text", text: "Error: Missing target." }], isError: true };
      try {
        const queryService = new QueryService(process.cwd());
        const result = await queryService.getContext(target);
        if (!result) return { content: [{ type: "text", text: `Symbol "${target}" not found in Docuvia index.` }] };
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }

    if (name === "docuvia_impact") {
      const target = args?.target as string;
      if (!target) return { content: [{ type: "text", text: "Error: Missing target." }], isError: true };
      try {
        const queryService = new QueryService(process.cwd());
        const result = await queryService.getImpact(target);
        if (!result) return { content: [{ type: "text", text: `Symbol "${target}" not found in Docuvia index.` }] };
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (e: any) {
        return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
      }
    }

    if (name === "docuvia_query_local") {
      const target = args?.target as string;
      if (!target) {
        return {
          content: [{ type: "text", text: "Error: Missing 'target' argument." }],
          isError: true,
        };
      }

      try {
        const queryService = new QueryService(process.cwd());
        const results = await queryService.query(target, { local: true });
        const contextData = formatPromptOutput(results);
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
    }

    if (name === "docuvia_clean") {
      try {
        const cleanService = new CleanService(process.cwd());
        const result = await cleanService.clean();
        return {
          content: [{ type: "text", text: result.deleted ? "Cleaned .docuvia/local.db database." : "No local database found to clean." }],
        };
      } catch (e: any) {
        return {
          content: [{ type: "text", text: `Error cleaning database: ${e.message}` }],
          isError: true,
        };
      }
    }

    if (name === "docuvia_status") {
      try {
        const statusService = new StatusService(process.cwd());
        const status = await statusService.getStatus();
        return {
          content: [{ type: "text", text: `=== Docuvia Index Status ===\nProjects: ${status.projects}\nL2 Nodes: ${status.l2Nodes}\nL3 Decisions: ${status.l3Nodes}` }],
        };
      } catch (e: any) {
        return {
          content: [{ type: "text", text: `Error checking status: ${e.message}` }],
          isError: true,
        };
      }
    }

    if (name === "docuvia_detect_changes") {
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
    }

    if (name === "docuvia_sync") {
      const projectId = args?.projectId as string;
      const commitSha = args?.commitSha as string | undefined;
      if (!projectId) {
        return {
          content: [{ type: "text", text: "Error: Missing 'projectId' argument." }],
          isError: true,
        };
      }

      if (!process.env.DOCUVIA_API_URL || !process.env.MCP_PAT) {
        return {
          content: [{ type: "text", text: "Error: DOCUVIA_API_URL or MCP_PAT is missing in the environment." }],
          isError: true,
        };
      }

      try {
        const syncService = new SyncService(
          process.cwd(),
          process.env.DOCUVIA_API_URL,
          process.env.MCP_PAT
        );
        await syncService.sync(projectId, commitSha);
        return {
          content: [{ type: "text", text: `Sync completed for project ${projectId}.` }],
        };
      } catch (e: any) {
        return {
          content: [{ type: "text", text: `Error syncing project: ${e.message}` }],
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
